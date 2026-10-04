import { DomainError } from "../errors/error.envelope";
import { LATEST_REGISTRY_VERSION } from "./webhook.registry";
import { WebhookDispatcher } from "./webhook.dispatcher";
import { InternalAllowlist, type HostResolver } from "./webhook.ssrf";
import type { CreateWebhookDto } from "./webhooks.dto";
import { WEBHOOK_ERRORS } from "./webhooks.errors";
import { WebhooksService, changedFields, updateEvent } from "./webhooks.service";
import {
  FakeVault,
  FakeWebhookStore,
  OTHER_WORKSPACE,
  RecordingAudit,
  ScriptedTransport,
  WORKSPACE,
  webhookConfig,
} from "./webhooks.store.fixture";

/**
 * The management API (#487 acceptance criteria 3, 5, 8, 9 and 10): the secret is shown once and
 * sealed, never listed, read or put in an error; the URL policy runs at save; `N active` and the
 * SIEM state derive from rows; every mutation is audited, rotation included; a dead letter
 * redelivers once the receiver recovers.
 */

const ADMIN = "user-admin";

/** Public DNS for everything except the names a test wants internal. */
const dns: HostResolver = (hostname) =>
  Promise.resolve([
    {
      address: hostname.endsWith(".internal") ? "10.0.0.9" : "93.184.216.34",
      family: 4,
    },
  ]);

/** A service over fresh fakes. */
function harness(allowlist: string[] = []) {
  const store = new FakeWebhookStore();
  const vault = new FakeVault();
  const audit = new RecordingAudit();
  const transport = new ScriptedTransport();
  const config = webhookConfig({ webhookInternalAllowlist: allowlist, webhookMaxAttempts: 1 });
  const dispatcher = new WebhookDispatcher(
    store.asRepository(),
    vault.asService(),
    transport,
    config,
    () => 0.5,
  );
  const service = new WebhooksService(
    store.asRepository(),
    vault.asService(),
    audit.asService(),
    dispatcher,
    config,
    dns,
  );

  return { store, vault, audit, transport, dispatcher, service };
}

const CREATE: CreateWebhookDto = {
  name: "SIEM · Splunk HEC",
  url: "https://siem.acme.dev/services/collector/event",
  eventFamilies: ["audit.*"],
  siem: true,
};

/** The domain error a promise rejected with. */
async function refusal(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

/** A refusal's code. */
function codeOf(error: DomainError): string {
  return error.code;
}

describe("creating an endpoint", () => {
  it("answers with a whsec_ secret once, and stores it only sealed under the endpoint's id", async () => {
    const { store, vault, service } = harness();

    const created = await service.create(WORKSPACE, ADMIN, CREATE);

    expect(created.secret).toMatch(/^whsec_/);
    expect(store.endpoints[0].hmac_key_sealed).toMatch(/^ouro\.v1\./);
    expect(store.endpoints[0].hmac_key_sealed).not.toContain(created.secret);
    expect(vault.sealed).toEqual([{ organizationId: WORKSPACE, recordId: created.endpoint.id }]);
    expect(JSON.stringify(created.endpoint)).not.toContain(created.secret);
  });

  it("subscribes the endpoint under the latest registry version", async () => {
    const { service } = harness();

    const { endpoint } = await service.create(WORKSPACE, ADMIN, CREATE);

    expect(endpoint).toMatchObject({
      registryVersion: LATEST_REGISTRY_VERSION,
      siem: true,
      active: true,
      host: "siem.acme.dev",
    });
  });

  it("audits the creation without the secret or the URL's path", async () => {
    const { audit, service } = harness();

    const created = await service.create(WORKSPACE, ADMIN, CREATE);

    expect(audit.records).toHaveLength(1);
    expect(audit.records[0]).toMatchObject({
      action: "webhook.created",
      subjectType: "webhook_endpoint",
      subjectId: created.endpoint.id,
      actorId: ADMIN,
      detail: { name: CREATE.name, host: "siem.acme.dev", families: "audit.*", siem: true },
    });
    expect(JSON.stringify(audit.records)).not.toContain(created.secret);
    expect(JSON.stringify(audit.records)).not.toContain("/services/collector");
  });

  it("refuses an internal target at save, and lets an allowed one through", async () => {
    const strict = harness();
    const refused = await refusal(
      strict.service.create(WORKSPACE, ADMIN, {
        ...CREATE,
        url: "https://collector.internal/hook",
      }),
    );

    expect(codeOf(refused)).toBe(WEBHOOK_ERRORS.targetRefused);
    expect(strict.store.endpoints).toHaveLength(0);

    const allowed = harness(["collector.internal"]);
    await expect(
      allowed.service.create(WORKSPACE, ADMIN, {
        ...CREATE,
        url: "https://collector.internal/hook",
      }),
    ).resolves.toMatchObject({ endpoint: { host: "collector.internal" } });
  });

  it("refuses the metadata address literal", async () => {
    const { service } = harness();

    expect(
      codeOf(
        await refusal(
          service.create(WORKSPACE, ADMIN, { ...CREATE, url: "https://169.254.169.254/latest" }),
        ),
      ),
    ).toBe(WEBHOOK_ERRORS.targetRefused);
  });

  it("refuses an unregistered event type, and a SIEM route without audit.*", async () => {
    const { service } = harness();

    expect(
      codeOf(
        await refusal(
          service.create(WORKSPACE, ADMIN, {
            ...CREATE,
            siem: false,
            eventFamilies: ["run.exploded"],
          }),
        ),
      ),
    ).toBe(WEBHOOK_ERRORS.subscriptionInvalid);
    expect(
      codeOf(
        await refusal(service.create(WORKSPACE, ADMIN, { ...CREATE, eventFamilies: ["run.*"] })),
      ),
    ).toBe(WEBHOOK_ERRORS.siemRequiresAudit);
  });

  it("refuses a taken name and a second SIEM route", async () => {
    const { service } = harness();
    await service.create(WORKSPACE, ADMIN, CREATE);

    expect(codeOf(await refusal(service.create(WORKSPACE, ADMIN, CREATE)))).toBe(
      WEBHOOK_ERRORS.nameTaken,
    );
    expect(
      codeOf(await refusal(service.create(WORKSPACE, ADMIN, { ...CREATE, name: "Second SIEM" }))),
    ).toBe(WEBHOOK_ERRORS.siemTaken);
  });
});

describe("listing", () => {
  it("counts active endpoints and never carries a secret", async () => {
    const { store, service } = harness();
    const one = await service.create(WORKSPACE, ADMIN, CREATE);
    const two = await service.create(WORKSPACE, ADMIN, {
      name: "Release notes bot",
      url: "https://hooks.acme.dev/ouroboros",
      eventFamilies: ["pr.*", "run.*"],
    });
    await service.create(WORKSPACE, ADMIN, {
      name: "Paused",
      url: "https://paused.acme.dev/",
      eventFamilies: ["decision.*"],
      active: false,
    });
    store.seedEndpoint({ organization_id: OTHER_WORKSPACE });

    const list = await service.list(WORKSPACE);

    expect(list.items).toHaveLength(3);
    expect(list.activeCount).toBe(2);
    const text = JSON.stringify(list);
    expect(text).not.toContain(one.secret);
    expect(text).not.toContain(two.secret);
    expect(text).not.toContain("hmac");
    expect(text).not.toContain("ouro.v1.");
  });

  it("derives the SIEM row: ✓ while delivering, a warning once something is dead-lettered", async () => {
    const { store, transport, dispatcher, service } = harness();
    await service.create(WORKSPACE, ADMIN, CREATE);
    const now = new Date();
    store.now = now;

    expect((await service.list(WORKSPACE)).siem).toMatchObject({
      streaming: false,
      warning: false,
      health: { state: "idle" },
    });

    store.seedEvent({ occurred_at: new Date(now.getTime() + 1000) });
    await dispatcher.tick(now);
    expect((await service.list(WORKSPACE)).siem).toMatchObject({ streaming: true, warning: false });

    transport.answer({ status: 503 });
    store.seedEvent({ occurred_at: new Date(now.getTime() + 2000) });
    await dispatcher.tick(new Date(now.getTime() + 3000));

    expect((await service.list(WORKSPACE)).siem).toMatchObject({
      streaming: false,
      warning: true,
      health: { state: "dead_lettered", deadLettered: 1 },
    });
  });

  it("has no SIEM row when no endpoint is flagged", async () => {
    const { service } = harness();
    await service.create(WORKSPACE, ADMIN, { ...CREATE, siem: false });

    expect((await service.list(WORKSPACE)).siem).toBeNull();
  });
});

describe("reading and errors", () => {
  it("answers 404 for another workspace's endpoint", async () => {
    const { store, service } = harness();
    const theirs = store.seedEndpoint({ organization_id: OTHER_WORKSPACE });

    expect(codeOf(await refusal(service.read(WORKSPACE, theirs.id)))).toBe(WEBHOOK_ERRORS.notFound);
  });

  it("never puts a secret in an error message", async () => {
    const { service } = harness();
    const created = await service.create(WORKSPACE, ADMIN, CREATE);

    const errors = await Promise.all([
      refusal(service.create(WORKSPACE, ADMIN, CREATE)),
      refusal(service.update(WORKSPACE, ADMIN, created.endpoint.id, { eventFamilies: ["x.*"] })),
      refusal(service.read(WORKSPACE, "missing")),
    ]);

    for (const error of errors) {
      expect(JSON.stringify(error.envelope())).not.toContain(created.secret);
    }
  });
});

describe("editing", () => {
  it("audits a lone switch as enabled/disabled and anything else as updated", async () => {
    const { audit, service } = harness();
    const { endpoint } = await service.create(WORKSPACE, ADMIN, CREATE);

    await service.update(WORKSPACE, ADMIN, endpoint.id, { active: false });
    await service.update(WORKSPACE, ADMIN, endpoint.id, { active: true });
    await service.update(WORKSPACE, ADMIN, endpoint.id, { name: "SIEM", description: "Splunk" });

    expect(audit.records.map((record) => record.action)).toEqual([
      "webhook.created",
      "webhook.disabled",
      "webhook.enabled",
      "webhook.updated",
    ]);
    expect(audit.records[3].detail).toMatchObject({ fields: "name,description" });
  });

  it("writes nothing and audits nothing when nothing changes", async () => {
    const { audit, service } = harness();
    const { endpoint } = await service.create(WORKSPACE, ADMIN, CREATE);

    await service.update(WORKSPACE, ADMIN, endpoint.id, { name: CREATE.name, active: true });

    expect(audit.records).toHaveLength(1);
  });

  it("re-runs the URL policy when the URL changes", async () => {
    const { service } = harness();
    const { endpoint } = await service.create(WORKSPACE, ADMIN, CREATE);

    expect(
      codeOf(
        await refusal(
          service.update(WORKSPACE, ADMIN, endpoint.id, { url: "https://admin.internal/" }),
        ),
      ),
    ).toBe(WEBHOOK_ERRORS.targetRefused);
  });

  it("refuses a registry version that does not exist", async () => {
    const { service } = harness();
    const { endpoint } = await service.create(WORKSPACE, ADMIN, CREATE);

    expect(
      codeOf(await refusal(service.update(WORKSPACE, ADMIN, endpoint.id, { registryVersion: 9 }))),
    ).toBe(WEBHOOK_ERRORS.registryVersionUnknown);
  });
});

describe("rotating the secret", () => {
  it("answers with a new secret once, reseals it, and audits the rotation without it", async () => {
    const { store, audit, service } = harness();
    const created = await service.create(WORKSPACE, ADMIN, CREATE);
    const before = store.endpoints[0].hmac_key_sealed;

    const rotated = await service.rotate(WORKSPACE, ADMIN, created.endpoint.id);

    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(created.secret);
    expect(store.endpoints[0].hmac_key_sealed).not.toBe(before);
    expect(audit.records.at(-1)).toMatchObject({ action: "webhook.secret_rotated" });
    expect(JSON.stringify(audit.records)).not.toContain(rotated.secret);
  });

  it("signs the next delivery with the new secret", async () => {
    const { transport, service } = harness();
    const created = await service.create(WORKSPACE, ADMIN, CREATE);
    const rotated = await service.rotate(WORKSPACE, ADMIN, created.endpoint.id);

    await service.ping(WORKSPACE, created.endpoint.id);

    const { createHmac } = await import("node:crypto");
    const [request] = transport.requests;
    const expected = createHmac("sha256", rotated.secret)
      .update(`${request.headers["X-Ouro-Timestamp"]}.${request.body}`)
      .digest("hex");
    expect(request.headers["X-Ouro-Signature"]).toBe(`v1=${expected}`);
  });
});

describe("deleting", () => {
  it("deletes the endpoint and its log, and audits it", async () => {
    const { store, audit, service } = harness();
    const { endpoint } = await service.create(WORKSPACE, ADMIN, CREATE);
    await service.ping(WORKSPACE, endpoint.id);

    await service.remove(WORKSPACE, ADMIN, endpoint.id);

    expect(store.endpoints).toHaveLength(0);
    expect(store.deliveries).toHaveLength(0);
    expect(audit.records.at(-1)).toMatchObject({ action: "webhook.deleted" });
  });
});

describe("the test ping", () => {
  it("answers with a real delivery-log row, success or not, and is never retried", async () => {
    const { transport, service } = harness();
    const { endpoint } = await service.create(WORKSPACE, ADMIN, CREATE);

    const ok = await service.ping(WORKSPACE, endpoint.id);
    transport.answer({ status: 500, body: "nope" });
    const failed = await service.ping(WORKSPACE, endpoint.id);

    expect(ok).toMatchObject({
      eventType: "ping",
      status: "succeeded",
      responseCode: 200,
      attempt: 1,
    });
    expect(failed).toMatchObject({ status: "failed", responseCode: 500, redeliverable: false });
    expect(JSON.parse(transport.requests[0].body)).toMatchObject({ type: "ping", eventId: null });
    const page = await service.deliveries(WORKSPACE, endpoint.id, {});
    expect(page.total).toBe(2);
  });

  it("leaves the SIEM health alone — a ping says nothing about real events", async () => {
    const { service } = harness();
    const { endpoint } = await service.create(WORKSPACE, ADMIN, CREATE);

    await service.ping(WORKSPACE, endpoint.id);

    expect((await service.list(WORKSPACE)).siem?.health.state).toBe("idle");
  });
});

describe("redelivering", () => {
  it("requeues a dead letter with its key, audits it, and delivers once the receiver recovers", async () => {
    const { store, audit, transport, dispatcher, service } = harness();
    const { endpoint } = await service.create(WORKSPACE, ADMIN, CREATE);
    const now = new Date();
    store.now = now;
    store.seedEvent({ occurred_at: new Date(now.getTime() + 1000) });
    transport.answer({ status: 503 });
    await dispatcher.tick(now);
    const [dead] = (await service.deliveries(WORKSPACE, endpoint.id, { status: "dead_lettered" }))
      .items;
    expect(dead.redeliverable).toBe(true);

    const queued = await service.redeliver(WORKSPACE, ADMIN, endpoint.id, dead.id);

    expect(queued).toMatchObject({ status: "pending", attempt: 2, deliveryKey: dead.deliveryKey });
    expect(audit.records.at(-1)).toMatchObject({
      action: "webhook.redelivered",
      detail: { delivery_id: dead.id, attempt: 2 },
    });

    await dispatcher.deliverDue(new Date());

    expect((await service.list(WORKSPACE)).siem).toMatchObject({ streaming: true, warning: false });
  });

  it("refuses a delivery that is not the latest dead letter", async () => {
    const { store, transport, dispatcher, service } = harness();
    const { endpoint } = await service.create(WORKSPACE, ADMIN, CREATE);
    const now = new Date();
    store.now = now;
    store.seedEvent({ occurred_at: new Date(now.getTime() + 1000) });
    transport.answer({ status: 503 });
    await dispatcher.tick(now);
    const [dead] = (await service.deliveries(WORKSPACE, endpoint.id, {})).items;
    await service.redeliver(WORKSPACE, ADMIN, endpoint.id, dead.id);

    expect(codeOf(await refusal(service.redeliver(WORKSPACE, ADMIN, endpoint.id, dead.id)))).toBe(
      WEBHOOK_ERRORS.notRedeliverable,
    );
    expect(codeOf(await refusal(service.redeliver(WORKSPACE, ADMIN, endpoint.id, "missing")))).toBe(
      WEBHOOK_ERRORS.deliveryNotFound,
    );
  });
});

describe("naming an edit", () => {
  const row = {
    name: "a",
    description: null,
    url: "https://a.dev/",
    event_families: ["audit.*", "run.*"],
    siem: false,
    active: true,
    registry_version: 1,
  } as never;

  it("ignores a re-ordered subscription list", () => {
    expect(changedFields(row, { eventFamilies: ["run.*", "audit.*"] })).toEqual([]);
  });

  it("names a lone switch, and the general name otherwise", () => {
    expect(updateEvent(["active"], false)).toBe("webhook.disabled");
    expect(updateEvent(["active", "name"], true)).toBe("webhook.updated");
  });
});

describe("the operator override", () => {
  it("is parsed by the same rules at boot and at save", () => {
    expect(() => new InternalAllowlist(["collector.internal", "10.20.0.0/16"])).not.toThrow();
  });
});
