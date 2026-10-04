import { FixtureReceiver, receivedHeaders } from "./webhook.receiver.fixture";
import { DELIVERY_LEASE_MS, WebhookDispatcher, type DeliveryBody } from "./webhook.dispatcher";
import {
  FakeVault,
  FakeWebhookStore,
  OTHER_WORKSPACE,
  ScriptedTransport,
  WORKSPACE,
  transportFailure,
  webhookConfig,
} from "./webhooks.store.fixture";

/**
 * The delivery pipeline over an in-memory store (#487 acceptance criteria 1, 4, 5 and 7):
 * family filtering is exact, failures retry with backoff and land in the DLQ after the configured
 * attempts, a dead letter redelivers once the receiver recovers, and every attempt verifies
 * against the documented receiver with a stable idempotency key.
 */

/** A dispatcher over a fresh store, three attempts, jitter fixed at the middle. */
function harness(maxAttempts = 3) {
  const store = new FakeWebhookStore();
  const transport = new ScriptedTransport();
  const dispatcher = new WebhookDispatcher(
    store.asRepository(),
    new FakeVault().asService(),
    transport,
    webhookConfig({ webhookMaxAttempts: maxAttempts }),
    () => 0.5,
  );

  return { store, transport, dispatcher, now: store.now };
}

/** Move a time forward. */
const later = (at: Date, ms: number) => new Date(at.getTime() + ms);

describe("fanning out", () => {
  it("queues an event for every active endpoint subscribed to it — and only those", async () => {
    const { store, dispatcher, now } = harness();
    const siem = store.seedEndpoint({ event_families: ["audit.*"] });
    const releases = store.seedEndpoint({ event_families: ["pr.*", "run.*"] });
    const merges = store.seedEndpoint({ event_families: ["run.merged"] });
    store.seedEndpoint({ event_families: ["audit.*"], active: false });
    store.seedEndpoint({ event_families: ["audit.*"], organization_id: OTHER_WORKSPACE });

    store.seedEvent({ event_type: "audit.decision.filed" });
    store.seedEvent({ event_type: "decision.filed" });
    store.seedEvent({ event_type: "run.merged" });
    store.seedEvent({ event_type: "pr.merged" });
    store.seedEvent({ event_type: "run.opened" });

    const result = await dispatcher.fanOut(now);

    expect(result).toEqual({ events: 5, queued: 5 });
    const queued = (endpointId: string) =>
      store.deliveries
        .filter((d) => d.endpoint_id === endpointId)
        .map((d) => d.event_type)
        .sort();

    // audit.* receives audit events and nothing else — not decision.filed, not run.*.
    expect(queued(siem.id)).toEqual(["audit.decision.filed"]);
    expect(queued(releases.id)).toEqual(["pr.merged", "run.merged", "run.opened"]);
    expect(queued(merges.id)).toEqual(["run.merged"]);
    expect(store.outbox.every((event) => event.dispatched_at !== null)).toBe(true);
  });

  it("does not send an endpoint an event that happened before it existed", async () => {
    const { store, dispatcher, now } = harness();
    store.seedEndpoint({ created_at: now });
    store.seedEvent({ occurred_at: later(now, -1000) });

    expect(await dispatcher.fanOut(now)).toEqual({ events: 1, queued: 0 });
  });

  it("gives every queued attempt its own idempotency key, attempt 1, due now", async () => {
    const { store, dispatcher, now } = harness();
    store.seedEndpoint();
    store.seedEndpoint();
    store.seedEvent();

    await dispatcher.fanOut(now);

    expect(store.deliveries).toHaveLength(2);
    expect(new Set(store.deliveries.map((d) => d.delivery_key)).size).toBe(2);
    expect(store.deliveries.every((d) => d.attempt === 1 && d.next_attempt_at === now)).toBe(true);
  });

  it("stamps an event no endpoint wants as dispatched, so it is not read again", async () => {
    const { store, dispatcher, now } = harness();
    const event = store.seedEvent();

    await dispatcher.fanOut(now);

    expect(event.dispatched_at).toEqual(now);
  });
});

describe("delivering", () => {
  it("sends a body the documented receiver verifies, and records the success", async () => {
    const { store, transport, dispatcher, now } = harness();
    const endpoint = store.seedEndpoint();
    const event = store.seedEvent({ payload: { id: "audit-9", action: "provider.rotated" } });

    const report = await dispatcher.tick(now);

    expect(report).toEqual({ fannedOut: 1, queued: 1, sent: 1 });
    const [request] = transport.requests;
    const verdict = new FixtureReceiver("whsec_test", () => now).verify({
      headers: receivedHeaders(request.headers),
      body: request.body,
    });
    expect(verdict.accepted).toBe(true);
    const body = JSON.parse(request.body) as DeliveryBody;
    expect(body).toEqual({
      id: store.deliveries[0].delivery_key,
      type: "audit.provider.rotated",
      eventId: event.id,
      occurredAt: now.toISOString(),
      workspaceId: WORKSPACE,
      registryVersion: 1,
      data: { id: "audit-9", action: "provider.rotated" },
    });
    expect(request.url).toBe(endpoint.url);
    expect(store.deliveries[0]).toMatchObject({ status: "succeeded", response_code: 200 });
  });

  it("retries a failure with backoff, then dead-letters it after the configured attempts", async () => {
    const { store, transport, dispatcher, now } = harness(3);
    store.seedEndpoint();
    store.seedEvent();
    transport.answer(
      { status: 503, body: "upstream unavailable" },
      transportFailure("timeout", "no answer within 10000 ms"),
      { status: 500, body: '{"error":"boom","token":"leaked-value"}' },
    );

    await dispatcher.tick(now);
    // The retry is due 30 s later (jitter at the middle), not before.
    expect(await dispatcher.deliverDue(later(now, 29_000))).toBe(0);
    await dispatcher.deliverDue(later(now, 31_000));
    // The third is due a minute after the second attempt.
    await dispatcher.deliverDue(later(now, 31_000 + 61_000));

    const attempts = [...store.deliveries].sort((a, b) => a.attempt - b.attempt);
    expect(attempts.map((d) => [d.attempt, d.status])).toEqual([
      [1, "failed"],
      [2, "failed"],
      [3, "dead_lettered"],
    ]);
    // One key across every attempt — what lets a receiver drop a duplicate.
    expect(new Set(attempts.map((d) => d.delivery_key)).size).toBe(1);
    expect(attempts[0]).toMatchObject({ response_code: 503, error: "HTTP 503" });
    expect(attempts[1]).toMatchObject({ response_code: null, error: "no answer within 10000 ms" });
    // The captured body is redacted.
    expect(attempts[2].response_excerpt).not.toContain("leaked-value");
    // Nothing further is queued.
    expect(await dispatcher.deliverDue(later(now, 86_400_000))).toBe(0);
  });

  it("sends the same body on every attempt, signed afresh each time", async () => {
    const { store, transport, dispatcher, now } = harness(2);
    store.seedEndpoint();
    store.seedEvent();
    transport.answer({ status: 500 }, { status: 200 });

    await dispatcher.tick(now);
    await dispatcher.deliverDue(later(now, 60_000));

    const [first, second] = transport.requests;
    expect(second.body).toBe(first.body);
    expect(second.headers["X-Ouro-Delivery"]).toBe(first.headers["X-Ouro-Delivery"]);
    expect(second.headers["X-Ouro-Timestamp"]).not.toBe(first.headers["X-Ouro-Timestamp"]);
  });

  it("holds attempts for a disabled endpoint until it is switched back on", async () => {
    const { store, transport, dispatcher, now } = harness();
    const endpoint = store.seedEndpoint();
    store.seedEvent();
    await dispatcher.fanOut(now);

    endpoint.active = false;
    expect(await dispatcher.deliverDue(now)).toBe(0);

    endpoint.active = true;
    expect(await dispatcher.deliverDue(now)).toBe(1);
    expect(transport.requests).toHaveLength(1);
  });

  it("leases a claimed attempt, so it is sent again only after the lease lapses (at-least-once)", async () => {
    const { store, dispatcher, now } = harness();
    store.seedEndpoint();
    store.seedEvent();
    await dispatcher.fanOut(now);

    // Claimed, then the instance "dies" before settling it.
    const claimed = await store.claimDue(now, later(now, DELIVERY_LEASE_MS), 10);
    expect(claimed).toHaveLength(1);

    expect(await dispatcher.deliverDue(later(now, DELIVERY_LEASE_MS - 1))).toBe(0);
    expect(await dispatcher.deliverDue(later(now, DELIVERY_LEASE_MS))).toBe(1);
  });

  it("dead-letters an attempt whose event is gone from the outbox", async () => {
    const { store, transport, dispatcher, now } = harness(1);
    store.seedEndpoint();
    store.seedEvent();
    await dispatcher.fanOut(now);
    store.outbox.length = 0;

    await dispatcher.deliverDue(now);

    expect(transport.requests).toHaveLength(0);
    expect(store.deliveries[0]).toMatchObject({ status: "dead_lettered" });
    expect(store.deliveries[0].error).toMatch(/no longer in the outbox/);
  });
});

describe("an endpoint whose secret cannot be opened", () => {
  it("fails its own attempt unsent, and the tick carries on to the next", async () => {
    const { store, transport, dispatcher, now } = harness(1);
    const broken = store.seedEndpoint();
    broken.hmac_key_sealed = "ouro.v1.fixture.bm90LWEta2V5";
    const healthy = store.seedEndpoint();
    store.seedEvent();

    await dispatcher.tick(now);

    expect(transport.requests.map((request) => request.url)).toEqual([healthy.url]);
    expect(store.deliveries.find((d) => d.endpoint_id === broken.id)).toMatchObject({
      status: "dead_lettered",
      error: "the signing secret could not be opened; rotate it",
    });
  });
});

describe("a redelivery", () => {
  it("gets one try: success clears the DLQ, failure returns it there", async () => {
    const { store, transport, dispatcher, now } = harness(1);
    store.seedEndpoint();
    store.seedEvent();
    transport.answer({ status: 503 });
    await dispatcher.tick(now);
    const dead = store.deliveries[0];
    expect(dead.status).toBe("dead_lettered");

    // A redelivery is a new pending attempt with the same key (what the service queues).
    await store.insertDeliveries([
      {
        organizationId: dead.organization_id,
        endpointId: dead.endpoint_id,
        eventType: dead.event_type,
        eventId: dead.event_id,
        deliveryKey: dead.delivery_key,
        attempt: 2,
        nextAttemptAt: now,
      },
    ]);
    transport.answer({ status: 502 });
    await dispatcher.deliverDue(now);

    const second = store.deliveries.find((d) => d.attempt === 2);
    expect(second?.status).toBe("dead_lettered");

    await store.insertDeliveries([
      {
        organizationId: dead.organization_id,
        endpointId: dead.endpoint_id,
        eventType: dead.event_type,
        eventId: dead.event_id,
        deliveryKey: dead.delivery_key,
        attempt: 3,
        nextAttemptAt: now,
      },
    ]);
    transport.answer({ status: 200 });
    await dispatcher.deliverDue(now);

    expect(store.deliveries.find((d) => d.attempt === 3)?.status).toBe("succeeded");
    // Every attempt carried the original key.
    expect(new Set(transport.requests.map((r) => r.headers["X-Ouro-Delivery"])).size).toBe(1);
  });
});

describe("a ping", () => {
  it("is never retried", async () => {
    const { store, dispatcher, now } = harness();
    const endpoint = store.seedEndpoint();
    const [ping] = await store.insertDeliveries([
      {
        organizationId: WORKSPACE,
        endpointId: endpoint.id,
        eventType: "ping",
        eventId: null,
        deliveryKey: "ping-key",
        attempt: 1,
        nextAttemptAt: later(now, DELIVERY_LEASE_MS),
      },
    ]);

    await dispatcher.settle(ping, {
      status: "failed",
      responseCode: 500,
      latencyMs: 12,
      responseExcerpt: null,
      error: "HTTP 500",
      attemptedAt: now,
    });

    expect(store.deliveries).toHaveLength(1);
    expect(store.deliveries[0].status).toBe("failed");
  });
});
