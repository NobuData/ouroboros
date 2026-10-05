import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { AuditService } from "../audit/audit.service";
import { SCHEMA_NAME } from "../db/schema";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { WebhookDispatcher } from "../webhooks/webhook.dispatcher";
import { FixtureReceiver, receivedHeaders } from "../webhooks/webhook.receiver.fixture";
import type { HostResolver } from "../webhooks/webhook.ssrf";
import { WEBHOOK_RESOLVER, WEBHOOK_TRANSPORT } from "../webhooks/webhook.transport";
import type { WebhookSecretResource } from "../webhooks/webhooks.resources";
import { ScriptedTransport } from "../webhooks/webhooks.store.fixture";
import { AUDIT_EXPORT_ROWS_HEADER } from "./audit-plane.controller";
import { csvHeader, csvLine } from "./audit-plane.csv";
import type { AuditPlaneFilter } from "./audit-plane.filter";
import { AuditPlaneRepository } from "./audit-plane.repository";
import type {
  AuditPlaneEventResource,
  AuditPlanePage,
  AuditTodayResource,
} from "./audit-plane.resources";
import { AuditPurgeSweeper } from "./audit-purge.sweeper";

/**
 * The audit plane over HTTP on a migrated database (BR.2,
 * [#486](https://github.com/NobuData/ouroboros/issues/486)):
 *
 *   * **filters** over a seeded history, each dimension and in combination, against SQL truth;
 *   * **keyset paging** stable while events arrive mid-scroll;
 *   * **the today view** reproducing mockup 17's five rows from typed events — the bot's kind
 *     derived by V102's insert trigger, as an SQL writer gets it;
 *   * **the CSV export**: bounded, streamed, audited (`audit.exported`), equal to the view;
 *   * **the purge**: the `audit` tier honoured, the 90-day floor refused by the database,
 *     `audit.purged` written;
 *   * **fan-out**: the plane's events reach an `audit.*` endpoint, verified by BR.3's receiver;
 *   * **query plans**: every filter enters through an index over a 40,000-row history — an
 *     `EXPLAIN` assertion, not a stopwatch.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/audit-plane
 * ```
 */

const BASE = "/api/v1/settings/audit";
const DAY_MS = 86_400_000;

/** Every name is public. */
const resolver: HostResolver = () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]);

describe("the audit plane", () => {
  let api: ApiHarness;
  let ken: Person;
  let maya: Person;
  let workspace: Workspace;
  const transport = new ScriptedTransport();

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_WEBHOOK_DISPATCH_SECONDS: "300" }, [
      { provide: WEBHOOK_TRANSPORT, useValue: transport },
      { provide: WEBHOOK_RESOLVER, useValue: resolver },
    ]);
  });

  afterAll(() => api.close());

  beforeEach(async () => {
    transport.requests.length = 0;
    ken = await api.signIn({ displayName: "Ken Suenobu" });
    maya = await api.signIn({ displayName: "Maya Chen" });
    workspace = await api.workspace(ken);
    await api.join(workspace.id, maya, "admin");
  });

  afterEach(() => api.truncate());

  /** A request as somebody, in the workspace. */
  function as(person: Person, path: string) {
    return api.as(person)("get", path).set(TENANT_HEADER, workspace.id);
  }

  /** Every event of a query, following `nextCursor`. */
  async function everyPage(query: string): Promise<AuditPlaneEventResource[]> {
    const events: AuditPlaneEventResource[] = [];
    let cursor: string | null = null;

    do {
      const suffix: string = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
      const page: AuditPlanePage = bodyOf<AuditPlanePage>(
        await as(ken, `${BASE}?limit=7&${query}${suffix}`).expect(200),
      );
      events.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);

    return events;
  }

  /**
   * Plant one event the way an SQL writer does — `actor_kind` left to V102's trigger.
   *
   * @param event - The columns.
   * @returns The id.
   */
  async function plant(event: {
    actorId?: string | null;
    actorService?: string | null;
    action: string;
    subjectType?: string;
    subjectId?: string | null;
    detail?: Record<string, unknown>;
    at: Date;
    organizationId?: string;
  }): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.audit_events
         (organization_id, actor_id, actor_service, action, subject_type, subject_id, detail, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [
        event.organizationId ?? workspace.id,
        event.actorId ?? null,
        event.actorService ?? null,
        event.action,
        event.subjectType ?? "workspace",
        event.subjectId ?? null,
        JSON.stringify(event.detail ?? {}),
        event.at,
      ],
    );
    return rows[0].id;
  }

  /** Today in UTC at a wall-clock time. */
  function todayAt(hours: number, minutes: number): Date {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes),
    );
  }

  /** Mockup 17's five events, planted as their writers store them. */
  async function plantMockup(): Promise<void> {
    await plant({
      actorService: "ouroboros-app",
      action: "pr_revision.pushed",
      subjectType: "pr_revision",
      detail: { pr_number: 514, revision: 2, head_sha: "b7e41d0" },
      at: todayAt(14, 31),
    });
    await plant({
      actorId: ken.id,
      action: "provider.rotated",
      subjectType: "provider_connection",
      subjectId: "5eed000c-0000-4000-8000-000000000001",
      detail: { kind: "anthropic", outcome: "success" },
      at: todayAt(14, 12),
    });
    await plant({
      actorId: ken.id,
      action: "policy.published",
      subjectType: "org_policy",
      subjectId: workspace.id,
      detail: { version: 7, changes: "auto_merge:enabled" },
      at: todayAt(13, 48),
    });
    await plant({
      actorId: maya.id,
      action: "triage.waived",
      subjectType: "run",
      subjectId: "5eed0010-0000-4000-8000-000000000471",
      detail: { pr_number: 509, run_id: "5eed0010-0000-4000-8000-000000000471" },
      at: todayAt(13, 22),
    });
    await plant({
      action: "runner.marked_offline",
      subjectType: "runner",
      subjectId: "5eed0025-0000-4000-8000-000000000003",
      detail: { runner: "forge-03" },
      at: todayAt(12, 4),
    });
  }

  /** The ids SQL says match a predicate, newest first. */
  async function truth(predicate: string, params: unknown[] = []): Promise<string[]> {
    const { rows } = await api.sql.query<{ id: string }>(
      `select id from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and (${predicate})
        order by occurred_at desc, id desc`,
      [workspace.id, ...params],
    );
    return rows.map((row) => row.id);
  }

  describe("today", () => {
    it("reproduces mockup 17's five rows from typed events, with each actor's kind", async () => {
      await plantMockup();

      const today = bodyOf<AuditTodayResource>(await as(ken, `${BASE}/today`).expect(200));

      expect(today.rows.map((row) => `${row.time}  ${row.actor}  ${row.event}`)).toEqual([
        "14:31  ouroboros-app[bot]  pushed PR #514 rev 2",
        "14:12  Ken  rotated Anthropic API key",
        "13:48  Ken  enabled auto-merge (policy v7)",
        "13:22  Maya  approved waiver on PR #509",
        "12:04  system  runner forge-03 marked offline",
      ]);
      expect(today.rows.map((row) => row.actorKind)).toEqual([
        "bot",
        "human",
        "human",
        "human",
        "system",
      ]);
      expect(today).toMatchObject({ timeZone: "UTC", retainedDays: 400, more: false });
    });

    it("keeps an erased person's events a human's", async () => {
      await plantMockup();
      await api.sql.query(`delete from ${SCHEMA_NAME}."user" where "id" = $1`, [maya.id]);

      const today = bodyOf<AuditTodayResource>(await as(ken, `${BASE}/today`).expect(200));

      expect(today.rows[3]).toMatchObject({
        actorKind: "human",
        actor: "former member",
        event: "approved waiver on PR #509",
      });
    });
  });

  describe("filters", () => {
    beforeEach(async () => {
      await plantMockup();
      // A spread of older history, and another workspace's events that must never appear.
      for (let n = 0; n < 30; n += 1) {
        await plant({
          actorId: n % 3 === 0 ? maya.id : null,
          actorService: n % 3 === 1 ? "devops-bot" : null,
          action: n % 2 === 0 ? "runner.job_submitted" : "policy.dry_run_changed",
          subjectType: "run",
          subjectId: `run-${String(n % 4)}`,
          detail: n % 5 === 0 ? { pr_number: 509 } : { run_id: `run-${String(n % 4)}` },
          at: new Date(Date.now() - (n + 1) * DAY_MS),
        });
      }
      const other = await api.workspace(maya);
      await plant({
        organizationId: other.id,
        actorService: "ouroboros-app",
        action: "pr_revision.pushed",
        at: new Date(),
      });
    });

    it.each([
      ["actorKind=human", "actor_kind = 'human'"],
      ["actorKind=bot", "actor_kind = 'bot'"],
      ["actorKind=service", "actor_kind = 'service'"],
      ["actorKind=system", "actor_kind = 'system'"],
      ["actorService=devops-bot", "actor_service = 'devops-bot'"],
      ["action=policy.*", "plane = 'policy'"],
      ["action=runner.job_submitted", "action = 'runner.job_submitted'"],
      ["ref=pr:509", `detail @> '{"pr_number": 509}'`],
      ["ref=run:run-1", `subject_id = 'run-1' or detail @> '{"run_id": "run-1"}'`],
      ["ref=subject:run-2", "subject_id = 'run-2'"],
      ["actorKind=service&action=policy.*", "actor_kind = 'service' and plane = 'policy'"],
      [
        "actorKind=human&ref=pr:509&action=runner.*",
        `actor_kind = 'human' and detail @> '{"pr_number": 509}' and plane = 'runner'`,
      ],
    ])("filters %s exactly as SQL does", async (query, predicate) => {
      const ids = (await everyPage(query)).map((event) => event.id);

      expect(ids).toEqual(await truth(predicate));
      expect(ids.length).toBeGreaterThan(0);
    });

    it("filters one person, and a time range in combination with a plane", async () => {
      expect((await everyPage(`actorId=${maya.id}`)).map((event) => event.id)).toEqual(
        await truth("actor_id = $2", [maya.id]),
      );

      const from = new Date(Date.now() - 10.5 * DAY_MS).toISOString();
      const to = new Date(Date.now() - 2.5 * DAY_MS).toISOString();
      expect(
        (await everyPage(`from=${from}&to=${to}&action=policy.*`)).map((event) => event.id),
      ).toEqual(
        await truth("occurred_at >= $2 and occurred_at < $3 and plane = 'policy'", [from, to]),
      );
    });

    it("pages by keyset without duplicating or skipping while events arrive", async () => {
      const before = await truth("true");
      const first = bodyOf<AuditPlanePage>(await as(ken, `${BASE}?limit=10`).expect(200));

      // New events land between the first page and the rest.
      const audit = api.nest.get(AuditService, { strict: false });
      for (let n = 0; n < 3; n += 1) {
        await audit.record({
          organizationId: workspace.id,
          actorId: ken.id,
          action: "provider.tested",
          subjectType: "provider_connection",
          subjectId: "c",
          at: new Date(),
        });
      }

      const rest: AuditPlaneEventResource[] = [];
      let cursor = first.nextCursor;
      while (cursor !== null) {
        const page: AuditPlanePage = bodyOf<AuditPlanePage>(
          await as(ken, `${BASE}?limit=10&cursor=${encodeURIComponent(cursor)}`).expect(200),
        );
        rest.push(...page.items);
        cursor = page.nextCursor;
      }

      expect([...first.items, ...rest].map((event) => event.id)).toEqual(before);
    });

    it("refuses a member who is not an administrator, on every route", async () => {
      const jorge = await api.signIn({ displayName: "Jorge Ruiz" });
      await api.join(workspace.id, jorge, "member");

      await as(jorge, BASE).expect(403);
      await as(jorge, `${BASE}/today`).expect(403);
      await as(
        jorge,
        `${BASE}/export.csv?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z`,
      ).expect(403);
    });

    it("refuses a foreign cursor and an inverted range with a 422", async () => {
      expect((await as(ken, `${BASE}?cursor=bm90LWEtY3Vyc29y`).expect(422)).body).toMatchObject({
        code: "audit_cursor_invalid",
      });
      expect(
        (await as(ken, `${BASE}?from=2026-10-05T00:00:00Z&to=2026-10-04T00:00:00Z`).expect(422))
          .body,
      ).toMatchObject({ code: "audit_range_invalid" });
    });
  });

  describe("export", () => {
    beforeEach(plantMockup);

    it("streams the filtered view as CSV, row for row, and audits the export with its count", async () => {
      const from = new Date(Date.now() - 2 * DAY_MS).toISOString();
      const to = new Date(Date.now() + DAY_MS).toISOString();
      const query = `from=${from}&to=${to}&actorKind=human`;

      // The view as it stands when the export starts — the export's own row comes after.
      const view = await everyPage(query);
      const response = await as(ken, `${BASE}/export.csv?${query}`).expect(200);

      expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
      expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="audit-/);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers[AUDIT_EXPORT_ROWS_HEADER.toLowerCase()]).toBe("3");
      expect(response.text).toBe(csvHeader() + view.map(csvLine).join(""));

      const { rows } = await api.sql.query<{
        actor_id: string;
        actor_kind: string;
        detail: Record<string, unknown>;
      }>(
        `select actor_id, actor_kind, detail from ${SCHEMA_NAME}.audit_events
          where organization_id = $1 and action = 'audit.exported'`,
        [workspace.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actor_id: ken.id, actor_kind: "human" });
      expect(rows[0].detail).toMatchObject({
        from: new Date(from).toISOString(),
        actor_kind: "human",
        rows: 3,
      });
      // The end is clamped to the request, so the export's own row is never inside its range.
      expect(new Date(rows[0].detail.to as string).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("requires a bounded range of at most 366 days", async () => {
      expect(
        (await as(ken, `${BASE}/export.csv?to=2026-02-01T00:00:00Z`).expect(422)).body,
      ).toMatchObject({ code: "audit_export_range_required" });
      expect(
        (
          await as(
            ken,
            `${BASE}/export.csv?from=2024-01-01T00:00:00Z&to=2026-02-01T00:00:00Z`,
          ).expect(422)
        ).body,
      ).toMatchObject({ code: "audit_export_range_too_long" });
      expect(
        (
          await api.sql.query(
            `select 1 from ${SCHEMA_NAME}.audit_events where action = 'audit.exported'`,
          )
        ).rowCount,
      ).toBe(0);
    });

    it("publishes the export to an audit.* endpoint, which BR.3's receiver verifies", async () => {
      const created = bodyOf<WebhookSecretResource>(
        await api
          .as(ken)("post", "/api/v1/settings/webhooks")
          .set(TENANT_HEADER, workspace.id)
          .send({
            name: "SIEM",
            url: "https://siem.acme.dev/hook",
            eventFamilies: ["audit.*"],
            siem: true,
          })
          .expect(201),
      );
      transport.requests.length = 0;

      await as(ken, `${BASE}/export.csv?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z`).expect(
        200,
      );
      await api.nest.get(WebhookDispatcher, { strict: false }).tick(new Date(Date.now() + 2000));

      const exported = transport.requests.find(
        (request) => request.headers["X-Ouro-Event"] === "audit.audit.exported",
      );
      expect(exported).toBeDefined();
      const verdict = new FixtureReceiver(created.secret).verify({
        headers: receivedHeaders(exported?.headers ?? {}),
        body: exported?.body ?? "",
      });
      expect(verdict.accepted).toBe(true);
    });
  });

  describe("purge", () => {
    it("removes events past the audit tier, keeps the rest, and leaves audit.purged", async () => {
      const ancient = await plant({
        action: "runner.marked_offline",
        at: new Date(Date.now() - 500 * DAY_MS),
      });
      const kept = await plant({
        action: "runner.marked_offline",
        at: new Date(Date.now() - 100 * DAY_MS),
      });

      const report = await api.nest.get(AuditPurgeSweeper, { strict: false }).sweep();

      expect(report.refused).toEqual([]);
      expect(report.workspaces).toEqual([
        expect.objectContaining({ organizationId: workspace.id, days: 400, removed: 1, held: 0 }),
      ]);
      const ids = await truth("true");
      expect(ids).toContain(kept);
      expect(ids).not.toContain(ancient);

      const { rows } = await api.sql.query<{ actor_kind: string; detail: Record<string, unknown> }>(
        `select actor_kind, detail from ${SCHEMA_NAME}.audit_events
          where organization_id = $1 and action = 'audit.purged'`,
        [workspace.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_kind).toBe("system");
      expect(rows[0].detail).toMatchObject({ days: 400, removed: 1, held: 0 });
    });

    it("honours a workspace's own tier", async () => {
      await api
        .as(ken)("patch", "/api/v1/settings/retention")
        .set(TENANT_HEADER, workspace.id)
        .send({ classes: { audit: 90 } })
        .expect(200);
      const gone = await plant({
        action: "runner.marked_offline",
        at: new Date(Date.now() - 100 * DAY_MS),
      });

      await api.nest.get(AuditPurgeSweeper, { strict: false }).sweep();

      expect(await truth("true")).not.toContain(gone);
    });

    it("is refused by the database inside the 90-day floor, whatever the caller computed", async () => {
      await expect(
        api.sql.query(
          `select * from ${SCHEMA_NAME}.audit_events_purge($1, now() - interval '30 days', 10)`,
          [workspace.id],
        ),
      ).rejects.toMatchObject({ constraint: "audit_events_purge_cutoff_floor" });
    });
  });

  describe("query plans over a large history", () => {
    /** Rows per workspace — documented, and what the plans below are asserted against. */
    const HISTORY_ROWS = 20_000;

    beforeEach(async () => {
      const other = await api.workspace(maya);
      for (const organizationId of [workspace.id, other.id]) {
        await api.sql.query(
          `insert into ${SCHEMA_NAME}.audit_events
             (organization_id, actor_id, actor_service, action, subject_type, subject_id, detail, occurred_at)
           select $1,
                  case when g % 100 = 0 then $2 when g % 2 = 0 and g % 100 > 3 then $3 end,
                  case g % 100 when 1 then 'ouroboros-app' when 2 then 'devops-bot' end,
                  case g % 100 when 0 then 'policy.published' when 1 then 'pr_revision.pushed'
                               when 2 then 'runner.job_submitted' when 3 then 'triage.classified'
                               else 'provider.tested' end,
                  'run', 'subject-' || g,
                  case when g % 100 = 3 then jsonb_build_object('pr_number', g)
                       else jsonb_build_object('run_id', 'run-' || g) end,
                  now() - g * interval '1 minute'
             from generate_series(1, $4::integer) g`,
          [organizationId, maya.id, ken.id, HISTORY_ROWS],
        );
      }
      await api.sql.query(`analyze ${SCHEMA_NAME}.audit_events`);
    });

    /** The plan nodes of the page statement for a filter. */
    async function planOf(filter: AuditPlaneFilter): Promise<Record<string, unknown>[]> {
      const compiled = api.nest
        .get(AuditPlaneRepository, { strict: false })
        .pageQuery(workspace.id, filter, undefined, 51)
        .compile();
      const { rows } = await api.sql.query<{ "QUERY PLAN": [{ Plan: Record<string, unknown> }] }>(
        `explain (format json) ${compiled.sql}`,
        [...compiled.parameters],
      );
      const nodes: Record<string, unknown>[] = [];
      const walk = (node: Record<string, unknown>) => {
        nodes.push(node);
        for (const child of (node.Plans as Record<string, unknown>[] | undefined) ?? [])
          walk(child);
      };
      walk(rows[0]["QUERY PLAN"][0].Plan);
      return nodes;
    }

    it.each([
      ["no filter", {}, "audit_events_organization_occurred_at_idx"],
      ["actor kind", { actorKind: "bot" as const }, "audit_events_org_actor_kind_idx"],
      ["a person", { actorId: "MAYA" }, "audit_events_org_actor_idx"],
      ["a service", { actorService: "devops-bot" }, "audit_events_org_actor_service_idx"],
      ["a plane", { plane: "policy" }, "audit_events_org_plane_idx"],
      [
        "a subject",
        { ref: { kind: "subject" as const, value: "subject-7" } },
        "audit_events_org_subject_idx",
      ],
      ["a PR", { ref: { kind: "pr" as const, number: 503 } }, "audit_events_detail_refs_idx"],
    ])("enters %s through an index, never a sequential scan", async (_label, filter, index) => {
      const resolved: AuditPlaneFilter = "actorId" in filter ? { actorId: maya.id } : filter;
      const nodes = await planOf(resolved);

      expect(
        nodes.filter(
          (node) => node["Node Type"] === "Seq Scan" && node["Relation Name"] === "audit_events",
        ),
      ).toEqual([]);
      expect(nodes.map((node) => node["Index Name"])).toContain(index);
    });
  });
});
