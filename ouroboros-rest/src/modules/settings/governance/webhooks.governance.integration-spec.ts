import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import type { AuditSubjectType } from "../../audit/audit.events";
import { AuditService } from "../../audit/audit.service";
import { SCHEMA_NAME } from "../../db/schema";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { WEBHOOK_RANDOM, WebhookDispatcher } from "../../webhooks/webhook.dispatcher";
import { FixtureReceiver, receivedHeaders } from "../../webhooks/webhook.receiver.fixture";
import { WebhookDispatchScheduler } from "../../webhooks/webhook.scheduler";
import { TIMESTAMP_HEADER } from "../../webhooks/webhook.signing";
import { InternalAllowlist, type HostResolver } from "../../webhooks/webhook.ssrf";
import {
  HttpsWebhookTransport,
  WEBHOOK_RESOLVER,
  WEBHOOK_TRANSPORT,
  type Requester,
  type WebhookRequest,
  type WebhookResponse,
  type WebhookTransport,
} from "../../webhooks/webhook.transport";
import type {
  WebhookDeliveryPageResource,
  WebhookDeliveryResource,
  WebhookEndpointResource,
  WebhookSecretResource,
} from "../../webhooks/webhooks.resources";
import { ScriptedTransport } from "../../webhooks/webhooks.store.fixture";

/**
 * Webhook security, adversarially (BR.6, [#490](https://github.com/NobuData/ouroboros/issues/490)).
 *
 * `webhooks.integration-spec.ts` (#487) proves the plane works. This suite is written so that
 * **removing a control turns it red** — the acceptance bar of #490, because a webhook control that
 * stops working does not fail loudly: an unverified signature is simply accepted, an unguarded
 * lookup simply connects.
 *
 *   * **Signatures** — every delivery is checked by `FixtureReceiver`, the receiver written from
 *     `docs/WEBHOOKS.md` rather than from the signing code. A tampered body, a re-stamped
 *     timestamp, a wrong secret and a rotated-out secret are each `bad_signature`; a timestamp past
 *     the 300 s window is `outside_replay_window`; a re-presented delivery is a `duplicate`.
 *   * **SSRF** — at save (internal literals, embedded IPv4, CGNAT, user-info, a name with one
 *     internal answer, and on `PATCH`), and **at delivery through the production transport**: a
 *     name saved while it resolved publicly and then rebound to the metadata address is refused at
 *     connect time, and the local receiver hears nothing. A real round trip to an allowlisted
 *     loopback receiver is the positive control.
 *   * **Exact family filtering**, **retry → DLQ → redeliver** on the backoff schedule with the
 *     jitter pinned, **outbox integrity** under a commit-time fault, and **secret non-disclosure**.
 *
 * Clocks are the tick's: every dispatcher pass is `tick(now)` with an explicit instant, the
 * background scheduler is replaced by nothing, and `WEBHOOK_RANDOM` is pinned to the middle of the
 * jitter so a retry is due at exactly 30 s.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/settings/governance/webhooks
 * ```
 */

const BASE = "/api/v1/settings/webhooks";

/** A public address — what a safe name resolves to. */
const PUBLIC_ADDRESS = "93.184.216.34";

/** The cloud metadata address — what a rebinding attack points a saved name at. */
const METADATA_ADDRESS = "169.254.169.254";

/** The one name whose answer a test changes, and what it currently answers. */
const REBINDING_HOST = "receiver.test";
let rebindingAnswer = PUBLIC_ADDRESS;

/**
 * DNS as a table: `*.internal` is private, `mixed.test` answers one public and one private
 * address, {@link REBINDING_HOST} answers whatever the test set, and everything else is public.
 */
const resolver: HostResolver = (hostname) => {
  if (hostname === REBINDING_HOST) {
    return Promise.resolve([{ address: rebindingAnswer, family: 4 }]);
  }

  if (hostname === "mixed.test") {
    return Promise.resolve([
      { address: PUBLIC_ADDRESS, family: 4 },
      { address: "10.0.0.9", family: 4 },
    ]);
  }

  return Promise.resolve([
    { address: hostname.endsWith(".internal") ? "10.0.0.9" : PUBLIC_ADDRESS, family: 4 },
  ]);
};

/**
 * The subject type an audit action is recorded against — enough for the actions this suite uses.
 *
 * @param action - The audit action.
 * @returns Its subject type.
 */
function subjectOf(action: string): AuditSubjectType {
  if (action.startsWith("decision.")) return "decision_item";
  if (action.startsWith("pr_criterion.")) return "pr_criterion";

  return "provider_connection";
}

/** Plain HTTP in place of HTTPS, so the production transport reaches a local server unchanged. */
const plainHttp: Requester = (options, callback) =>
  httpRequest({ ...options, protocol: "http:" }, callback);

/** What the local receiver heard: lower-cased headers, as an HTTP server hands them over. */
interface Heard {
  readonly headers: Record<string, string>;
  readonly body: string;
}

/**
 * The application's transport: scripted by default, the production `HttpsWebhookTransport`
 * when a test switches it to `real` — so one application serves both.
 */
class SwitchableTransport implements WebhookTransport {
  /** Which one sends. */
  current: WebhookTransport;

  /**
   * @param scripted - The recording transport most tests read.
   * @param real - The guarded production transport, with loopback allowlisted.
   */
  constructor(
    readonly scripted: ScriptedTransport,
    readonly real: WebhookTransport,
  ) {
    this.current = scripted;
  }

  /** @inheritdoc */
  send(request: WebhookRequest): Promise<WebhookResponse> {
    return this.current.send(request);
  }
}

describe("webhook security (#490)", () => {
  const scripted = new ScriptedTransport();
  const transport = new SwitchableTransport(
    scripted,
    // The operator allowed loopback — the receiver's real address — and nothing else internal.
    new HttpsWebhookTransport(new InternalAllowlist(["127.0.0.1"]), resolver, plainHttp),
  );
  const heard: Heard[] = [];
  let server: Server;
  let port: number;
  let api: ApiHarness;
  let owner: Person;
  let workspace: Workspace;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        heard.push({
          headers: Object.fromEntries(
            Object.entries(req.headers).map(([name, value]) => [name, String(value)]),
          ),
          body: Buffer.concat(chunks).toString("utf8"),
        });
        res.writeHead(200).end("ok");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;

    api = await ApiHarness.start({ OURO_WEBHOOK_MAX_ATTEMPTS: "2" }, [
      { provide: WEBHOOK_TRANSPORT, useValue: transport },
      { provide: WEBHOOK_RESOLVER, useValue: resolver },
      // The middle of the ±10% jitter: a first retry waits exactly 30 s.
      { provide: WEBHOOK_RANDOM, useValue: () => 0.5 },
      // No background pass: every delivery in this suite happens at a tick the test names.
      { provide: WebhookDispatchScheduler, useValue: {} },
    ]);
  });

  afterAll(async () => {
    await api.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    scripted.requests.length = 0;
    scripted.fallback = { status: 200, body: "ok" };
    transport.current = scripted;
    rebindingAnswer = PUBLIC_ADDRESS;
    heard.length = 0;
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

  /**
   * An instant on a whole second, comfortably after every row a test just wrote — so the
   * timestamp header is exactly `instant / 1000` and every endpoint already exists.
   *
   * @param offsetMs - How far past now.
   * @returns The instant.
   */
  function instant(offsetMs = 5000): Date {
    return new Date(Math.ceil((Date.now() + offsetMs) / 1000) * 1000);
  }

  /**
   * Create an endpoint through the route.
   *
   * @param body - The endpoint.
   * @returns It, with its once-shown secret.
   */
  async function create(body: Record<string, unknown>): Promise<WebhookSecretResource> {
    return bodyOf<WebhookSecretResource>(await asOwner("post", BASE).send(body).expect(201));
  }

  /**
   * Deliver everything audited so far (the endpoints' own `webhook.created` events), then forget
   * it — so a test's assertions see only the events it records.
   */
  async function flush(): Promise<void> {
    await dispatcher().tick(instant());
    scripted.requests.length = 0;
  }

  /**
   * Record an audit event the way any plane does.
   *
   * @param action - The audit action.
   * @param at - When it happened.
   * @returns The event's id.
   */
  function audit(action: string, at: Date = instant(0)) {
    return api.nest.get(AuditService, { strict: false }).record({
      organizationId: workspace.id,
      actorId: owner.id,
      action: action as never,
      subjectType: subjectOf(action),
      subjectId: "subject-1",
      at,
      detail: { kind: "anthropic" },
    });
  }

  /**
   * The event types the scripted transport sent to one URL.
   *
   * @param url - The endpoint's URL.
   * @returns The `X-Ouro-Event` of each request, sorted.
   */
  function typesSentTo(url: string): string[] {
    return scripted.requests
      .filter((request) => request.url === url)
      .map((request) => request.headers["X-Ouro-Event"])
      .sort();
  }

  /**
   * A request as a receiver would hand it over — headers lower-cased.
   *
   * @param request - What the transport sent.
   * @param change - Headers or body to replace, for a tampering case.
   * @returns The request.
   */
  function received(
    request: WebhookRequest,
    change: { headers?: Record<string, string>; body?: string } = {},
  ) {
    return {
      headers: receivedHeaders({ ...request.headers, ...change.headers }),
      body: change.body ?? request.body,
    };
  }

  /**
   * Rows of one table for the workspace.
   *
   * @param table - The table.
   * @returns How many.
   */
  async function count(table: string): Promise<number> {
    const { rows } = await api.sql.query<{ n: string }>(
      `select count(*) as n from ${SCHEMA_NAME}.${table} where organization_id = $1`,
      [workspace.id],
    );

    return Number(rows[0].n);
  }

  describe("signatures, verified by the documented receiver", () => {
    it("accepts a genuine delivery and refuses a tampered body, a re-stamped timestamp, a wrong secret and a rotated-out one", async () => {
      const url = "https://siem.acme.dev/hook";
      const created = await create({ name: "SIEM", url, eventFamilies: ["audit.*"] });
      await flush();

      const at = instant();
      await audit("provider.rotated", at);
      await dispatcher().tick(at);

      const [delivered] = scripted.requests;
      const clock = () => at;

      expect(new FixtureReceiver(created.secret, clock).verify(received(delivered))).toMatchObject({
        accepted: true,
        event: { type: "audit.provider.rotated" },
      });

      // One byte of the body changed — the amount moved, the actor swapped.
      const tampered = delivered.body.replace("provider.rotated", "provider.rotatee");
      expect(tampered).not.toBe(delivered.body);
      expect(
        new FixtureReceiver(created.secret, clock).verify(received(delivered, { body: tampered })),
      ).toEqual({ accepted: false, reason: "bad_signature" });

      // The timestamp moved inside the window without re-signing: the signature covers it.
      const restamped = String(Number(delivered.headers[TIMESTAMP_HEADER]) + 1);
      expect(
        new FixtureReceiver(created.secret, clock).verify(
          received(delivered, { headers: { [TIMESTAMP_HEADER]: restamped } }),
        ),
      ).toEqual({ accepted: false, reason: "bad_signature" });

      expect(
        new FixtureReceiver("whsec_somebody-elses-secret", clock).verify(received(delivered)),
      ).toEqual({ accepted: false, reason: "bad_signature" });

      // Rotate: the next delivery is signed under the new secret only.
      const rotated = bodyOf<WebhookSecretResource>(
        await asOwner("post", `${BASE}/${created.endpoint.id}/rotate-secret`).expect(200),
      );
      scripted.requests.length = 0;
      const later = new Date(at.getTime() + 60_000);
      await audit("provider.updated", later);
      await dispatcher().tick(later);

      const afterRotation = scripted.requests.find(
        (request) => request.headers["X-Ouro-Event"] === "audit.provider.updated",
      );

      if (afterRotation === undefined) throw new Error("nothing was delivered after the rotation");
      expect(
        new FixtureReceiver(created.secret, () => later).verify(received(afterRotation)),
      ).toEqual({ accepted: false, reason: "bad_signature" });
      expect(
        new FixtureReceiver(rotated.secret, () => later).verify(received(afterRotation)).accepted,
      ).toBe(true);
    });

    it("refuses a delivery presented outside the replay window, and a re-presented one as a duplicate", async () => {
      const created = await create({
        name: "SIEM",
        url: "https://siem.acme.dev/hook",
        eventFamilies: ["audit.*"],
      });
      await flush();

      const at = instant();
      await audit("provider.rotated", at);
      await dispatcher().tick(at);

      const [delivered] = scripted.requests;

      // The header is the tick's instant: the delivery was signed at `at`.
      expect(delivered.headers[TIMESTAMP_HEADER]).toBe(String(at.getTime() / 1000));

      const onTime = new FixtureReceiver(created.secret, () => new Date(at.getTime() + 299_000));
      expect(onTime.verify(received(delivered)).accepted).toBe(true);
      // The same delivery again — a replay the receiver already processed.
      expect(onTime.verify(received(delivered))).toEqual({ accepted: false, reason: "duplicate" });

      for (const skew of [301_000, -301_000]) {
        expect(
          new FixtureReceiver(created.secret, () => new Date(at.getTime() + skew)).verify(
            received(delivered),
          ),
        ).toEqual({ accepted: false, reason: "outside_replay_window" });
      }
    });
  });

  describe("SSRF", () => {
    it.each([
      ["the metadata address", `https://${METADATA_ADDRESS}/latest/meta-data`],
      ["IPv6 loopback", "https://[::1]/hook"],
      ["IPv4-mapped IPv6", "https://[::ffff:10.0.0.1]/hook"],
      ["NAT64-embedded metadata", "https://[64:ff9b::a9fe:a9fe]/hook"],
      ["carrier-grade NAT", "https://100.64.0.7/hook"],
      ["a name that resolves privately", "https://admin.internal/hook"],
      ["a name with one private answer among public ones", "https://mixed.test/hook"],
    ])("refuses %s at save, and stores nothing", async (_about, url) => {
      await asOwner("post", BASE)
        .send({ name: "Target", url, eventFamilies: ["audit.*"] })
        .expect(422)
        .expect((response) => {
          expect(response.body).toMatchObject({
            code: "webhook_target_refused",
            details: { field: "url" },
          });
        });

      expect(await count("webhook_endpoints")).toBe(0);
      expect(await count("audit_events")).toBe(0);
    });

    it("refuses user-info in the URL at save", async () => {
      await asOwner("post", BASE)
        .send({
          name: "Target",
          url: "https://admin:hunter2@siem.acme.dev/hook",
          eventFamilies: ["audit.*"],
        })
        .expect(422);

      expect(await count("webhook_endpoints")).toBe(0);
    });

    it("refuses an internal target on PATCH and keeps the URL it had", async () => {
      const created = await create({
        name: "SIEM",
        url: "https://siem.acme.dev/hook",
        eventFamilies: ["audit.*"],
      });

      await asOwner("patch", `${BASE}/${created.endpoint.id}`)
        .send({ url: `https://${METADATA_ADDRESS}/latest/meta-data` })
        .expect(422)
        .expect((response) => {
          expect((response.body as { code: string }).code).toBe("webhook_target_refused");
        });

      const read = bodyOf<WebhookEndpointResource>(
        await asOwner("get", `${BASE}/${created.endpoint.id}`).expect(200),
      );
      expect(read.url).toBe("https://siem.acme.dev/hook");

      const { rows } = await api.sql.query<{ action: string }>(
        `select action from ${SCHEMA_NAME}.audit_events where organization_id = $1`,
        [workspace.id],
      );
      expect(rows.map((row) => row.action)).toEqual(["webhook.created"]);
    });

    it("delivers through the production transport to an allowlisted receiver, and refuses the same name once it rebinds to the metadata address", async () => {
      transport.current = transport.real;
      // Saved while the name resolves publicly — the save-time check has nothing to refuse.
      const created = await create({
        name: "Receiver",
        url: `https://${REBINDING_HOST}:${String(port)}/hook`,
        eventFamilies: ["audit.*"],
      });

      // The positive control: the name now answers the receiver's loopback, which the operator
      // allowed, and a real request arrives that the documented recipe verifies.
      rebindingAnswer = "127.0.0.1";
      const ping = bodyOf<WebhookDeliveryResource>(
        await asOwner("post", `${BASE}/${created.endpoint.id}/ping`).expect(200),
      );

      expect(ping).toMatchObject({ status: "succeeded", responseCode: 200 });
      expect(heard).toHaveLength(1);
      expect(new FixtureReceiver(created.secret).verify(heard[0]).accepted).toBe(true);

      // Rebound: the same saved name now points at the metadata service.
      rebindingAnswer = METADATA_ADDRESS;
      const refused = bodyOf<WebhookDeliveryResource>(
        await asOwner("post", `${BASE}/${created.endpoint.id}/ping`).expect(200),
      );

      expect(refused).toMatchObject({ status: "failed", responseCode: null });
      expect(refused.error).toContain("blocked by URL policy");
      expect(refused.error).toContain("internal_address");

      // And through the dispatcher, for an event rather than a ping.
      const at = instant();
      await audit("provider.rotated", at);
      await dispatcher().tick(at);

      const log = bodyOf<WebhookDeliveryPageResource>(
        await asOwner("get", `${BASE}/${created.endpoint.id}/deliveries`).expect(200),
      );
      const rotated = log.items.find((item) => item.eventType === "audit.provider.rotated");

      expect(rotated?.error).toContain("internal_address");
      expect(heard).toHaveLength(1);
    });
  });

  describe("event families", () => {
    it("delivers exactly what each endpoint subscribed to — and nothing to an inactive endpoint or for an event older than the endpoint", async () => {
      const urls = {
        concrete: "https://concrete.acme.dev/hook",
        pr: "https://pr.acme.dev/hook",
        audit: "https://audit.acme.dev/hook",
        decisions: "https://decisions.acme.dev/hook",
        inactive: "https://inactive.acme.dev/hook",
      };
      await create({
        name: "Concrete",
        url: urls.concrete,
        eventFamilies: ["audit.provider.rotated"],
      });
      await create({ name: "PR", url: urls.pr, eventFamilies: ["pr.*"] });
      await create({ name: "Audit", url: urls.audit, eventFamilies: ["audit.*"] });
      await create({ name: "Decisions", url: urls.decisions, eventFamilies: ["decision.*"] });
      await create({
        name: "Inactive",
        url: urls.inactive,
        eventFamilies: ["audit.*", "decision.*", "pr.*"],
        active: false,
      });
      await flush();

      const at = instant();
      await audit("provider.rotated", at);
      await audit("decision.filed", at);
      await audit("pr_criterion.verified", at);
      // Before any of the endpoints existed: nobody subscribed to it at the time.
      await audit("provider.deleted", new Date(Date.now() - 10 * 60_000));
      await dispatcher().tick(at);

      expect(typesSentTo(urls.concrete)).toEqual(["audit.provider.rotated"]);
      expect(typesSentTo(urls.pr)).toEqual(["pr.criterion_verified"]);
      expect(typesSentTo(urls.audit)).toEqual([
        "audit.decision.filed",
        "audit.pr_criterion.verified",
        "audit.provider.rotated",
      ]);
      expect(typesSentTo(urls.decisions)).toEqual(["decision.filed"]);
      expect(typesSentTo(urls.inactive)).toEqual([]);
    });
  });

  describe("retry, dead letter and redelivery", () => {
    it("retries at 30 s and not before, dead-letters, and sends a failed redelivery back to the DLQ after one try", async () => {
      const created = await create({
        name: "SIEM",
        url: "https://siem.acme.dev/hook",
        eventFamilies: ["audit.*"],
      });
      await flush();
      scripted.fallback = { status: 503, body: "upstream unavailable" };

      const at = instant();
      await audit("provider.rotated", at);
      const rotatedRequests = () =>
        scripted.requests.filter(
          (request) => request.headers["X-Ouro-Event"] === "audit.provider.rotated",
        );

      await dispatcher().tick(at);
      expect(rotatedRequests()).toHaveLength(1);

      await dispatcher().tick(new Date(at.getTime() + 29_000));
      expect(rotatedRequests()).toHaveLength(1);

      await dispatcher().tick(new Date(at.getTime() + 30_000));
      expect(rotatedRequests()).toHaveLength(2);

      const deadLettered = async () =>
        bodyOf<WebhookDeliveryPageResource>(
          await asOwner(
            "get",
            `${BASE}/${created.endpoint.id}/deliveries?status=dead_lettered`,
          ).expect(200),
        ).items.filter((item) => item.eventType === "audit.provider.rotated");

      const [dead] = await deadLettered();
      expect(dead).toMatchObject({ attempt: 2, responseCode: 503, redeliverable: true });

      await asOwner(
        "post",
        `${BASE}/${created.endpoint.id}/deliveries/${dead.id}/redeliver`,
      ).expect(202);
      // Still failing: one try, then back to the DLQ — never a fresh retry schedule.
      await dispatcher().tick(new Date(at.getTime() + 40_000));
      await dispatcher().tick(new Date(at.getTime() + 3_600_000));

      expect(rotatedRequests()).toHaveLength(3);
      expect(
        new Set(rotatedRequests().map((request) => request.headers["X-Ouro-Delivery"])).size,
      ).toBe(1);
      expect((await deadLettered()).map((item) => item.attempt).sort()).toEqual([2, 3]);
    });
  });

  describe("the outbox", () => {
    it("commits an audit row and its outbox rows together — a failure at commit leaves neither", async () => {
      // A deferred constraint trigger raises at COMMIT: both rows were written, and both must go.
      await api.sql.query(`
        create or replace function ${SCHEMA_NAME}.gov490_refuse_commit() returns trigger
        language plpgsql as $$ begin raise exception 'injected commit failure'; end $$`);
      await api.sql.query(`
        create constraint trigger gov490_refuse_commit after insert on ${SCHEMA_NAME}.audit_events
          deferrable initially deferred
          for each row execute function ${SCHEMA_NAME}.gov490_refuse_commit()`);

      try {
        await expect(audit("decision.filed")).rejects.toThrow(/injected commit failure/);
      } finally {
        await api.sql.query(
          `drop trigger gov490_refuse_commit on ${SCHEMA_NAME}.audit_events;
           drop function ${SCHEMA_NAME}.gov490_refuse_commit();`,
        );
      }

      expect(await count("audit_events")).toBe(0);
      expect(await count("webhook_outbox")).toBe(0);

      await audit("decision.filed");

      expect(await count("audit_events")).toBe(1);
      expect(await count("webhook_outbox")).toBe(2);
    });
  });

  describe("secrets", () => {
    it("never discloses a signing secret — not in a list, a read, the delivery log, the outbox, a sent request or an error", async () => {
      const created = await create({
        name: "SIEM",
        url: "https://siem.acme.dev/hook",
        eventFamilies: ["audit.*"],
      });
      const id = created.endpoint.id;

      await asOwner("post", `${BASE}/${id}/ping`).expect(200);
      const rotated = bodyOf<WebhookSecretResource>(
        await asOwner("post", `${BASE}/${id}/rotate-secret`).expect(200),
      );
      await audit("provider.rotated");
      await dispatcher().tick(instant());

      const surfaces: string[] = [
        (await asOwner("get", BASE).expect(200)).text,
        (await asOwner("get", `${BASE}/${id}`).expect(200)).text,
        (await asOwner("get", `${BASE}/${id}/deliveries`).expect(200)).text,
        // Error bodies: a refused edit, a taken name, an unknown delivery.
        (
          await asOwner("patch", `${BASE}/${id}`)
            .send({ url: "http://siem.acme.dev/hook" })
            .expect(422)
        ).text,
        (
          await asOwner("post", BASE)
            .send({ name: "SIEM", url: "https://siem.acme.dev/other", eventFamilies: ["audit.*"] })
            .expect(409)
        ).text,
        (
          await asOwner(
            "post",
            `${BASE}/${id}/deliveries/00000000-0000-4000-8000-000000000000/redeliver`,
          ).expect(404)
        ).text,
        JSON.stringify(scripted.requests),
        JSON.stringify(
          (
            await api.sql.query(
              `select payload from ${SCHEMA_NAME}.webhook_outbox where organization_id = $1`,
              [workspace.id],
            )
          ).rows,
        ),
        JSON.stringify(
          (
            await api.sql.query(
              `select response_excerpt, error from ${SCHEMA_NAME}.webhook_deliveries where organization_id = $1`,
              [workspace.id],
            )
          ).rows,
        ),
      ];

      expect(scripted.requests.length).toBeGreaterThan(0);

      for (const surface of surfaces) {
        expect(surface).not.toContain(created.secret);
        expect(surface).not.toContain(rotated.secret);
        expect(surface).not.toContain("whsec_");
      }
    });
  });
});
