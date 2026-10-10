/* eslint-disable @typescript-eslint/require-await -- fakes answer at once; async keeps the real signatures */
/**
 * The regression watch on the real schema (V115, V118, V124) — #623.
 *
 * A synthetic drift walks the whole chain: detected → bisected to a planted culprit on real
 * `build_jobs` → a forensics investigation with the bisect in its ledger → a Planning draft →
 * the fix's ticket, run and merged pull request. Two stand-ins: the telemetry tool answers the
 * readings the fixture sets (its own SQL is #619's suite), and the engine's candidate line
 * comes from a recorded reader, as in `code-bisect.integration-spec.ts`.
 */

import request from "supertest";

import { ApiHarness, type Person } from "../../../testing/harness.fixture";
import { AuditService } from "../../audit/audit.service";
import { BacklogQueueService } from "../../backlog/queue.service";
import { SCHEMA_NAME } from "../../db/schema";
import { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import { bisectCommitsSchema } from "../../engine/engine.code.contract";
import { INTERNAL_KEY_HEADER } from "../../engine/engine.contract";
import { FarmJobsService } from "../../farm/dispatch/jobs.service";
import { BatchesService } from "../../planning/batches.service";
import {
  callAs,
  insertTickets,
  planningWorkspace,
  type PlanningWorkspace,
} from "../../planning/planning.integration.fixture";
import { CodeBisectRepository } from "../code/code-bisect.repository";
import { CodeBisectService } from "../code/code-bisect.service";
import type { CodeReader } from "../code/code.reader";
import { ResearchEstimateService } from "../estimate.service";
import type { InvestigationDispatchService } from "../loop/investigation-dispatch.service";
import type { ResearchToolRegistry } from "../tools/research-tool.registry";
import { ResearchToolRepository } from "../tools/research-tool.repository";
import { NEEDS_REPRO_NO_TEST, RegressionWatchChain } from "./watch.chain";
import { watchMovedOnDetector } from "./watch.inbox";
import { WatchRepository } from "./watch.repository";
import type { WatchCardResource, WatchSettingsResource } from "./watch.resources";
import { RegressionWatchService } from "./watch.service";

const BASE = "/api/v1/research/regression-watch";
const REPO = "acme/helios-firmware";
const CASE = "29f70bbc9eaa22505445bbf2378dc743e5b177119c5a09cdcde73870d0867560";
const METRIC = `${CASE}:hover_drift_cm`;

/** Twelve candidates; the culprit is the eighth. */
const COMMITS = Array.from({ length: 12 }, (_, index) =>
  (index + 1).toString(16).padStart(40, "c"),
);
const CULPRIT = 7;

const HOVER = {
  repository: REPO,
  source: "case_metric",
  key: METRIC,
  class: "accuracy",
  windowDays: 7,
  replay: { pool: "hil-rig", command: ["west", "twister", "-T", "tests/hil/hover"] },
  nightlyRef: "nightly",
};

/** A sample reading, as the telemetry tool reports one. */
function reading(median: number, n = 30, spread = 0.1) {
  return {
    status: "ok",
    window: "2026-10-03T00:00:00.000Z..2026-10-10T00:00:00.000Z",
    from: "2026-10-03T00:00:00.000Z",
    to: "2026-10-10T00:00:00.000Z",
    value: median,
    unit: "cm",
    n,
    basis: "samples",
    median,
    spread,
    spreadKind: "iqr",
  };
}

describe("the regression watch, on the database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(async () => {
    jest.restoreAllMocks();
    await api.truncate();
  });

  /** A workspace that can watch, bisect and draft, and the watch over it. */
  async function bench() {
    const workspace = await planningWorkspace(api);
    const org = workspace.bench.id;
    const { rows: orgs } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_orgs (organization_id, login, enabled)
       values ($1, 'acme', true) returning id`,
      [org],
    );
    const { rows: repos } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_repos (org_id, name, enabled)
       values ($1, 'helios-firmware', true) returning id`,
      [orgs[0].id],
    );
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.runner_pools (organization_id, name, executor, image, tags)
       values ($1, 'hil-rig', 'shell', null, '[]')`,
      [org],
    );

    const telemetry = { baseline: reading(5), current: reading(5.7, 12) as object };
    const tools = {
      find: (slug: string) =>
        slug !== "telemetry"
          ? undefined
          : {
              query: async (_context: unknown, query: { op: string }) => ({
                payload:
                  query.op === "metric_window"
                    ? telemetry.baseline
                    : { status: "ok", a: telemetry.baseline, b: telemetry.current },
                sources: [
                  {
                    kind: "telemetry",
                    title: "hover_drift_cm — baseline:v2.0.4 vs the nightly window",
                    locator: `telemetry://case/${CASE}/hover_drift_cm/baseline:v2.0.4-vs-2026-10-03T00:00:00Z..2026-10-10T00:00:00Z`,
                    retrievedAt: "2026-10-10T02:00:00.000Z",
                    contentHash: `sha256:${"a".repeat(64)}`,
                    excerpt: "hover_drift_cm: +14% — median 5 cm vs median 5.7 cm.",
                    meta: { op: "compare" },
                  },
                ],
                usage: { tokens: 0 },
              }),
            },
    } as unknown as ResearchToolRegistry;

    const line = bisectCommitsSchema.parse({
      clone: { repository: REPO, fetched_at: "2026-10-09T06:00:00Z", stale: false },
      good: "v2.0.4",
      bad: "nightly",
      good_sha: "0".repeat(40),
      bad_sha: COMMITS[11],
      bad_ref_name: "refs/heads/nightly",
      commits: COMMITS,
      max_steps: 4,
    });
    const reader: Pick<CodeReader, "repository" | "read"> = {
      repository: async () => ({
        id: repos[0].id,
        slug: REPO,
        name: "helios-firmware",
        defaultBranch: "main",
      }),
      read: async () => line as never,
    };
    const bisects = new CodeBisectService(
      api.nest.get(CodeBisectRepository),
      reader as CodeReader,
      api.nest.get(FarmJobsService),
    );
    const dispatch = { dispatch: jest.fn().mockRejectedValue(new Error("no engine here")) };
    const queue = { queueSelection: jest.fn().mockResolvedValue({}) };
    const push = jest
      .spyOn(api.nest.get(BatchesService), "push")
      .mockResolvedValue({ report: { outcome: "complete" } } as never);
    const store = api.nest.get(WatchRepository);
    const watch = new RegressionWatchService(
      store,
      tools,
      api.nest.get(DecisionKindRegistry),
      bisects,
      api.nest.get(AuditService),
    );
    const chain = new RegressionWatchChain(
      store,
      bisects,
      tools,
      api.nest.get(ResearchToolRepository),
      api.nest.get(ResearchEstimateService),
      dispatch as unknown as InvestigationDispatchService,
      api.nest.get(BatchesService),
      queue as unknown as BacklogQueueService,
      api.nest.get(DecisionKindRegistry),
    );

    return { workspace, org, telemetry, bisects, watch, chain, store, dispatch, queue, push };
  }

  type Bench = Awaited<ReturnType<typeof bench>>;

  /** Watch the hover metric, capture v2.0.4 and run a comparison that drifts +14%. */
  async function drifted(space: Bench, metric: object = HOVER): Promise<string> {
    await space.watch.saveSettings(space.org, space.workspace.people.owner.id, {
      metrics: [
        {
          repo: REPO,
          source: "case_metric",
          key: METRIC,
          class: "accuracy",
          window_days: 7,
          replay: (metric as typeof HOVER).replay,
          nightly_ref: "nightly",
        },
      ],
    });
    await space.watch.capture(space.org, {
      repository: REPO,
      releaseTag: "v2.0.4",
      via: "release",
      userId: null,
    });
    const compared = await space.watch.compare(space.org);

    return compared.results[0].itemId as string;
  }

  /** Move an item one step. */
  async function step(space: Bench, itemId: string) {
    const item = await space.store.item(space.org, itemId);
    if (item === undefined) throw new Error("no such item");
    return space.chain.advance(item);
  }

  /** Finish a job the way the gateway's `job.finish` does — on a runner of its pool. */
  async function finish(jobId: string, status: "succeeded" | "failed"): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.runners
         (organization_id, pool_id, name, arch, status, last_seen_at, security_mode,
          cert_serial, enrolled_at, telemetry)
       select j.organization_id, j.pool_id, 'rig-01', 'linux/arm64', 'online', now(), 'mtls',
              '4a110e97', now(), '{}'::jsonb
         from ${SCHEMA_NAME}.build_jobs j
        where j.id = $1
       on conflict do nothing`,
      [jobId],
    );
    await api.sql.query(
      `update ${SCHEMA_NAME}.build_jobs j
          set runner_id = (select r.id from ${SCHEMA_NAME}.runners r
                            where r.organization_id = j.organization_id and r.name = 'rig-01'),
              status = $2, offered_at = now(), started_at = now(), finished_at = now(),
              exit_code = $3
        where j.id = $1`,
      [jobId, status, status === "succeeded" ? 0 : 1],
    );
  }

  /** Build every bisect step, failing from the planted culprit on. */
  async function buildTheBisect(space: Bench, itemId: string): Promise<void> {
    const item = await space.store.item(space.org, itemId);
    const bisectId = item?.bisectId as string;

    for (let guard = 0; guard < 8; guard += 1) {
      const view = await space.bisects.get(space.org, bisectId);
      const open = view?.steps.find((candidate) => candidate.verdict === null);
      if (open === undefined) break;
      await finish(open.buildJobId, open.candidate >= CULPRIT ? "failed" : "succeeded");
      await space.bisects.onCompletion({
        organizationId: space.org,
        jobId: open.buildJobId,
        status: "failed",
      });
    }
  }

  /** The inbox cards of a kind in a workspace. */
  async function cards(org: string, kind: string) {
    const { rows } = await api.sql.query<{ id: string; source_ref: string; payload: object }>(
      `select id, source_ref, payload from ${SCHEMA_NAME}.decision_items
        where organization_id = $1 and kind_id = $2 order by created_at`,
      [org, kind],
    );
    return rows;
  }

  async function card(space: Bench): Promise<WatchCardResource> {
    return space.watch.card(space.org);
  }

  it("walks detect → bisect → forensics → fix draft, the card matching every stage", async () => {
    const space = await bench();
    const itemId = await drifted(space);

    // Detected: one row, the drift signed, one inbox card.
    let row = (await card(space)).items[0];
    expect(await card(space)).toMatchObject({
      headline: "nightly vs. v2.0.4 baseline",
      counts: { open: 1, err: 1, warn: 0 },
      baselines: 1,
    });
    expect(row).toMatchObject({
      id: itemId,
      repository: REPO,
      metricLabel: "hover_drift_cm",
      releaseTag: "v2.0.4",
      severity: "err",
      status: "detected",
      drift: "+14%",
      detail: "detected",
      pill: { label: "detected" },
      baseline: { n: 30, median: 5, unit: "cm" },
      current: { n: 12, median: 5.7 },
      bisect: null,
    });
    expect(await cards(space.org, "regression_drift_detected")).toHaveLength(1);

    // The same drift read again the next night opens nothing and files nothing.
    expect((await space.watch.compare(space.org)).results[0]).toMatchObject({
      outcome: "refreshed",
      itemId,
    });
    expect((await card(space)).items).toHaveLength(1);
    expect(await cards(space.org, "regression_drift_detected")).toHaveLength(1);

    // Bisecting: a real bisect, on real farm jobs.
    expect(await step(space, itemId)).toEqual({ moved: "bisecting" });
    row = (await card(space)).items[0];
    expect(row).toMatchObject({ status: "bisecting", pill: { label: "bisecting", tone: "run" } });
    expect(await step(space, itemId)).toEqual({ waiting: "the bisect is still running" });
    await buildTheBisect(space, itemId);

    // Bisected: the planted culprit, the jobs that proved it, one more inbox card.
    expect(await step(space, itemId)).toEqual({ moved: "bisected" });
    row = (await card(space)).items[0];
    expect(row).toMatchObject({
      status: "bisected",
      detail: `bisected → ${COMMITS[CULPRIT].slice(0, 7)}`,
      bisect: { culpritSha: COMMITS[CULPRIT], culprit: COMMITS[CULPRIT].slice(0, 7) },
    });
    const jobs = row.bisect?.farmJobIds ?? [];
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs.length).toBeLessThanOrEqual(4);
    expect(row.bisect?.steps).toBe(jobs.length);
    const built = await api.sql.query<{ n: number }>(
      `select count(*)::int as n from ${SCHEMA_NAME}.build_jobs
        where organization_id = $1 and id = any($2::uuid[])`,
      [space.org, jobs],
    );
    expect(built.rows[0].n).toBe(jobs.length);
    const bisected = await cards(space.org, "bisect_complete");
    expect(bisected).toHaveLength(1);
    expect(bisected[0].payload).toMatchObject({
      metric: "hover_drift_cm",
      culprit: COMMITS[CULPRIT].slice(0, 7),
      steps: jobs.length,
    });

    // Forensics: a regression_forensics investigation the watch opened, its ledger citing the
    // comparison and the bisect — every farm job named.
    expect(await step(space, itemId)).toEqual({ moved: "investigation_open" });
    row = (await card(space)).items[0];
    expect(row.status).toBe("investigation_open");
    expect(row.investigation?.displayId).toBe("RS-001");
    expect(row.detail).toBe(`bisected → ${COMMITS[CULPRIT].slice(0, 7)} · forensics RS-001`);
    const opened = await api.sql.query<{
      origin: string;
      status: string;
      slug: string;
      question: string;
    }>(
      `select i.origin, i.status, k.slug, i.question
         from ${SCHEMA_NAME}.investigations i
         join ${SCHEMA_NAME}.investigation_kinds k on k.id = i.kind_id
        where i.id = $1`,
      [row.investigation?.id],
    );
    expect(opened.rows[0]).toMatchObject({
      origin: "regression_watch",
      status: "queued",
      slug: "regression_forensics",
    });
    expect(opened.rows[0].question).toContain(`bisected to ${COMMITS[CULPRIT].slice(0, 7)}`);
    const ledger = await api.sql.query<{
      tool_slug: string;
      locator: string;
      meta: { steps?: { job: string }[] };
    }>(
      `select tool_slug, locator, meta from ${SCHEMA_NAME}.source_records
        where investigation_id = $1 order by cite_no`,
      [row.investigation?.id],
    );
    expect(ledger.rows.map((source) => source.tool_slug)).toEqual(["telemetry", "code"]);
    expect(ledger.rows[0].locator).toContain("baseline:v2.0.4-vs-");
    expect(ledger.rows[1].locator).toMatch(/^bisect:\/\/acme\/helios-firmware@c+8\?jobs=/);
    expect(ledger.rows[1].meta.steps?.map((entry) => entry.job).sort()).toEqual([...jobs].sort());
    // The loop was asked to take it; it could not, and the investigation is still there.
    expect(space.dispatch.dispatch).toHaveBeenCalledWith(space.org, row.investigation?.id);

    // Fix drafted: one Planning draft with the evidence — and nothing filed.
    expect(await step(space, itemId)).toEqual({ moved: "fix_drafted" });
    row = (await card(space)).items[0];
    expect(row).toMatchObject({
      status: "fix_drafted",
      pill: { label: "queued" },
      fixTicket: { kind: "draft", key: "FIX-1" },
      detail: `bisected → ${COMMITS[CULPRIT].slice(0, 7)} · fix ticket drafted · FIX-1`,
    });
    const draft = await api.sql.query<{
      title: string;
      body: string;
      planner: string;
      push_state: string;
    }>(
      `select d.title, d.body, b.planner, d.push_state
         from ${SCHEMA_NAME}.ticket_drafts d
         join ${SCHEMA_NAME}.draft_batches b on b.id = d.batch_id
        where d.id = $1`,
      [row.fixTicket?.id],
    );
    expect(draft.rows[0]).toMatchObject({
      title: "Fix regression: hover_drift_cm +14% since v2.0.4",
      planner: "regression-watch-v1",
    });
    expect(draft.rows[0].body).toContain(COMMITS[CULPRIT]);
    expect(draft.rows[0].body).toContain("west twister -T tests/hil/hover");
    expect(draft.rows[0].body).toContain("RS-001");
    expect(draft.rows[0].push_state).not.toBe("pushed");
  }, 60_000);

  it("files and queues the fix only when the workspace opted in", async () => {
    const space = await bench();
    const itemId = await drifted(space);
    await step(space, itemId);
    await buildTheBisect(space, itemId);
    for (let n = 0; n < 3; n += 1) await step(space, itemId);
    const drafted = await space.store.item(space.org, itemId);
    expect(drafted?.status).toBe("fix_drafted");
    await api.sql.query(
      `update ${SCHEMA_NAME}.draft_batches set status = 'sized'
        where id = (select batch_id from ${SCHEMA_NAME}.ticket_drafts where id = $1)`,
      [drafted?.fixTicketRef?.id],
    );

    // The default: the draft waits for a person, however many passes go by.
    expect((await space.watch.settings(space.org)).autoFile).toBe(false);
    for (let n = 0; n < 3; n += 1) {
      expect(await step(space, itemId)).toEqual({
        waiting: "the draft waits for a person to file it",
      });
    }
    expect(space.push).not.toHaveBeenCalled();
    expect(space.queue.queueSelection).not.toHaveBeenCalled();

    // Opted in: the next pass files it. The opt-in is on the audit log.
    await space.watch.saveSettings(space.org, space.workspace.people.owner.id, { autoFile: true });
    expect(await step(space, itemId)).toEqual({ waiting: "the draft is being filed" });
    expect(space.push).toHaveBeenCalledTimes(1);
    const audited = await api.sql.query<{ detail: Record<string, unknown> }>(
      `select detail from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and action = 'regression_watch.policy_updated'`,
      [space.org],
    );
    expect(audited.rows).toHaveLength(1);
    expect(audited.rows[0].detail).toMatchObject({ previousAutoFile: false, autoFile: true });
  }, 60_000);

  it("follows the fix from its ticket to a merged pull request", async () => {
    const space = await bench();
    const itemId = await drifted(space);
    await step(space, itemId);
    await buildTheBisect(space, itemId);
    for (let n = 0; n < 3; n += 1) await step(space, itemId);
    const drafted = await space.store.item(space.org, itemId);

    // A person files the draft: it becomes ticket #517.
    const [ticketId] = await insertTickets(api, space.workspace, [{ number: 517 }]);
    await api.sql.query(
      `update ${SCHEMA_NAME}.ticket_drafts set push_state = 'pushed', pushed_ticket_id = $2 where id = $1`,
      [drafted?.fixTicketRef?.id, ticketId],
    );
    await step(space, itemId);
    let row = (await card(space)).items[0];
    expect(row).toMatchObject({
      status: "fix_drafted",
      fixTicket: { kind: "ticket", id: ticketId, key: "#517" },
      detail: `bisected → ${COMMITS[CULPRIT].slice(0, 7)} · fix ticket drafted · #517`,
    });
    expect(await step(space, itemId)).toEqual({ waiting: "the fix ticket has no run yet" });

    // Its pull request merges.
    const pr = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.pull_requests
         (organization_id, source_id, external_number, external_url, title, head_branch,
          base_branch, ticket_id, state, merged_at)
       values ($1, $2, 641, 'https://github.com/acme/helios-firmware/pull/641', 'Fix hover drift',
               'loop/517-hover', 'main', $3, 'merged', now())
       returning id`,
      [space.org, space.workspace.sourceId, ticketId],
    );
    expect(await step(space, itemId)).toEqual({ moved: "fixed_merged" });
    row = (await card(space)).items[0];
    expect(row).toMatchObject({
      status: "fixed_merged",
      pill: { label: "✓ merged", tone: "ok" },
      pullRequest: { id: pr.rows[0].id, key: "#641" },
      detail: "root-caused, fixed & merged · PR #641",
    });
    expect((await card(space)).counts.open).toBe(0);
    // Final: another pass changes nothing, and the next drift of this baseline opens a new item.
    expect(await step(space, itemId)).toEqual({ waiting: "fixed_merged is final" });
    expect((await space.watch.compare(space.org)).results[0].outcome).toBe("opened");
  }, 60_000);

  it("stops a metric with no replayable test at detected, with a needs-repro note", async () => {
    const space = await bench();
    const itemId = await drifted(space, { ...HOVER, replay: null });

    expect(await step(space, itemId)).toEqual({ rested: NEEDS_REPRO_NO_TEST });
    expect(await step(space, itemId)).toEqual({ waiting: "resting with a note" });

    const row = (await card(space)).items[0];
    expect(row).toMatchObject({ status: "detected", note: NEEDS_REPRO_NO_TEST, bisect: null });
    expect(row.detail).toBe(NEEDS_REPRO_NO_TEST);
    const bisects = await api.sql.query(
      `select 1 from ${SCHEMA_NAME}.code_bisects where organization_id = $1`,
      [space.org],
    );
    expect(bisects.rows).toHaveLength(0);
    // It was still detected, and still announced — saying why it will not be bisected.
    const [announced] = await cards(space.org, "regression_drift_detected");
    expect((announced.payload as { next_step: string }).next_step).toContain("needs a repro");
  });

  it("returns an item to detected when its bisect does not converge", async () => {
    const space = await bench();
    const itemId = await drifted(space);
    await step(space, itemId);
    const item = await space.store.item(space.org, itemId);
    await space.bisects.cancel(space.org, item?.bisectId as string);

    const outcome = await step(space, itemId);

    expect(outcome).toMatchObject({
      rested: expect.stringContaining("needs repro: the bisect ended canceled") as string,
    });
    expect((await card(space)).items[0]).toMatchObject({ status: "detected", bisect: null });
    expect(await cards(space.org, "bisect_complete")).toHaveLength(0);
  });

  it("opens nothing for a change within noise, and follows per-metric thresholds", async () => {
    const space = await bench();
    await space.watch.saveSettings(space.org, space.workspace.people.owner.id, {
      metrics: [
        {
          repo: REPO,
          source: "case_metric",
          key: METRIC,
          class: "accuracy",
          window_days: 7,
          replay: null,
          nightly_ref: "HEAD",
        },
      ],
    });
    await space.watch.capture(space.org, {
      repository: REPO,
      releaseTag: "v2.0.4",
      via: "release",
      userId: null,
    });

    // A move inside twice the baseline's own spread (0.1 cm) is noise.
    space.telemetry.current = reading(5.15, 12);
    expect((await space.watch.compare(space.org)).results[0]).toMatchObject({
      outcome: "within",
      reason: "a move of 0.15 cm is inside 2× the baseline's own spread (0.2 cm)",
      itemId: null,
    });
    // Clear of the noise, +5% is still under nothing — but +4.6% is under the 5% threshold.
    space.telemetry.current = reading(5.23, 12);
    expect((await space.watch.compare(space.org)).results[0]).toMatchObject({
      outcome: "within",
      reason: "a move of 4.6% is under the 5% warning threshold",
    });
    expect((await card(space)).items).toHaveLength(0);
    expect(await cards(space.org, "regression_drift_detected")).toHaveLength(0);

    // Tightened for this one metric, the same +4.6% is a warning.
    await space.watch.saveSettings(space.org, space.workspace.people.owner.id, {
      thresholds: { classes: {}, metrics: { [METRIC]: { warn_pct: 2, err_pct: 20 } } },
    });
    expect((await space.watch.compare(space.org)).results[0].outcome).toBe("opened");
    expect((await card(space)).items[0]).toMatchObject({ severity: "warn", drift: "+4.6%" });

    // A night with too few samples says nothing: the open item is left as it was.
    space.telemetry.current = reading(9, 3);
    expect((await space.watch.compare(space.org)).results[0]).toMatchObject({
      outcome: "within",
      reason:
        "only 3 samples in the nightly window — 10 are needed before a difference means anything",
    });
    expect((await card(space)).items[0]).toMatchObject({ severity: "warn", drift: "+4.6%" });

    // A night that reads it back inside its thresholds clears the item's severity.
    space.telemetry.current = reading(5.01, 12);
    expect((await space.watch.compare(space.org)).results[0].outcome).toBe("cleared");
    expect((await card(space)).items[0]).toMatchObject({ severity: "ok", status: "detected" });
  });

  it("captures a baseline once per release and metric, and nothing from an empty window", async () => {
    const space = await bench();
    const owner = space.workspace.people.owner.id;
    await space.watch.saveSettings(space.org, owner, {
      metrics: [
        {
          repo: REPO,
          source: "case_metric",
          key: METRIC,
          class: "accuracy",
          window_days: 7,
          replay: null,
          nightly_ref: "HEAD",
        },
      ],
    });
    const capture = () =>
      space.watch.capture(space.org, {
        repository: REPO,
        releaseTag: "v2.0.4",
        via: "manual",
        userId: owner,
      });

    const first = await capture();
    expect(first.captured).toHaveLength(1);
    expect(first.captured[0]).toMatchObject({
      repository: REPO,
      releaseTag: "v2.0.4",
      metricLabel: "hover_drift_cm",
      capturedVia: "manual",
      window: { n: 30, median: 5, spread: 0.1, spreadKind: "iqr", unit: "cm" },
    });
    const again = await capture();
    expect(again.captured).toHaveLength(0);
    expect(again.skipped[0].reason).toContain("already has this metric's baseline");

    space.telemetry.baseline = {
      status: "no_data",
      window: "7d",
      from: null,
      to: null,
      reason: "no measurement of it was taken",
    } as never;
    const empty = await space.watch.capture(space.org, {
      repository: REPO,
      releaseTag: "v2.1.0",
      via: "manual",
      userId: owner,
    });
    expect(empty).toMatchObject({
      captured: [],
      skipped: [{ metric: METRIC, reason: "no measurement of it was taken" }],
    });

    await expect(
      space.watch.capture(space.org, {
        repository: "acme/other",
        releaseTag: "v1",
        via: "manual",
        userId: owner,
      }),
    ).rejects.toMatchObject({ code: "regression_watch_nothing_watched" });
  });

  it("dismisses an item, cancels its bisect, and its cards settle", async () => {
    const space = await bench();
    const itemId = await drifted(space);
    await step(space, itemId);
    const bisecting = await space.store.item(space.org, itemId);

    const dismissed = await space.watch.dismiss(
      space.org,
      space.workspace.people.owner.id,
      itemId,
      "A sensor swap, not a regression.",
    );

    expect(dismissed).toMatchObject({ status: "dismissed", pill: { label: "dismissed" } });
    expect((await space.bisects.get(space.org, bisecting?.bisectId as string))?.bisect.status).toBe(
      "canceled",
    );
    await expect(
      space.watch.dismiss(space.org, space.workspace.people.owner.id, itemId, "again"),
    ).rejects.toMatchObject({ code: "regression_watch_item_closed" });

    const asking = (await cards(space.org, "regression_drift_detected")).map((found) => ({
      id: found.id,
      organizationId: space.org,
      kindId: "regression_drift_detected",
      refs: [],
      sourceRef: found.source_ref,
    }));
    const settled = await watchMovedOnDetector().settled(
      asking,
      api.nest.get(WatchRepository)["database"].db,
    );
    expect(settled).toEqual([
      {
        itemId: asking[0].id,
        organizationId: space.org,
        settlement: "watch_moved_on",
        channel: "web",
      },
    ]);
  });

  describe("over HTTP", () => {
    const call = (
      workspace: PlanningWorkspace,
      person: Person,
      method: "get" | "post" | "put",
      path: string,
    ) => callAs(api, workspace.bench.slug, person, method, path);

    it("lets every member read, and only owners and admins change anything", async () => {
      const { workspace } = await bench();
      const { owner, admin, member, viewer } = workspace.people;

      const settings = (await call(workspace, viewer, "get", `${BASE}/settings`).expect(200))
        .body as WatchSettingsResource;
      expect(settings).toMatchObject({
        metrics: [],
        autoBisect: true,
        autoFile: false,
        fixSourceId: null,
      });
      expect(settings.thresholds.defaults.accuracy).toEqual({
        direction: "higher_is_worse",
        warnPct: 5,
        errPct: 10,
        minSpreadMultiple: 2,
        minSamples: 10,
      });
      expect((await call(workspace, viewer, "get", BASE).expect(200)).body).toMatchObject({
        headline: null,
        items: [],
        counts: { open: 0 },
      });

      await call(workspace, member, "put", `${BASE}/settings`).send({ autoFile: true }).expect(403);
      await call(workspace, member, "post", `${BASE}/baselines`)
        .send({ repository: REPO, releaseTag: "v1" })
        .expect(403);
      await call(workspace, member, "post", `${BASE}/comparisons`).expect(403);

      const saved = (
        await call(workspace, admin, "put", `${BASE}/settings`)
          .send({
            metrics: [HOVER],
            thresholds: {
              classes: { timing: { warnPct: 3, errPct: 9 } },
              metrics: { [METRIC]: { minSamples: 4 } },
            },
            autoFile: true,
            fixSourceId: workspace.sourceId,
          })
          .expect(200)
      ).body as WatchSettingsResource;
      expect(saved).toMatchObject({
        metrics: [HOVER],
        autoFile: true,
        autoBisect: true,
        fixSourceId: workspace.sourceId,
        thresholds: {
          classes: { timing: { warnPct: 3, errPct: 9 } },
          metrics: { [METRIC]: { minSamples: 4 } },
        },
      });
      // A field that was not sent is kept.
      expect(
        (
          await call(workspace, owner, "put", `${BASE}/settings`)
            .send({ autoBisect: false })
            .expect(200)
        ).body as WatchSettingsResource,
      ).toMatchObject({ metrics: [HOVER], autoFile: true, autoBisect: false });
    });

    it("refuses settings it cannot store", async () => {
      const { workspace } = await bench();
      const put = (body: object) =>
        call(workspace, workspace.people.owner, "put", `${BASE}/settings`).send(body);
      const code = async (body: object, status: number) =>
        ((await put(body).expect(status)).body as { code: string }).code;

      expect(await code({ metrics: [{ ...HOVER, windowDays: 0 }] }, 422)).toBe("validation_failed");
      expect(await code({ metrics: [{ ...HOVER, repository: "helios" }] }, 422)).toBe(
        "validation_failed",
      );
      expect(await code({ metrics: [HOVER, HOVER] }, 422)).toBe(
        "regression_watch_settings_invalid",
      );
      expect(await code({ metrics: [{ ...HOVER, source: "bi_metric" }] }, 422)).toBe(
        "regression_watch_settings_invalid",
      );
      expect(
        await code({ metrics: [{ ...HOVER, source: "bi_metric", key: "no_such_metric" }] }, 422),
      ).toBe("regression_watch_settings_invalid");
      expect(
        await code({ thresholds: { classes: { speed: { warnPct: 1, errPct: 2 } } } }, 422),
      ).toBe("regression_watch_settings_invalid");
      expect(
        await code({ thresholds: { metrics: { [METRIC]: { warnPct: 9, errPct: 2 } } } }, 422),
      ).toBe("regression_watch_settings_invalid");
      expect(await code({ thresholds: { metrics: { [METRIC]: { warnPct: 9 } } } }, 422)).toBe(
        "regression_watch_settings_invalid",
      );
      expect(await code({ fixSourceId: "a1240000-0000-4000-8000-00000000dead" }, 422)).toBe(
        "regression_watch_settings_invalid",
      );
      expect(await code({ autoFile: "yes" }, 422)).toBe("validation_failed");
    });

    it("shows another workspace nothing", async () => {
      const space = await bench();
      const itemId = await drifted(space);
      const elsewhere = await planningWorkspace(api);

      expect(
        (await call(elsewhere, elsewhere.people.owner, "get", BASE).expect(200)).body,
      ).toMatchObject({ items: [], baselines: 0, headline: null });
      const refused = await call(
        elsewhere,
        elsewhere.people.owner,
        "post",
        `${BASE}/items/${itemId}/dismiss`,
      )
        .send({ reason: "not mine" })
        .expect(404);
      expect((refused.body as { code: string }).code).toBe("regression_watch_item_not_found");
      expect((await card(space)).items[0].status).toBe("detected");
      await call(
        space.workspace,
        space.workspace.people.owner,
        "post",
        `${BASE}/items/not-a-uuid/dismiss`,
      )
        .send({ reason: "x" })
        .expect(422);
      await call(
        space.workspace,
        space.workspace.people.owner,
        "post",
        `${BASE}/items/${itemId}/dismiss`,
      )
        .send({ reason: "  " })
        .expect(422);
    });

    it("takes a release announcement on the internal surface only", async () => {
      const { workspace } = await bench();
      await call(workspace, workspace.people.owner, "put", `${BASE}/settings`)
        .send({ metrics: [{ ...HOVER, replay: null }] })
        .expect(200);
      const announce = (key?: string) => {
        const pending = request(api.baseUrl).post("/internal/research/regression-watch/releases");
        return (key === undefined ? pending : pending.set(INTERNAL_KEY_HEADER, key)).send({
          repository: REPO,
          releaseTag: "v2.0.4",
        });
      };

      await announce().expect(401);
      // The real application's telemetry tool finds no measurements in an empty workspace, so
      // the announcement reaches the workspace and honestly captures nothing.
      const answered = await announce(api.configuration.engineSharedSecret).expect(200);
      expect(answered.body).toEqual({
        repository: REPO,
        releaseTag: "v2.0.4",
        workspaces: 1,
        captured: 0,
      });
      const unwatched = await request(api.baseUrl)
        .post("/internal/research/regression-watch/releases")
        .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
        .send({ repository: "acme/unwatched", releaseTag: "v1" })
        .expect(200);
      expect(unwatched.body).toMatchObject({ workspaces: 0, captured: 0 });
    });
  });
});
