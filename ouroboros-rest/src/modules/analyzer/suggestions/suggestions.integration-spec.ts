import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import {
  analyze,
  annotate,
  BENCH_REPO,
  changePointFinding,
  completeRun,
  recordApplication,
  seedSeededIdsWorkspace,
  suggestionId,
} from "../analyzer.integration.fixture";
import { POOL_A_ID } from "../composer/composer.seed.fixture";
import type { SuggestionResource, SuggestionsResource } from "./suggestions.resources";

/**
 * The suggestion cards' read against a migrated database (BW.3,
 * [#518](https://github.com/NobuData/ouroboros/issues/518)).
 *
 * What only real rows can prove: **which suggestions are current** — one stays on the cards until
 * a later analysis that ran its analyzers does not find it again, so a run that did not look (in
 * flight, failed, its pattern analyzers skipped) never blanks them while one that looked and found
 * nothing does; that a dismissal is still there, still dismissed, after a re-analysis records the
 * same suggestion again; and that each row carries the bases, the findings and the measurement
 * the tables hold for it.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/analyzer/suggestions
 * ```
 */

/** The six cards' titles, in the order the mockup draws them within each kind. */
const TITLES = {
  gate: "Split the test gate: native_sim every build, QEMU + HIL only before merge",
  ccache: "Re-warm ccache right after deps-refresh merges",
  move: "Move forge-02 to pool-a during 14:00–16:00 UTC",
  link: "Link zephyr.elf incrementally (partial link cache)",
  review: "standard-fix: run self-review BEFORE the build stage",
  flake: "Loops touching drivers/can/: add a 'flake-retry under load profile' test stage",
} as const;

describe("the suggestion cards read", () => {
  let api: ApiHarness;
  let owner: Person;
  let workspace: Workspace;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());

  beforeEach(async () => {
    owner = await api.signIn({ displayName: "Ken Suenobu" });
    workspace = await api.workspace(owner);
    await seedSeededIdsWorkspace(api, workspace);
  });

  afterEach(() => api.truncate());

  /** A request as somebody, in the bench workspace. */
  function as(person: Person, method: "get" | "post", path: string) {
    return api.as(person)(method, path).set(TENANT_HEADER, workspace.slug);
  }

  /** The read, as the owner. */
  async function read(): Promise<SuggestionsResource> {
    return bodyOf<SuggestionsResource>(
      await as(owner, "get", `/api/v1/analyzer/suggestions?repo=${BENCH_REPO}`).expect(200),
    );
  }

  /** One suggestion of a read, by its title. */
  function titled(body: SuggestionsResource, title: string): SuggestionResource {
    const found = body.suggestions.find((entry) => entry.title === title);
    if (found === undefined) throw new Error(`no suggestion titled ${title}`);
    return found;
  }

  it("answers nothing before an analysis has ended with suggestions — a failed run is not one", async () => {
    const empty = {
      repo: BENCH_REPO,
      runId: null,
      analyzedAt: null,
      suggestions: [],
      calibration: [],
    };

    expect(await read()).toEqual(empty);

    await analyze(api, workspace);

    expect(await read()).toEqual(empty);
  });

  it("lists the analysis's process and workflow suggestions, most confident first, never a ticket", async () => {
    const runId = await analyze(api, workspace, [], { ending: "complete" });

    const body = await read();

    expect(body.runId).toBe(runId);
    expect(body.analyzedAt).not.toBeNull();
    expect(body.suggestions.map((entry) => [entry.confidence, entry.kind, entry.title])).toEqual([
      [91, "build_process", TITLES.gate],
      [89, "workflow", TITLES.review],
      [88, "build_process", TITLES.ccache],
      [84, "build_process", TITLES.move],
      [77, "workflow", TITLES.flake],
      [72, "build_process", TITLES.link],
    ]);
    expect(body.suggestions.every((entry) => entry.status === "open")).toBe(true);
    expect(body.suggestions.every((entry) => entry.resolution === null)).toBe(true);
  });

  it("carries what produced each number, the findings cited and their evidence resolved", async () => {
    await analyze(api, workspace, [], { ending: "complete" });

    const body = await read();
    const move = titled(body, TITLES.move);

    expect(move).toMatchObject({
      plane: "farm_config",
      needsSpike: false,
      workflow: null,
      confidenceBasis: {
        formula: expect.stringContaining("composer v1") as string,
        inputs: { template: "runner_move", scale: 5, effectTarget: 0.75 },
      },
      impact: {
        estimate: -240,
        unit: "seconds",
        appliesTo: "queue p95",
        basis: {
          method: "extrapolated",
          formula: "runner_move v1: -wait_reduction_seconds",
          inputs: { wait_reduction_seconds: 240 },
          window: { from: "2026-05-10", to: "2026-08-07", days: 90 },
          calibration: { analyzer: "queue_correlation", impactClass: "queue_wait", factor: 1 },
          raw: -240,
        },
      },
    });
    expect(move.findings).toHaveLength(1);
    expect(move.findings[0]).toMatchObject({
      analyzer: "queue_correlation",
      analyzerVersion: 1,
      subjectKey: "pool-a@14:00-16:00",
      data: { days_exceeded: 11, days_observed: 14 },
      evidence: [{ kind: "runner_pool", id: POOL_A_ID, label: "pool-a", surface: "farm" }],
      evidenceTotal: 1,
    });

    // A composite cites every finding it was composed from.
    expect(
      titled(body, TITLES.gate)
        .findings.map((finding) => finding.subjectKey)
        .sort(),
    ).toEqual([
      "standard-fix/stage HIL/unique_failures",
      "standard-fix/stage qemu_cortex_m3/unique_failures",
    ]);
    // The spike is flagged, and binds to planning rather than to a plane Apply could change.
    expect(titled(body, TITLES.link)).toMatchObject({ needsSpike: true, plane: "planning" });
  });

  it("names the version a workflow draft would become, from the workflow's version in force", async () => {
    await analyze(api, workspace, [], { ending: "complete" });
    const { rows } = await api.sql.query<{ current_version: number | null }>(
      `select current_version from ${SCHEMA_NAME}.workflows
        where organization_id = $1 and slug = 'standard-fix'`,
      [workspace.id],
    );

    const review = titled(await read(), TITLES.review);

    expect(review).toMatchObject({
      plane: "workflow",
      workflow: {
        slug: "standard-fix",
        nextVersion: (rows[0].current_version ?? 0) + 1,
        studioPath: "/workflows/standard-fix",
      },
    });
  });

  it("keeps a dismissal listed with who and why — and dismissed when a re-analysis finds it again", async () => {
    await analyze(api, workspace, [], { ending: "complete" });
    const member = await api.signIn({ displayName: "Mira Okafor" });
    await api.join(workspace.id, member, "member");
    const flake = await suggestionId(api, workspace, "Loops touching");
    const ccache = await suggestionId(api, workspace, "Re-warm ccache");

    await as(member, "post", `/api/v1/analyzer/suggestions/${flake}/dismiss`)
      .send({ reason: "The telemetry suite is being rewritten." })
      .expect(200);
    await as(owner, "post", `/api/v1/analyzer/suggestions/${ccache}/dismiss`).send({}).expect(200);

    const dismissed = await read();

    expect(titled(dismissed, TITLES.flake)).toMatchObject({
      id: flake,
      status: "dismissed",
      resolution: {
        by: "Mira Okafor",
        reason: "The telemetry suite is being rewritten.",
        draftBatchId: null,
      },
    });
    // No reason was given, so none is answered — not the placeholder the row must store.
    expect(titled(dismissed, TITLES.ccache).resolution).toMatchObject({
      by: "Ken Suenobu",
      reason: null,
    });

    const rerun = await analyze(api, workspace, [], { ending: "complete" });
    const after = await read();

    expect(after.runId).toBe(rerun);
    // Re-recorded, not duplicated: the same six rows, the same ids.
    expect(after.suggestions).toHaveLength(6);
    expect(titled(after, TITLES.flake)).toMatchObject({ id: flake, status: "dismissed" });
    expect(titled(after, TITLES.ccache)).toMatchObject({ id: ccache, status: "dismissed" });
    expect(after.suggestions.filter((entry) => entry.status === "open")).toHaveLength(4);
    // Its findings are the re-analysis's own — the first run's copies are not listed beside them.
    expect(titled(after, TITLES.gate).findings).toHaveLength(2);
  });

  it("shows an applied suggestion with the measurement its apply opened, and the calibration", async () => {
    await analyze(api, workspace, [], { ending: "complete" });
    const id = await suggestionId(api, workspace, "Move forge-02");
    const measurementId = await recordApplication(api, workspace, owner, id, {
      at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      metric: "queue_wait",
      baseline: 540,
      delta: -240,
      analyzer: "queue_correlation",
      impactClass: "queue_wait",
    });

    const body = await read();
    const applied = titled(body, TITLES.move);

    expect(applied).toMatchObject({
      status: "applied",
      resolution: { by: "Ken Suenobu", reason: null },
      measurement: { id: measurementId, windowDays: 14, verdict: "pending" },
    });
    expect(applied.measurement?.day).toBeGreaterThanOrEqual(2);
    expect(applied.measurement?.day).toBeLessThanOrEqual(3);
    // No measurement has closed, so no cell exists yet: every factor applied was 1.
    expect(body.calibration).toEqual([]);
    expect(titled(body, TITLES.gate).measurement).toBeNull();
  });

  it("is not blanked by a later run that did not look — only its change-point analyzer ran", async () => {
    const composed = await analyze(api, workspace, [], { ending: "complete" });
    await annotate(api, workspace, [
      changePointFinding("2026-06-22", -130, [
        {
          label: "pool-a image zephyr-sdk:0.17",
          score: 0.6,
          ref: { kind: "runner_pool", id: POOL_A_ID },
          event_kind: "infra_event",
          days_from_breakpoint: 0,
        },
      ]),
    ]);

    const body = await read();

    expect(body.runId).toBe(composed);
    expect(body.suggestions).toHaveLength(6);
  });

  it("is not blanked by a run that composed only tickets, its pattern analyzers skipped", async () => {
    // What a live run is today: the log and waiver analyzers run, the rest lack their inputs.
    await analyze(api, workspace, [], { ending: "complete" });
    const live = await analyze(api, workspace, [], {
      ending: "complete",
      skipped: ["cache_window", "queue_correlation", "workflow_outcome", "config_usage"],
    });

    const body = await read();

    // The newest composing analysis is the live one — it re-recorded the ticket drafts —
    expect(body.runId).toBe(live);
    // — and every card row is still there: nobody looked for them again.
    expect(body.suggestions.map((entry) => entry.title).sort()).toEqual(
      Object.values(TITLES).sort(),
    );
    expect(body.suggestions.every((entry) => entry.findings.length > 0)).toBe(true);
  });

  it("keeps a suggestion whose own analyzer a later analysis skipped, beside the ones it re-found", async () => {
    await analyze(api, workspace, [], { ending: "complete" });
    await analyze(api, workspace, [], { ending: "complete", skipped: ["queue_correlation"] });

    const body = await read();

    expect(body.suggestions).toHaveLength(6);
    expect(titled(body, TITLES.move).status).toBe("open");
  });

  it("stays whole while the next analysis composes, then loses what that analysis looked for and did not find", async () => {
    const first = await analyze(api, workspace, [], { ending: "complete" });
    // The next run's queue analyzer completes with nothing: pool-a's afternoon queue is gone.
    const second = await analyze(api, workspace, [], {
      ending: "running",
      only: (analyzer) => analyzer !== "queue_correlation",
    });

    const composing = await read();

    // A run in flight has decided nothing yet: every row is still there.
    expect(composing.runId).toBe(first);
    expect(composing.suggestions.map((entry) => entry.title).sort()).toEqual(
      Object.values(TITLES).sort(),
    );
    // Each row's findings are its own last analysis's — never an older run's copy beside a newer.
    expect(composing.suggestions.every((entry) => entry.findings.length > 0)).toBe(true);

    await completeRun(api, second);
    const moved = await read();

    expect(moved.runId).toBe(second);
    expect(moved.suggestions.map((entry) => entry.title)).not.toContain(TITLES.move);
    expect(moved.suggestions).toHaveLength(5);
    // It left the cards; it was not resolved by anybody.
    const { rows } = await api.sql.query<{ status: string }>(
      `select status from ${SCHEMA_NAME}.analysis_suggestions
        where organization_id = $1 and title = $2`,
      [workspace.id, TITLES.move],
    );
    expect(rows).toEqual([{ status: "open" }]);
  });

  it("keeps a composite until every analyzer behind it has looked again", async () => {
    // The test-gate split cites two workflow_outcome findings; the ccache re-warm one cache_window.
    await analyze(api, workspace, [], { ending: "complete" });
    await analyze(api, workspace, [], {
      ending: "complete",
      only: (analyzer) => analyzer !== "workflow_outcome",
      skipped: ["cache_window"],
    });

    const titles = (await read()).suggestions.map((entry) => entry.title);

    // workflow_outcome looked and found nothing: its four suggestions are gone.
    expect(titles).not.toContain(TITLES.gate);
    expect(titles).not.toContain(TITLES.review);
    // cache_window did not look: its suggestion stays. queue_correlation re-found its own.
    expect(titles.sort()).toEqual([TITLES.move, TITLES.ccache].sort());
  });

  it("keeps a suggestion that cites two analyzers while either of them has not looked again", async () => {
    // No template cites two analyzers today, so one is recorded as the composer would record it.
    const first = await analyze(api, workspace, [], { ending: "running" });
    const cited = await api.sql.query<{ id: string }>(
      `select id from ${SCHEMA_NAME}.analysis_findings
        where run_id = $1 and analyzer in ('cache_window', 'queue_correlation')`,
      [first],
    );
    await api.sql.query(
      `select ${SCHEMA_NAME}.record_analysis_suggestion(
         $1::uuid, 'build_process', $2::uuid[], 'Warm the cache on the moved runner',
         'the cold window and the afternoon queue overlap', 80,
         '{"estimate": -60, "unit": "seconds", "applies_to": "per build",
           "basis": {"method": "extrapolated", "description": "both findings, together"}}'::jsonb,
         '{"plane": "job_hook", "change": {"on": "merge", "run": "true"}}'::jsonb)`,
      [first, cited.rows.map((row) => row.id)],
    );
    await completeRun(api, first);
    expect(cited.rows).toHaveLength(2);

    // The queue analyzer looks again; the cache analyzer does not.
    await analyze(api, workspace, [], { ending: "complete", skipped: ["cache_window"] });

    expect((await read()).suggestions.map((entry) => entry.title)).toContain(
      "Warm the cache on the moved runner",
    );

    // Now both have looked, and nothing composed it again.
    await analyze(api, workspace, [], { ending: "complete" });

    expect((await read()).suggestions.map((entry) => entry.title)).not.toContain(
      "Warm the cache on the moved runner",
    );
  });

  it("is not emptied by a failed run, whatever that run's analyzers reported", async () => {
    await analyze(api, workspace, [], { ending: "complete" });
    await analyze(api, workspace, [], { ending: "failed", only: () => false });

    expect((await read()).suggestions).toHaveLength(6);
  });

  it("refuses a repository that is not owner/name", async () => {
    const response = await as(owner, "get", "/api/v1/analyzer/suggestions?repo=nonsense").expect(
      422,
    );

    expect(bodyOf<{ code: string }>(response).code).toBe("validation_failed");
  });

  it("is a member's to read, and a viewer's", async () => {
    await analyze(api, workspace, [], { ending: "complete" });
    const viewer = await api.signIn();
    await api.join(workspace.id, viewer, "viewer");

    const body = bodyOf<SuggestionsResource>(
      await as(viewer, "get", `/api/v1/analyzer/suggestions?repo=${BENCH_REPO}`).expect(200),
    );

    expect(body.suggestions).toHaveLength(6);
  });
});
