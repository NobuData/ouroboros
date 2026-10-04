import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { AuditService } from "../audit/audit.service";
import { SCHEMA_NAME } from "../db/schema";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { WebhookDispatcher } from "./webhook.dispatcher";
import { FixtureReceiver, receivedHeaders } from "./webhook.receiver.fixture";
import type { HostResolver } from "./webhook.ssrf";
import { WEBHOOK_RESOLVER, WEBHOOK_TRANSPORT } from "./webhook.transport";
import type {
  WebhookDeliveryPageResource,
  WebhookDeliveryResource,
  WebhookEndpointResource,
  WebhookListResource,
  WebhookSecretResource,
} from "./webhooks.resources";
import { ScriptedTransport } from "./webhooks.store.fixture";

/**
 * Outbound webhooks, end to end over HTTP on a real database (#487, BR.3):
 *
 *   * **same transaction** — an audit row and its outbox row commit together: a failure injected
 *     into the outbox insert leaves no audit row behind (fault injection);
 *   * **create → ping → log**, with the secret shown once and in no list, read or row;
 *   * **family filtering** over the real fan-out SQL — `audit.*` receives audit events only;
 *   * **retry → DLQ → redeliver** over the real claim/settle SQL, and the SIEM row and
 *     `N active` derived from the rows;
 *   * **SSRF at save** — an internal target is a `422`.
 *
 * The transport is scripted and DNS is a table; everything else is the application.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/webhooks
 * ```
 */

const BASE = "/api/v1/settings/webhooks";

/** Every name is public except `*.internal`. */
const resolver: HostResolver = (hostname) =>
  Promise.resolve([
    { address: hostname.endsWith(".internal") ? "10.0.0.9" : "93.184.216.34", family: 4 },
  ]);

describe("outbound webhooks", () => {
  let api: ApiHarness;
  let owner: Person;
  let workspace: Workspace;
  const transport = new ScriptedTransport();

  beforeAll(async () => {
    api = await ApiHarness.start(
      // The loop stays out of the way; each test drives the dispatcher itself.
      { OURO_WEBHOOK_DISPATCH_SECONDS: "300", OURO_WEBHOOK_MAX_ATTEMPTS: "2" },
      [
        { provide: WEBHOOK_TRANSPORT, useValue: transport },
        { provide: WEBHOOK_RESOLVER, useValue: resolver },
      ],
    );
  });

  afterAll(() => api.close());

  beforeEach(async () => {
    transport.requests.length = 0;
    transport.fallback = { status: 200, body: "ok" };
    owner = await api.signIn();
    workspace = await api.workspace(owner);
  });

  afterEach(() => api.truncate());

  /** A settings call as the owner. */
  function asOwner(method: "get" | "post" | "patch" | "delete", path: string) {
    return api.as(owner)(method, path).set(TENANT_HEADER, workspace.id);
  }

  /** The dispatcher the application runs. */
  const dispatcher = () => api.nest.get(WebhookDispatcher, { strict: false });

  /** Create an endpoint through the route. */
  async function create(body: Record<string, unknown>): Promise<WebhookSecretResource> {
    return bodyOf<WebhookSecretResource>(await asOwner("post", BASE).send(body).expect(201));
  }

  /** Record an audit event the way any plane does. */
  function audit(action: "provider.rotated" | "decision.filed") {
    return api.nest.get(AuditService, { strict: false }).record({
      organizationId: workspace.id,
      actorId: owner.id,
      action,
      subjectType: action === "decision.filed" ? "decision_item" : "provider_connection",
      subjectId: "subject-1",
      at: new Date(Date.now() + 1000),
      detail: { kind: "anthropic" },
    });
  }

  /** Rows of one table for the workspace. */
  async function count(table: string): Promise<number> {
    const { rows } = await api.sql.query<{ n: string }>(
      `select count(*) as n from ${SCHEMA_NAME}.${table} where organization_id = $1`,
      [workspace.id],
    );
    return Number(rows[0].n);
  }

  it("commits an audit row and its outbox row together — a failed outbox insert leaves neither", async () => {
    await api.sql.query(`
      create or replace function pg_temp.refuse_outbox() returns trigger language plpgsql as $$
      begin raise exception 'injected outbox failure'; end $$`);
    await api.sql.query(`
      create trigger refuse_outbox before insert on ${SCHEMA_NAME}.webhook_outbox
        for each row execute function pg_temp.refuse_outbox()`);

    try {
      await expect(audit("provider.rotated")).rejects.toThrow(/injected outbox failure/);
    } finally {
      await api.sql.query(`drop trigger refuse_outbox on ${SCHEMA_NAME}.webhook_outbox`);
    }

    expect(await count("audit_events")).toBe(0);
    expect(await count("webhook_outbox")).toBe(0);

    await audit("decision.filed");

    expect(await count("audit_events")).toBe(1);
    const { rows } = await api.sql.query<{ event_type: string }>(
      `select event_type from ${SCHEMA_NAME}.webhook_outbox where organization_id = $1 order by event_type`,
      [workspace.id],
    );
    expect(rows.map((row) => row.event_type)).toEqual(["audit.decision.filed", "decision.filed"]);
  });

  it("shows the secret once, stores it sealed, and returns it from nothing else", async () => {
    const created = await create({
      name: "SIEM · Splunk HEC",
      url: "https://siem.acme.dev/services/collector/event",
      eventFamilies: ["audit.*"],
      siem: true,
    });

    expect(created.secret).toMatch(/^whsec_/);

    const list = await asOwner("get", BASE).expect(200);
    const read = await asOwner("get", `${BASE}/${created.endpoint.id}`).expect(200);
    const rotated = bodyOf<WebhookSecretResource>(
      await asOwner("post", `${BASE}/${created.endpoint.id}/rotate-secret`).expect(200),
    );
    const { rows } = await api.sql.query<{ hmac_key_sealed: string }>(
      `select hmac_key_sealed from ${SCHEMA_NAME}.webhook_endpoints`,
    );
    const trail = await api.sql.query<{ detail: unknown }>(
      `select detail from ${SCHEMA_NAME}.audit_events where organization_id = $1`,
      [workspace.id],
    );

    for (const secret of [created.secret, rotated.secret]) {
      expect(list.text).not.toContain(secret);
      expect(read.text).not.toContain(secret);
      expect(rows[0].hmac_key_sealed).not.toContain(secret);
      expect(JSON.stringify(trail.rows)).not.toContain(secret);
    }
    expect(rows[0].hmac_key_sealed).toMatch(/^ouro\.v1\./);
    expect(list.text).not.toContain("ouro.v1.");
  });

  it("pings an endpoint with a delivery the documented receiver verifies, and logs it", async () => {
    const created = await create({
      name: "Release notes bot",
      url: "https://hooks.acme.dev/ouroboros",
      eventFamilies: ["pr.*", "run.*"],
    });

    const ping = bodyOf<WebhookDeliveryResource>(
      await asOwner("post", `${BASE}/${created.endpoint.id}/ping`).expect(200),
    );

    expect(ping).toMatchObject({ eventType: "ping", status: "succeeded", responseCode: 200 });
    const [request] = transport.requests;
    expect(
      new FixtureReceiver(created.secret).verify({
        headers: receivedHeaders(request.headers),
        body: request.body,
      }).accepted,
    ).toBe(true);

    const log = bodyOf<WebhookDeliveryPageResource>(
      await asOwner("get", `${BASE}/${created.endpoint.id}/deliveries`).expect(200),
    );
    expect(log.items.map((item) => item.id)).toEqual([ping.id]);
  });

  it("sends audit.* audit events and nothing else, over the real fan-out", async () => {
    const siem = await create({
      name: "SIEM",
      url: "https://siem.acme.dev/hook",
      eventFamilies: ["audit.*"],
      siem: true,
    });
    const decisions = await create({
      name: "Decisions",
      url: "https://decisions.acme.dev/hook",
      eventFamilies: ["decision.*"],
    });
    transport.requests.length = 0;

    await audit("decision.filed");
    await dispatcher().tick(new Date(Date.now() + 2000));

    const sentTo = (url: string) =>
      transport.requests
        .filter((request) => request.url === url)
        .map((request) => request.headers["X-Ouro-Event"]);

    // The SIEM is the audit trail: it also hears `webhook.created` for the endpoint audited after
    // it existed — but only ever audit events.
    expect(sentTo("https://siem.acme.dev/hook")).toContain("audit.decision.filed");
    expect(sentTo("https://siem.acme.dev/hook").every((type) => type.startsWith("audit."))).toBe(
      true,
    );
    expect(sentTo("https://decisions.acme.dev/hook")).toEqual(["decision.filed"]);
    expect(siem.endpoint.id).not.toBe(decisions.endpoint.id);
  });

  it("retries, dead-letters, shows the warning, and redelivers once the receiver recovers", async () => {
    const siem = await create({
      name: "SIEM",
      url: "https://siem.acme.dev/hook",
      eventFamilies: ["audit.*"],
      siem: true,
    });
    await create({
      name: "Paused",
      url: "https://paused.acme.dev/hook",
      eventFamilies: ["run.*"],
      active: false,
    });
    // Deliver the management events audited so far, so the DLQ below holds one event.
    await dispatcher().tick(new Date(Date.now() + 1000));
    transport.requests.length = 0;
    transport.fallback = { status: 503, body: "upstream unavailable" };

    await audit("provider.rotated");
    const start = Date.now() + 2000;
    await dispatcher().tick(new Date(start));
    // Attempt 2 of 2, after the 30 s backoff.
    await dispatcher().tick(new Date(start + 40_000));

    const list = bodyOf<WebhookListResource>(await asOwner("get", BASE).expect(200));
    expect(list.activeCount).toBe(1);
    expect(list.siem).toMatchObject({
      streaming: false,
      warning: true,
      health: { state: "dead_lettered", deadLettered: 1 },
    });

    const dead = bodyOf<WebhookDeliveryPageResource>(
      await asOwner("get", `${BASE}/${siem.endpoint.id}/deliveries?status=dead_lettered`).expect(
        200,
      ),
    ).items;
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({ attempt: 2, responseCode: 503, redeliverable: true });

    transport.fallback = { status: 200, body: "ok" };
    const queued = bodyOf<WebhookDeliveryResource>(
      await asOwner(
        "post",
        `${BASE}/${siem.endpoint.id}/deliveries/${dead[0].id}/redeliver`,
      ).expect(202),
    );
    expect(queued).toMatchObject({
      status: "pending",
      attempt: 3,
      deliveryKey: dead[0].deliveryKey,
    });
    await asOwner("post", `${BASE}/${siem.endpoint.id}/deliveries/${dead[0].id}/redeliver`).expect(
      409,
    );

    // Later than attempt 2 on this test's clock, as it would be on a real one.
    await dispatcher().tick(new Date(start + 50_000));

    const after = bodyOf<WebhookListResource>(await asOwner("get", BASE).expect(200));
    expect(after.siem).toMatchObject({ streaming: true, warning: false });
    // Every attempt at the rotated event — two failures and the redelivery — carried one key. (The
    // SIEM also hears `audit.webhook.redelivered`, under a key of its own.)
    const rotated = transport.requests.filter(
      (request) => request.headers["X-Ouro-Event"] === "audit.provider.rotated",
    );
    expect(rotated).toHaveLength(3);
    expect(new Set(rotated.map((request) => request.headers["X-Ouro-Delivery"])).size).toBe(1);
  });

  it("refuses an internal target and an http URL at save", async () => {
    await asOwner("post", BASE)
      .send({ name: "Internal", url: "https://admin.internal/hook", eventFamilies: ["audit.*"] })
      .expect(422)
      .expect((response) => {
        expect((response.body as { code: string }).code).toBe("webhook_target_refused");
      });
    await asOwner("post", BASE)
      .send({ name: "Plain", url: "http://siem.acme.dev/hook", eventFamilies: ["audit.*"] })
      .expect(422);
  });

  it("is an administrator's: a member is refused every route", async () => {
    const member = await api.signIn();
    await api.join(workspace.id, member, "member");

    await api.as(member)("get", BASE).set(TENANT_HEADER, workspace.id).expect(403);
  });

  it("audits every mutation", async () => {
    const created = await create({
      name: "SIEM",
      url: "https://siem.acme.dev/hook",
      eventFamilies: ["audit.*"],
    });
    const id = created.endpoint.id;

    bodyOf<WebhookEndpointResource>(
      await asOwner("patch", `${BASE}/${id}`).send({ active: false }).expect(200),
    );
    await asOwner("post", `${BASE}/${id}/rotate-secret`).expect(200);
    await asOwner("delete", `${BASE}/${id}`).expect(204);

    const { rows } = await api.sql.query<{ action: string }>(
      `select action from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and subject_type = 'webhook_endpoint' order by occurred_at`,
      [workspace.id],
    );
    expect(rows.map((row) => row.action)).toEqual([
      "webhook.created",
      "webhook.disabled",
      "webhook.secret_rotated",
      "webhook.deleted",
    ]);
  });
});
