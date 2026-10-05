import { ApiHarness, type Person } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import { SEEDED_PAYLOADS } from "../../decisions/decision.kinds.fixture";
import { INTERNAL_KEY_HEADER } from "../../engine/engine.contract";
import { ChannelsScheduler } from "../../inbox-channels/channels.scheduler";
import { ORG_DIGEST_FOOTER } from "../../inbox-channels/mail/decision-mail.compose";
import { DecisionMailService } from "../../inbox-channels/mail/decision-mail.service";
import { seedIngestBench, type IngestBench } from "../../ingest/ingest.fixture";
import type { RunOpenedResource } from "../../ingest/ingest.resources";
import { RecordingMailer } from "../../mail/mail.fixture";
import { MAILER, type MailMessage } from "../../mail/mailer";
import type { NotificationRouteResource } from "../../notification-routes/routes.resources";
import { NotificationRoutesScheduler } from "../../notification-routes/routes.scheduler";
import { OrgRouteSender } from "../../notification-routes/routes.sender";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";

/**
 * Org notification routes, server-side (BR.6, [#490](https://github.com/NobuData/ouroboros/issues/490);
 * the routes are BR.4's, [#488](https://github.com/NobuData/ouroboros/issues/488)).
 *
 *   * **Locked routes are refused by the server**, not only greyed out by the card: enabling a
 *     route on a channel that cannot deliver is `409 notification_route_locked` with the card's
 *     reason, and nothing is stored or audited. A locked route may be stored disabled. A row
 *     written enabled behind the API's back still never sends — the effective view is the second
 *     lock.
 *   * **Unlocked routes drive real sends** through the application's mailer at their configured
 *     time, once per slot, to the owners and administrators when the route names nobody.
 *   * **Org routes layer over per-person preferences** rather than replacing them: a person with
 *     their own digest and a muted kind gets both mails — the personal one honouring the mute and
 *     carrying action links, the org one ignoring it and carrying none — and switching either off
 *     leaves the other alone.
 *
 * The adversarial bar: deleting the lock check in `NotificationRoutesService.update` turns the
 * first case red, and dropping `delivering` from the sender's read turns the second.
 *
 * Clocks are explicit: the route sender is ticked at an instant the test names, the decision
 * mailer's `now()` is pinned to the same one, and both background schedulers are replaced by
 * nothing so neither sends on its own clock.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/settings/governance/routes
 * ```
 */

const BASE = "/api/v1/settings/notifications";

/** One day. */
const DAY_MS = 24 * 60 * 60 * 1000;

describe("org notification routes (#490)", () => {
  const mailer = new RecordingMailer();
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" }, [
      { provide: MAILER, useValue: mailer },
      { provide: NotificationRoutesScheduler, useValue: {} },
      { provide: ChannelsScheduler, useValue: {} },
    ]);
  });

  afterAll(() => api.close());

  beforeEach(() => {
    mailer.sent.length = 0;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await api.truncate();
  });

  /** The workspace a case acts in, its people and its one run. */
  interface Scene {
    readonly owner: Person;
    readonly admin: Person;
    readonly member: Person;
    readonly bench: IngestBench;
    readonly org: string;
    readonly runId: string;
  }

  /**
   * A workspace with an owner, an administrator and a member, and one run decisions can refer to.
   *
   * @returns The scene.
   */
  async function scene(): Promise<Scene> {
    const owner = await api.signUp();
    const bench = await seedIngestBench(api, owner);
    const admin = await api.signUp();
    const member = await api.signUp();

    await api.join(bench.workspace.id, admin, "admin");
    await api.join(bench.workspace.id, member, "member");

    const run = bodyOf<RunOpenedResource>(
      await api
        .anonymous("post", "/internal/runs")
        .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
        .send({ idempotencyKey: "open", ...bench.open })
        .expect(201),
    );

    return { owner, admin, member, bench, org: bench.workspace.id, runId: run.id };
  }

  /**
   * A call as somebody, in the scene's workspace.
   *
   * @param at - The scene.
   * @param person - Who.
   * @param method - The verb.
   * @param path - The path.
   * @returns The request.
   */
  function as(at: Scene, person: Person, method: "get" | "patch", path: string) {
    return api.as(person)(method, path).set(TENANT_HEADER, at.bench.workspace.slug);
  }

  /**
   * Save a route as the owner.
   *
   * @param at - The scene.
   * @param kind - The route.
   * @param body - The change.
   * @returns The request.
   */
  function route(at: Scene, kind: string, body: Record<string, unknown>) {
    return as(at, at.owner, "patch", `${BASE}/${kind}`).send(body);
  }

  /**
   * A minute boundary a little after now, and its `HH:MM` — a slot that is due at that instant.
   *
   * @returns The instant and its time of day.
   */
  function slot(): { now: Date; time: string } {
    const now = new Date(Math.ceil((Date.now() + 1000) / 60_000) * 60_000);

    return { now, time: now.toISOString().slice(11, 16) };
  }

  /**
   * Pin the decision mailer's clock — what the personal digest and the org digest's content read.
   *
   * @param now - The instant.
   */
  function pin(now: Date): void {
    jest.spyOn(api.nest.get(DecisionMailService, { strict: false }), "now").mockReturnValue(now);
  }

  /**
   * The digests one address received, personal or org — never the instant mails.
   *
   * @param email - The address.
   * @returns Them, oldest first.
   */
  function digestsTo(email: string): MailMessage[] {
    return mailer.to(email).filter((mail) => !mail.subject.startsWith("[Ouroboros] Needs you"));
  }

  /**
   * Rows of a table for the workspace.
   *
   * @param at - The scene.
   * @param table - The table.
   * @param where - An extra condition.
   * @returns How many.
   */
  async function count(at: Scene, table: string, where = "true"): Promise<number> {
    const { rows } = await api.sql.query<{ n: string }>(
      `select count(*) as n from ${SCHEMA_NAME}.${table} where organization_id = $1 and ${where}`,
      [at.org],
    );

    return Number(rows[0].n);
  }

  /**
   * File a decision about the scene's run.
   *
   * @param at - The scene.
   * @param kindId - The kind.
   * @returns The item's rendered question — what a digest shows for it.
   */
  async function file(at: Scene, kindId: string): Promise<string> {
    const { itemId } = await api.nest.get(DecisionKindRegistry, { strict: false }).emit({
      organizationId: at.org,
      kindId,
      payload: SEEDED_PAYLOADS[kindId],
      refs: [{ type: "run", id: at.runId, label: "loop #1" }],
      key: { plane: "suite", sourceRef: `run:${at.runId}:${kindId}` },
    });
    const { rows } = await api.sql.query<{ question: string }>(
      `select question from ${SCHEMA_NAME}.decision_items_rendered where id = $1`,
      [itemId],
    );

    return rows[0].question;
  }

  describe("locked routes", () => {
    it("refuses to enable a route whose channel cannot deliver, stores and audits nothing, and stores it disabled", async () => {
      const at = await scene();
      const refusals: [string, Record<string, unknown>, string, string][] = [
        ["needs_you_dm", { enabled: true }, "slack", "connect Slack first"],
        ["loop_failures", { enabled: true }, "pagerduty", "connect PagerDuty first"],
        ["daily_digest", { channel: "slack", enabled: true }, "slack", "connect Slack first"],
      ];

      for (const [kind, body, channel, reason] of refusals) {
        await route(at, kind, body)
          .expect(409)
          .expect((response) => {
            expect(response.body).toMatchObject({
              code: "notification_route_locked",
              details: { kind, channel, locked: true, reason },
            });
          });
      }

      expect(await count(at, "notification_routes")).toBe(0);
      expect(await count(at, "audit_events", "action = 'notification_route.updated'")).toBe(0);

      const stored = bodyOf<NotificationRouteResource>(
        await route(at, "daily_digest", { channel: "slack", enabled: false }).expect(200),
      );

      expect(stored).toMatchObject({
        channel: "slack",
        enabled: false,
        locked: true,
        lockedReason: "connect Slack first",
        delivering: false,
      });
    });

    it("never sends a locked route, even one written enabled behind the API's back", async () => {
      const at = await scene();
      const { now, time } = slot();

      await api.sql.query(
        `insert into ${SCHEMA_NAME}.notification_routes (organization_id, kind, channel, config, enabled)
         values ($1, 'daily_digest', 'slack', $2, true)`,
        [at.org, JSON.stringify({ time })],
      );
      pin(now);

      const report = await api.nest.get(OrgRouteSender, { strict: false }).tick(now);

      expect(report.outcomes).toEqual([]);
      expect(mailer.sent).toEqual([]);
      expect(
        bodyOf<NotificationRouteResource>(
          await as(at, at.member, "get", `${BASE}/daily_digest`).expect(200),
        ),
      ).toMatchObject({ enabled: true, locked: true, delivering: false });
    });
  });

  describe("unlocked routes", () => {
    it("sends the daily digest at its time, once, to the owners and administrators — and is an administrator's to change", async () => {
      const at = await scene();
      const { now, time } = slot();

      await as(at, at.member, "patch", `${BASE}/daily_digest`).send({ enabled: true }).expect(403);

      const saved = bodyOf<NotificationRouteResource>(
        await route(at, "daily_digest", { enabled: true, config: { time } }).expect(200),
      );

      expect(saved).toMatchObject({ channel: "email", enabled: true, delivering: true });

      const trail = await api.sql.query<{ detail: Record<string, unknown> }>(
        `select detail from ${SCHEMA_NAME}.audit_events
          where organization_id = $1 and action = 'notification_route.updated'`,
        [at.org],
      );

      expect(trail.rows.map((row) => row.detail)).toEqual([
        expect.objectContaining({
          kind: "daily_digest",
          previousSource: "default",
          previousEnabled: false,
          enabled: true,
          previousConfig: "{}",
          config: JSON.stringify({ time }),
        }),
      ]);

      pin(now);
      const sender = api.nest.get(OrgRouteSender, { strict: false });

      // A minute early: the latest slot is yesterday's, long past its grace.
      await sender.tick(new Date(now.getTime() - 60_000));
      expect(mailer.sent).toEqual([]);

      await sender.tick(now);

      expect(mailer.sent.map((mail) => mail.to).sort()).toEqual(
        [at.owner.email, at.admin.email].sort(),
      );
      expect(mailer.sent.every((mail) => mail.text.includes(ORG_DIGEST_FOOTER))).toBe(true);
      expect(mailer.to(at.member.email)).toEqual([]);

      // Once per slot.
      await sender.tick(new Date(now.getTime() + 60_000));
      expect(mailer.sent).toHaveLength(2);
      expect(await count(at, "notification_route_sends", "status = 'sent'")).toBe(2);
    });
  });

  describe("org routes over personal preferences", () => {
    it("sends both digests — the mute applies to the personal one only — and switching either off leaves the other", async () => {
      const at = await scene();
      const { now, time } = slot();

      // The administrator's own digest, at the same minute, with one kind muted and no instants.
      for (const person of [at.owner, at.admin]) {
        await api
          .as(person)("patch", "/api/v1/inbox/notifications")
          .set(TENANT_HEADER, at.bench.workspace.slug)
          .send(
            person === at.admin
              ? {
                  digestEnabled: true,
                  digestTime: time,
                  instantSeverity: "off",
                  mutedKinds: ["plan_sign_off"],
                }
              : { instantSeverity: "off" },
          )
          .expect(200);
      }

      const needsHuman = await file(at, "run_needs_human");
      const signOff = await file(at, "plan_sign_off");

      await route(at, "daily_digest", {
        enabled: true,
        config: { time, recipients: [at.admin.email] },
      }).expect(200);

      const mail = api.nest.get(DecisionMailService, { strict: false });
      const sender = api.nest.get(OrgRouteSender, { strict: false });

      pin(now);
      await mail.pass();
      await sender.tick(now);

      const [first, second] = [
        digestsTo(at.admin.email).filter((sent) => !sent.text.includes(ORG_DIGEST_FOOTER)),
        digestsTo(at.admin.email).filter((sent) => sent.text.includes(ORG_DIGEST_FOOTER)),
      ];

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);

      const [personal] = first;
      const [org] = second;

      expect(personal.text).toContain(needsHuman);
      expect(personal.text).not.toContain(signOff);
      expect(personal.text).toContain("/api/v1/inbox/answer/");

      expect(org.text).toContain(needsHuman);
      expect(org.text).toContain(signOff);
      expect(org.text).not.toContain("/api/v1/inbox/answer/");

      // The next day the org route is off: the personal digest still goes.
      const tomorrow = new Date(now.getTime() + DAY_MS);

      await route(at, "daily_digest", { enabled: false }).expect(200);
      mailer.sent.length = 0;
      pin(tomorrow);
      await mail.pass();
      await sender.tick(tomorrow);

      expect(
        digestsTo(at.admin.email).map((sent) => sent.text.includes(ORG_DIGEST_FOOTER)),
      ).toEqual([false]);

      // The day after, the personal digest is off and the org route back on: the org one goes.
      const later = new Date(now.getTime() + 2 * DAY_MS);

      await route(at, "daily_digest", { enabled: true }).expect(200);
      await api
        .as(at.admin)("patch", "/api/v1/inbox/notifications")
        .set(TENANT_HEADER, at.bench.workspace.slug)
        .send({ digestEnabled: false })
        .expect(200);
      mailer.sent.length = 0;
      pin(later);
      await mail.pass();
      await sender.tick(later);

      expect(
        digestsTo(at.admin.email).map((sent) => sent.text.includes(ORG_DIGEST_FOOTER)),
      ).toEqual([true]);
    });
  });
});
