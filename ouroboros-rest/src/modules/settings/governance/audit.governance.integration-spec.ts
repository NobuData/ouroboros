import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { analyze, seedSeededIdsWorkspace } from "../../analyzer/analyzer.integration.fixture";
import { AUDIT_EXPORT_ROWS_HEADER } from "../../audit-plane/audit-plane.controller";
import { csvHeader, csvLine } from "../../audit-plane/audit-plane.csv";
import type {
  AuditPlaneEventResource,
  AuditPlanePage,
} from "../../audit-plane/audit-plane.resources";
import { AuditPurgeSweeper } from "../../audit-plane/audit-purge.sweeper";
import { SCHEMA_NAME } from "../../db/schema";
import { LogRetentionSweeper } from "../../farm/logs/log.retention";
import {
  DAY_MS,
  keptOf,
  plantLoopData,
  retentionBench,
  sweepLoopData,
} from "../../retention/retention.integration.fixture";
import type { RetentionSettingsResource } from "../../retention/retention.resources";
import { RetentionPolicyService } from "../../retention/retention.service";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { ArtifactRetentionSweeper } from "../../test-results-read/artifact.retention";

/**
 * The audit plane and the retention tiers as governance (BR.6,
 * [#490](https://github.com/NobuData/ouroboros/issues/490)) — what mockup 17's *retained 400d*
 * promises, held against the real sweeps and the real export. The per-module suites
 * (`audit-plane.integration-spec.ts`, `retention.integration-spec.ts`) prove each feature works;
 * this one closes the cases they leave open, written so that a broken control turns it red:
 *
 *   * **filters** — `repo:` and `key:` references, an exact action combined with a reference and an
 *     actor kind, the `from`-inclusive/`to`-exclusive boundary, an empty answer;
 *   * **keyset paging** across a page boundary of identical timestamps, with parallel writes landing
 *     mid-scroll — at the cursor's own instant and newer — and no row duplicated or skipped;
 *   * **the export** equal to the view under a reference filter across several stream batches,
 *     formula cells neutralised, its own `audit.exported` row counting exactly its lines;
 *   * **the purge** — a referenced event held and counted, no `audit.purged` when nothing went, a
 *     sub-floor cutoff refused by the sweeper before the database and by the database when the
 *     sweeper's clock is lied to, and the API floor at exactly 90 days;
 *   * **retention** — a tier change moves only its own class's cutoff, the defaults delete nothing
 *     inside them, and every sweep's tombstone count reaches the card.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/settings/governance/audit
 * ```
 */

const AUDIT = "/api/v1/settings/audit";
const RETENTION = "/api/v1/settings/retention";

/** The artifact default this suite's deployment sets — distinct from the loop classes' 30. */
const ARTIFACT_DEFAULT_DAYS = 60;

describe("audit and retention governance", () => {
  let api: ApiHarness;
  let volume: string;
  let ken: Person;
  let workspace: Workspace;

  beforeAll(async () => {
    volume = await mkdtemp(join(tmpdir(), "ouro-governance-audit-"));
    api = await ApiHarness.start({
      OURO_ARTIFACT_STORE: "local",
      OURO_ARTIFACT_DIR: volume,
      OURO_ARTIFACT_RETENTION_DAYS: String(ARTIFACT_DEFAULT_DAYS),
    });
  });

  afterAll(async () => {
    await api.close();
    await rm(volume, { recursive: true, force: true });
  });

  beforeEach(async () => {
    ken = await api.signIn({ displayName: "Ken Suenobu" });
    workspace = await api.workspace(ken);
  });

  afterEach(() => api.truncate());

  /** A read as somebody, in the workspace. */
  function as(person: Person, path: string) {
    return api.as(person)("get", path).set(TENANT_HEADER, workspace.id);
  }

  /** A retention save as the owner. */
  function retention(body: object) {
    return api.as(ken)("patch", RETENTION).set(TENANT_HEADER, workspace.id).send(body);
  }

  /**
   * Every event of a query, following `nextCursor`.
   *
   * @param query - The filter, as a query string.
   * @param limit - The page size.
   * @param between - Run after the first page, before the rest — a write landing mid-scroll.
   * @returns The events, in page order.
   */
  async function everyPage(
    query: string,
    limit = 200,
    between?: () => Promise<unknown>,
  ): Promise<AuditPlaneEventResource[]> {
    const events: AuditPlaneEventResource[] = [];
    let cursor: string | null = null;
    let first = true;

    do {
      const suffix: string = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
      const page: AuditPlanePage = bodyOf<AuditPlanePage>(
        await as(ken, `${AUDIT}?limit=${String(limit)}&${query}${suffix}`).expect(200),
      );
      events.push(...page.items);
      cursor = page.nextCursor;
      if (first && between !== undefined) await between();
      first = false;
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
  }): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.audit_events
         (organization_id, actor_id, actor_service, action, subject_type, subject_id, detail, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [
        workspace.id,
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

  /**
   * Plant many events in one statement, each `minutes` apart going back from `newest`.
   *
   * @param count - How many.
   * @param newest - The first one's instant.
   * @param action - Their action.
   * @param detail - Their detail.
   */
  async function plantMany(
    count: number,
    newest: Date,
    action: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.audit_events
         (organization_id, actor_id, action, subject_type, subject_id, detail, occurred_at)
       select $1, $2, $3, 'run', 'subject-' || g, $4::jsonb, $5::timestamptz - g * interval '1 minute'
         from generate_series(0, $6::integer - 1) g`,
      [workspace.id, ken.id, action, JSON.stringify(detail), newest, count],
    );
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

  /** How many of the workspace's events carry an action. */
  async function countOf(action: string): Promise<number> {
    const { rows } = await api.sql.query<{ count: string }>(
      `select count(*) as count from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and action = $2`,
      [workspace.id, action],
    );
    return Number(rows[0].count);
  }

  describe("filters the per-module suite leaves open", () => {
    const REPO = "acme-robotics/helios-firmware";
    const KEY = "5eed000c-0000-4000-8000-000000000001";

    beforeEach(async () => {
      const now = Date.now();
      await plant({
        actorId: ken.id,
        action: "repo.enabled",
        subjectType: "repository",
        subjectId: REPO,
        at: new Date(now - DAY_MS),
      });
      await plant({
        actorService: "devops-bot",
        action: "runner.job_submitted",
        subjectType: "build_job",
        subjectId: "job-1",
        detail: { repo: REPO, run_id: "run-1" },
        at: new Date(now - 2 * DAY_MS),
      });
      await plant({
        actorId: ken.id,
        action: "runner.job_submitted",
        subjectType: "build_job",
        subjectId: "job-2",
        detail: { repo: "acme-robotics/other", run_id: "run-1" },
        at: new Date(now - 3 * DAY_MS),
      });
      await plant({
        actorId: ken.id,
        action: "runner.job_canceled",
        subjectType: "run",
        subjectId: "run-1",
        at: new Date(now - 4 * DAY_MS),
      });
      await plant({
        actorId: ken.id,
        action: "provider.rotated",
        subjectType: "provider_connection",
        subjectId: KEY,
        detail: { kind: "anthropic" },
        at: new Date(now - 5 * DAY_MS),
      });
    });

    it.each([
      [`ref=repo:${REPO}`, `subject_id = '${REPO}' or detail @> '{"repo": "${REPO}"}'`, 2],
      [`ref=key:${KEY}`, `subject_id = '${KEY}'`, 1],
      [
        "action=runner.job_submitted&ref=run:run-1&actorKind=human",
        `action = 'runner.job_submitted' and actor_kind = 'human'
           and (subject_id = 'run-1' or detail @> '{"run_id": "run-1"}')`,
        1,
      ],
      [
        "action=runner.job_submitted&ref=run:run-1",
        `action = 'runner.job_submitted' and (subject_id = 'run-1' or detail @> '{"run_id": "run-1"}')`,
        2,
      ],
    ])("filters %s exactly as SQL does", async (query, predicate, expected) => {
      const ids = (await everyPage(query, 2)).map((event) => event.id);

      expect(ids).toEqual(await truth(predicate));
      expect(ids).toHaveLength(expected);
    });

    it("counts `from` in and `to` out at the exact instant", async () => {
      const at = new Date(Date.now() - 10 * DAY_MS);
      const id = await plant({ action: "runner.marked_offline", at });
      const instant = encodeURIComponent(at.toISOString());
      const later = encodeURIComponent(new Date(at.getTime() + 1).toISOString());

      expect((await everyPage(`from=${instant}&to=${later}`)).map((event) => event.id)).toEqual([
        id,
      ]);
      expect(await everyPage(`to=${instant}&action=runner.marked_offline`)).toEqual([]);
    });

    it("answers a filter that matches nothing with an empty page and no cursor", async () => {
      const page = bodyOf<AuditPlanePage>(
        await as(ken, `${AUDIT}?actorService=nobody`).expect(200),
      );

      expect(page).toMatchObject({ items: [], nextCursor: null });
    });
  });

  describe("keyset paging", () => {
    it("crosses a page boundary of identical instants while parallel writes land, skipping and repeating nothing", async () => {
      const tie = new Date(Date.now() - DAY_MS);
      for (let n = 0; n < 23; n += 1) {
        await plant({ action: "runner.job_submitted", subjectId: `tie-${String(n)}`, at: tie });
      }
      await plantMany(9, new Date(tie.getTime() - 60_000), "runner.job_submitted", {});
      const before = await truth("true");
      const landed: string[] = [];

      const seen = await everyPage("", 7, async () => {
        // Six writers at once: three at the cursor's own instant, three newer than every page.
        landed.push(
          ...(await Promise.all(
            [tie, tie, tie, new Date(), new Date(), new Date()].map((at, n) =>
              plant({ action: "runner.marked_offline", subjectId: `late-${String(n)}`, at }),
            ),
          )),
        );
      });
      const ids = seen.map((event) => event.id);

      // Every row that existed is there once, in order; anything else is a row that landed
      // behind the cursor — never one that landed ahead of it.
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.filter((id) => before.includes(id))).toEqual(before);
      expect(ids.filter((id) => !before.includes(id)).every((id) => landed.includes(id))).toBe(
        true,
      );
      for (const newer of landed.slice(3)) expect(ids).not.toContain(newer);
    });
  });

  describe("the export", () => {
    it("equals the view under a reference filter across several stream batches, and audits exactly its lines", async () => {
      const newest = new Date(Date.now() - DAY_MS);
      await plantMany(1203, newest, "runner.job_submitted", { run_id: "run-7" });
      await plantMany(300, newest, "runner.job_submitted", { run_id: "run-8" });
      const from = new Date(Date.now() - 5 * DAY_MS).toISOString();
      const to = new Date().toISOString();
      const query = `from=${from}&to=${to}&action=runner.job_submitted&ref=run:run-7`;

      const view = await everyPage(query);
      const response = await as(ken, `${AUDIT}/export.csv?${query}`).expect(200);
      const lines = response.text.split("\r\n").filter((line) => line !== "");

      expect(view).toHaveLength(1203);
      expect(response.text).toBe(csvHeader() + view.map(csvLine).join(""));
      expect(response.headers[AUDIT_EXPORT_ROWS_HEADER.toLowerCase()]).toBe("1203");
      expect(lines).toHaveLength(1204);

      const { rows } = await api.sql.query<{ detail: { rows: number } }>(
        `select detail from ${SCHEMA_NAME}.audit_events
          where organization_id = $1 and action = 'audit.exported'`,
        [workspace.id],
      );
      expect(rows.map((row) => row.detail.rows)).toEqual([lines.length - 1]);
    });

    it("neutralises every cell a spreadsheet would run as a formula", async () => {
      const at = new Date(Date.now() - DAY_MS);
      for (const subjectId of ['=HYPERLINK("http://evil.test")', "+1+1", "-2+3", "@SUM(A1)"]) {
        await plant({ action: "runner.marked_offline", subjectType: "runner", subjectId, at });
      }
      const from = new Date(Date.now() - 2 * DAY_MS).toISOString();
      const to = new Date().toISOString();

      const csv = (await as(ken, `${AUDIT}/export.csv?from=${from}&to=${to}`).expect(200)).text;

      expect(csv).toContain(`,"'=HYPERLINK(""http://evil.test"")",`);
      expect(csv).toContain(",'+1+1,");
      expect(csv).toContain(",'-2+3,");
      expect(csv).toContain(",'@SUM(A1),");
      // No cell anywhere starts with a bare formula lead.
      expect(csv).not.toMatch(/(^|,|\r\n)"?[=+\-@]/);
    });
  });

  describe("the purge", () => {
    it("holds an event an applied suggestion still references, and counts it", async () => {
      await seedSeededIdsWorkspace(api, workspace);
      await analyze(api, workspace);
      const { rows } = await api.sql.query<{ id: string }>(
        `select id from ${SCHEMA_NAME}.analysis_suggestions where organization_id = $1 limit 1`,
        [workspace.id],
      );
      const suggestion = rows[0].id;
      const appliedAt = new Date(Date.now() - 500 * DAY_MS);
      const applied = await plant({
        actorId: ken.id,
        action: "analysis_suggestion.applied",
        subjectType: "analysis_suggestion",
        subjectId: suggestion,
        at: appliedAt,
      });
      await api.sql.query(
        `update ${SCHEMA_NAME}.analysis_suggestions
            set status = 'applied', resolved_by = $2, resolved_at = $3, applied_event_id = $4
          where id = $1`,
        [suggestion, ken.id, appliedAt, applied],
      );
      const expired = await plant({
        action: "runner.marked_offline",
        at: new Date(Date.now() - 500 * DAY_MS),
      });

      const report = await api.nest.get(AuditPurgeSweeper, { strict: false }).sweep();

      expect(report.workspaces).toEqual([
        expect.objectContaining({ organizationId: workspace.id, removed: 1, held: 1 }),
      ]);
      const ids = await truth("true");
      expect(ids).toContain(applied);
      expect(ids).not.toContain(expired);
      const purged = await api.sql.query<{ detail: Record<string, unknown> }>(
        `select detail from ${SCHEMA_NAME}.audit_events
          where organization_id = $1 and action = 'audit.purged'`,
        [workspace.id],
      );
      expect(purged.rows.map((row) => row.detail)).toEqual([
        expect.objectContaining({ removed: 1, held: 1 }),
      ]);
    });

    it("writes no audit.purged when nothing expired", async () => {
      await plant({ action: "runner.marked_offline", at: new Date(Date.now() - 399 * DAY_MS) });

      const report = await api.nest.get(AuditPurgeSweeper, { strict: false }).sweep();

      expect(report).toMatchObject({ removed: 0, held: 0, workspaces: [], refused: [] });
      expect(await countOf("audit.purged")).toBe(0);
    });

    it("refuses a sub-floor cutoff before it reaches the database, and touches nothing", async () => {
      const old = await plant({
        action: "runner.marked_offline",
        at: new Date(Date.now() - 500 * DAY_MS),
      });
      const recent = await plant({
        action: "runner.marked_offline",
        at: new Date(Date.now() - 50 * DAY_MS),
      });
      const now = new Date();
      jest.spyOn(api.nest.get(RetentionPolicyService), "cutoffs").mockResolvedValue({
        dataClass: "audit",
        fallback: new Date(now.getTime() - 30 * DAY_MS),
        byOrganization: new Map(),
      });

      const report = await api.nest.get(AuditPurgeSweeper, { strict: false }).sweep();

      expect(report.refused).toContain(workspace.id);
      expect(report.removed).toBe(0);
      expect(await truth("true")).toEqual([recent, old]);
    });

    it("is stopped by the database when the sweeper's clock is a year fast", async () => {
      const sweeper = api.nest.get(AuditPurgeSweeper, { strict: false });
      const kept = await plant({
        action: "runner.marked_offline",
        at: new Date(Date.now() - 100 * DAY_MS),
      });
      // The sweeper believes it is a year later, so 400 days back is only 35 days ago — and its
      // own check, computed on the same lie, passes.
      jest.spyOn(sweeper, "now").mockReturnValue(new Date(Date.now() + 365 * DAY_MS));

      await expect(sweeper.sweep()).rejects.toMatchObject({
        constraint: "audit_events_purge_cutoff_floor",
      });
      expect(await truth("true")).toEqual([kept]);
    });

    it("accepts an audit tier of exactly 90 days and refuses 89", async () => {
      const refused = await retention({ classes: { audit: 89 } }).expect(422);
      expect(refused.body).toMatchObject({
        code: "retention_out_of_bounds",
        details: { refusals: [{ dataClass: "audit", days: 89, reason: "below_floor", floor: 90 }] },
      });

      await retention({ classes: { audit: 90 } }).expect(200);
    });
  });

  describe("retention tiers against every sweep", () => {
    it("moves only the changed class's cutoff — audit and loop data independently", async () => {
      const bench = await retentionBench(api);
      workspace = { id: bench.at.id, slug: bench.at.slug, name: "Harness Workspace" };
      ken = bench.owner;
      const loop = await plantLoopData(api, bench.at, bench.poolId, 20 * DAY_MS);
      const older = await plant({
        action: "runner.marked_offline",
        at: new Date(Date.now() - 100 * DAY_MS),
      });
      const newer = await plant({
        action: "runner.marked_offline",
        at: new Date(Date.now() - 85 * DAY_MS),
      });
      const purge = () => api.nest.get(AuditPurgeSweeper, { strict: false }).sweep();

      expect(await sweepLoopData(api)).toEqual({ logs: 0, artifacts: 0, transcripts: 0 });
      expect((await purge()).removed).toBe(0);

      await retention({ classes: { audit: 90 } }).expect(200);
      expect((await purge()).removed).toBe(1);
      expect(await sweepLoopData(api)).toEqual({ logs: 0, artifacts: 0, transcripts: 0 });
      expect(await keptOf(api, loop)).toEqual({ logs: true, artifact: true, transcript: true });

      await retention({ loopDays: 7 }).expect(200);
      expect(await sweepLoopData(api)).toEqual({ logs: 1, artifacts: 1, transcripts: 1 });
      expect((await purge()).removed).toBe(0);
      expect(await truth("action = 'runner.marked_offline'")).toEqual([newer]);
      expect(older).not.toBe(newer);
    });

    it("deletes nothing inside the defaults on a workspace that never stored a tier", async () => {
      const bench = await retentionBench(api);
      workspace = { id: bench.at.id, slug: bench.at.slug, name: "Harness Workspace" };
      ken = bench.owner;
      const loop = await plantLoopData(api, bench.at, bench.poolId, 29 * DAY_MS);
      const artifactOnly = await plantLoopData(
        api,
        bench.at,
        bench.poolId,
        (ARTIFACT_DEFAULT_DAYS - 1) * DAY_MS,
      );
      const audit = await plant({
        action: "runner.marked_offline",
        at: new Date(Date.now() - 399 * DAY_MS),
      });

      const card = bodyOf<RetentionSettingsResource>(await as(ken, RETENTION).expect(200));
      expect(card.classes.map((tier) => [tier.dataClass, tier.days, tier.source])).toEqual([
        ["transcripts", 30, "default"],
        ["build_logs", 30, "default"],
        ["artifacts", ARTIFACT_DEFAULT_DAYS, "default"],
        ["audit", 400, "default"],
      ]);

      await sweepLoopData(api);
      await api.nest.get(AuditPurgeSweeper, { strict: false }).sweep();

      expect(await keptOf(api, loop)).toEqual({ logs: true, artifact: true, transcript: true });
      // Past the loop classes' 30 days, inside the deployment's artifact default.
      expect(await keptOf(api, artifactOnly)).toEqual({
        logs: false,
        artifact: true,
        transcript: false,
      });
      expect(await truth("true")).toContain(audit);
      const { rows } = await api.sql.query(
        `select 1 from ${SCHEMA_NAME}.retention_policies where organization_id = $1`,
        [workspace.id],
      );
      expect(rows).toEqual([]);
    });

    it("reports each sweep's tombstone count on the card — build logs, artifacts and audit", async () => {
      const bench = await retentionBench(api);
      workspace = { id: bench.at.id, slug: bench.at.slug, name: "Harness Workspace" };
      ken = bench.owner;
      await plantLoopData(api, bench.at, bench.poolId, (ARTIFACT_DEFAULT_DAYS + 5) * DAY_MS);
      await plant({ action: "runner.marked_offline", at: new Date(Date.now() - 500 * DAY_MS) });
      await plant({ action: "runner.marked_offline", at: new Date(Date.now() - 450 * DAY_MS) });

      // The card reports a tick's counts; drive each sweeper's tick directly.
      for (const sweeper of [LogRetentionSweeper, ArtifactRetentionSweeper, AuditPurgeSweeper]) {
        await api.nest.get<{ tick: () => Promise<void> }>(sweeper, { strict: false }).tick();
      }

      const card = bodyOf<RetentionSettingsResource>(await as(ken, RETENTION).expect(200));
      const removed = new Map(
        card.classes.map((tier) => [tier.dataClass, tier.lastSweep?.removed]),
      );
      expect(removed.get("build_logs")).toBe(1);
      expect(removed.get("artifacts")).toBe(1);
      expect(removed.get("audit")).toBe(2);
    });
  });
});
