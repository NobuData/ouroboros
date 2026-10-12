import type { DryRun, DryRunArtifact, DryRunStage } from "../db/schema";
import { REPLAY_FORMULAS, REPLAY_FORMULA_SUMMARIES } from "../replay-estimates/replay.formulas";
import { effectiveBudget } from "./dry-runs.budget";
import { rankCandidates } from "./dry-runs.picker";
import { pickerTicket } from "./dry-runs.picker.service";
import {
  dryRunArtifact,
  dryRunCandidate,
  dryRunDraftLabel,
  dryRunHistory,
  dryRunResource,
  dryRunStage,
  stageEstimate,
  stageHowLabel,
  streamedStage,
} from "./dry-runs.resources";
import {
  DEFINITION,
  PINNED_SHA,
  REPLAY_POLICY,
  TICKET_ID,
  WORKFLOW_ID,
  WORKSPACE,
  harnessStage,
  ticketRow,
  workflowRow,
} from "./dry-runs.store.fixture";

const RUN = {
  id: "5eed008b-0000-4000-8000-000000000001",
  organization_id: WORKSPACE,
  workflow_id: WORKFLOW_ID,
  base_version: null,
  draft_rev: 3,
  session_id: null,
  ticket_id: TICKET_ID,
  pinned_sha: PINNED_SHA,
  mode: "deep",
  status: "complete",
  duration_ms: "161000",
  cost_cents: 31,
  tokens: "96000",
  guard_audit: [],
  guards_clean: true,
  precheck_findings: [],
  failure_reason: null,
  started_at: new Date("2026-10-06T15:05:00Z"),
  finished_at: new Date("2026-10-06T15:07:41Z"),
} as DryRun;

/** A build's class as `build_similarity_class()` prints it. */
const BUILD_CLASS =
  "pool-a · helios-firmware · container · ghcr.io/acme/zephyr-sdk · west build -b helios_h7";
/** A test run's class as `test_similarity_class()` prints it. */
const TEST_CLASS = "helios-firmware · tests · hil + unit";

const BUILD_FORMULA = {
  id: "build_duration_replay",
  version: REPLAY_FORMULAS.build.version,
  summary: REPLAY_FORMULA_SUMMARIES.build,
};
const TEST_FORMULA = {
  id: "test_duration_replay",
  version: REPLAY_FORMULAS.test.version,
  summary: REPLAY_FORMULA_SUMMARIES.test,
};

const STAGE: DryRunStage = {
  id: "s-1",
  organization_id: WORKSPACE,
  dry_run_id: RUN.id,
  seq: 4,
  stage_key: "build",
  display_name: "build",
  verdict: "ok",
  how: "replayed",
  note: "est. 4m 02s (214 similar builds, ±20s)",
  metrics: {
    estimate_ms: 242000,
    sample_count: 214,
    spread_ms: 20000,
    similarity_class: BUILD_CLASS,
    window_days: 30,
  },
  skip_reason: null,
  skip_kind: null,
  skip_input: null,
  started_at: new Date("2026-10-06T15:06:00Z"),
  finished_at: null,
};

describe("the dry run's wire shapes", () => {
  it("labels a draft v{base or 0}.{rev}", () => {
    expect(dryRunDraftLabel(null, 3)).toBe("v0.3");
    expect(dryRunDraftLabel(14, 0)).toBe("v14.0");
  });

  it("derives the how label exactly as the database does", () => {
    expect(stageHowLabel("replayed", {})).toBe("replayed from history");
    expect(stageHowLabel("skipped", {})).toBe("skipped");
    expect(stageHowLabel("llm", { simulated_writes: 2 })).toBe("simulated");
    expect(stageHowLabel("llm", { simulated_writes: 0 })).toBeNull();
    expect(stageHowLabel("llm", { simulated_writes: "2" })).toBeNull();
    expect(stageHowLabel("deterministic", { simulated_writes: 2 })).toBeNull();
  });

  it("gives a stored row and a streamed row one shape", () => {
    expect(dryRunStage(STAGE, REPLAY_POLICY)).toEqual({
      seq: 4,
      stageKey: "build",
      displayName: "build",
      verdict: "ok",
      how: "replayed",
      howLabel: "replayed from history",
      note: "est. 4m 02s (214 similar builds, ±20s)",
      metrics: STAGE.metrics,
      estimate: {
        status: "estimated",
        estimateMs: 242000,
        spreadMs: 20000,
        sampleCount: 214,
        sampleFloor: 20,
        windowDays: 30,
        formula: BUILD_FORMULA,
      },
      skipReason: null,
      skipKind: null,
      skipInput: null,
      startedAt: "2026-10-06T15:06:00.000Z",
      finishedAt: null,
    });

    const streamed = streamedStage(
      harnessStage(5, "exploit-verify", {
        verdict: "skipped",
        how: "skipped",
        skipReason: 'Task kind "exploit-verify" has no route yet',
        skipKind: "unresolved_reference",
        startedAt: null,
        finishedAt: "2026-10-06T15:07:00+00:00",
      }),
      REPLAY_POLICY,
    );
    expect(Object.keys(streamed)).toEqual(Object.keys(dryRunStage(STAGE, REPLAY_POLICY)));
    expect(streamed).toMatchObject({
      estimate: null,
      howLabel: "skipped",
      skipReason: 'Task kind "exploit-verify" has no route yet',
      skipKind: "unresolved_reference",
      skipInput: null,
      startedAt: null,
      finishedAt: "2026-10-06T15:07:00.000Z",
    });
  });

  describe("a replayed row's estimate", () => {
    it("reads a build estimate out of the row's metrics, with the build formula", () => {
      expect(stageEstimate("replayed", STAGE.metrics, REPLAY_POLICY)).toEqual({
        status: "estimated",
        estimateMs: 242000,
        spreadMs: 20000,
        sampleCount: 214,
        sampleFloor: 20,
        windowDays: 30,
        formula: BUILD_FORMULA,
      });
    });

    it("reads a test estimate with the test formula — from the class, not the stage's name", () => {
      const metrics = {
        estimate_ms: 612000,
        spread_ms: 41000,
        sample_count: 58,
        similarity_class: TEST_CLASS,
        window_days: 30,
      };

      expect(stageEstimate("replayed", metrics, REPLAY_POLICY)).toEqual({
        status: "estimated",
        estimateMs: 612000,
        spreadMs: 41000,
        sampleCount: 58,
        sampleFloor: 20,
        windowDays: 30,
        formula: TEST_FORMULA,
      });
      // The row's key and name play no part: a stage called `build` with a test class is a test.
      expect(dryRunStage({ ...STAGE, metrics }, REPLAY_POLICY).estimate?.formula).toEqual(
        TEST_FORMULA,
      );
    });

    it("gives insufficient history no number anywhere", () => {
      const estimate = stageEstimate(
        "replayed",
        {
          insufficient_history: true,
          sample_count: 12,
          similarity_class: TEST_CLASS,
          window_days: 30,
        },
        REPLAY_POLICY,
      );

      expect(estimate).toEqual({
        status: "insufficient_history",
        estimateMs: null,
        spreadMs: null,
        sampleCount: 12,
        sampleFloor: 20,
        windowDays: 30,
        formula: TEST_FORMULA,
      });
    });

    it("counts nothing found as insufficient history too", () => {
      expect(
        stageEstimate(
          "replayed",
          { insufficient_history: true, sample_count: 0, similarity_class: BUILD_CLASS },
          REPLAY_POLICY,
        ),
      ).toMatchObject({ status: "insufficient_history", sampleCount: 0, estimateMs: null });
    });

    it.each(["llm", "deterministic", "skipped"] as const)(
      "is null on a %s row, whatever its metrics hold",
      (how) => {
        expect(stageEstimate(how, STAGE.metrics, REPLAY_POLICY)).toBeNull();
      },
    );

    it("takes the floor from the policy, and the window only when the row carries none", () => {
      const policy = { windowDays: 45, sampleFloor: 25 };
      const { window_days: _window, ...older } = STAGE.metrics;

      expect(stageEstimate("replayed", STAGE.metrics, policy)).toMatchObject({
        sampleFloor: 25,
        windowDays: 30,
      });
      expect(stageEstimate("replayed", older, policy)).toMatchObject({
        sampleFloor: 25,
        windowDays: 45,
      });
    });

    it("serves the stored status of a row even when the floor has since risen past it", () => {
      expect(
        stageEstimate("replayed", STAGE.metrics, { windowDays: 30, sampleFloor: 500 }),
      ).toMatchObject({ status: "estimated", estimateMs: 242000, sampleCount: 214 });
    });

    it.each([
      ["no sample count", { estimate_ms: 242000, spread_ms: 20000 }],
      ["an estimate without its spread", { estimate_ms: 220000, sample_count: 204 }],
      ["a spread without its estimate", { spread_ms: 20000, sample_count: 204 }],
      ["an estimate on no samples", { estimate_ms: 242000, spread_ms: 20000, sample_count: 0 }],
      ["a number as text", { estimate_ms: "242000", spread_ms: 20000, sample_count: 214 }],
      ["a fractional estimate", { estimate_ms: 242000.5, spread_ms: 20000, sample_count: 214 }],
      ["a negative spread", { estimate_ms: 242000, spread_ms: -1, sample_count: 214 }],
      [
        "the marker beside a number",
        { insufficient_history: true, estimate_ms: 242000, spread_ms: 20000, sample_count: 12 },
      ],
      ["a marker that is not true", { insufficient_history: false, sample_count: 12 }],
      ["a window of no days", { insufficient_history: true, sample_count: 12, window_days: 0 }],
      ["nothing at all", {}],
    ])("answers null — never an invented number — for %s", (_name, metrics) => {
      expect(
        stageEstimate("replayed", { similarity_class: BUILD_CLASS, ...metrics }, REPLAY_POLICY),
      ).toBeNull();
    });

    it.each([
      ["a class that is not a string", 7],
      ["no class", undefined],
      ["a class of neither shape", "x"],
      ["a class that names no known executor", "helios-firmware · pool-a · docker · west build"],
      // A build in a repository named `tests` reads as a test run of the suite `container · …`.
      ["a class of both shapes", "pool-a · tests · container · ghcr.io/acme/sdk · make"],
    ])("leaves the formula null for %s, and still serves the stored numbers", (_name, value) => {
      expect(
        stageEstimate(
          "replayed",
          { estimate_ms: 242000, spread_ms: 20000, sample_count: 214, similarity_class: value },
          REPLAY_POLICY,
        ),
      ).toMatchObject({ status: "estimated", estimateMs: 242000, formula: null });
    });

    it("reads a shell build and a repository with no measured test run", () => {
      const formulaOf = (similarityClass: string): unknown =>
        stageEstimate(
          "replayed",
          { insufficient_history: true, sample_count: 0, similarity_class: similarityClass },
          REPLAY_POLICY,
        )?.formula;

      expect(formulaOf("pool-b · helios-firmware · shell · make -j8")).toEqual(BUILD_FORMULA);
      expect(formulaOf("helios-firmware · tests · no measured test run")).toEqual(TEST_FORMULA);
    });
  });

  it("shows an artifact with its truncation said", () => {
    const row: DryRunArtifact = {
      id: "a-1",
      organization_id: WORKSPACE,
      dry_run_id: RUN.id,
      kind: "overlay_diff",
      content: "@@",
      truncated: true,
      original_bytes: "70000",
      path_summary: [{ path: "drivers/can/arbitration.c", added: 41, removed: 9 }],
      created_at: new Date(),
    };

    expect(dryRunArtifact(row)).toEqual({
      kind: "overlay_diff",
      content: "@@",
      truncated: true,
      originalBytes: 70000,
      pathSummary: [{ path: "drivers/can/arbitration.c", added: 41, removed: 9 }],
    });
  });

  it("composes a dry run whole: the header, the totals, the rows — and the budget only when given", () => {
    const resource = dryRunResource(RUN, ticketRow(), [STAGE], [], REPLAY_POLICY);

    expect(resource).toMatchObject({
      id: RUN.id,
      draft: { baseVersion: null, rev: 3, label: "v0.3" },
      ticket: {
        id: TICKET_ID,
        key: "#489",
        url: "https://github.com/acme-robotics/helios-firmware/issues/489",
      },
      status: "complete",
      totals: { durationMs: 161000, costCents: 31, tokens: 96000 },
      guardsClean: true,
      startedAt: "2026-10-06T15:05:00.000Z",
      finishedAt: "2026-10-06T15:07:41.000Z",
    });
    expect(resource.stages).toHaveLength(1);
    expect(resource.stages[0]?.estimate).toMatchObject({ status: "estimated", sampleFloor: 20 });
    expect("budget" in resource).toBe(false);
    expect(
      dryRunResource(RUN, ticketRow(), [], [], REPLAY_POLICY, effectiveBudget(1000, 500)).budget,
    ).toEqual({
      capCents: 500,
      source: "draft_guard",
      workspaceCapCents: 1000,
      draftGuardCents: 500,
    });
  });

  it("keeps an open, unpriced run's totals null — never zero", () => {
    const open = dryRunResource(
      {
        ...RUN,
        status: "running",
        duration_ms: null,
        cost_cents: null,
        tokens: null,
        finished_at: null,
      },
      ticketRow(),
      [],
      [],
      REPLAY_POLICY,
    );

    expect(open.totals).toEqual({ durationMs: null, costCents: null, tokens: null });
    expect(open.finishedAt).toBeNull();
  });

  it("writes the history line's parts", () => {
    const history = dryRunHistory(
      workflowRow(),
      [{ ...RUN, ticket_key: "#489", ticket_title: "CAN storm" }],
      { runs: 1, cost_cents: 31, unpriced: 0 },
    );

    expect(history).toEqual({
      draft: { label: "v0.3", rev: 3, baseVersion: null, copilotEdits: 2 },
      count: 1,
      spend: { costCents: 31, unpriced: 0 },
      runs: [
        {
          id: RUN.id,
          draftLabel: "v0.3",
          draftRev: 3,
          ticket: { key: "#489", title: "CAN storm" },
          status: "complete",
          failureReason: null,
          totals: { durationMs: 161000, costCents: 31, tokens: 96000 },
          guardsClean: true,
          startedAt: "2026-10-06T15:05:00.000Z",
          finishedAt: "2026-10-06T15:07:41.000Z",
        },
      ],
    });
  });

  it("shows a candidate with its rank and reason", () => {
    const ticket = pickerTicket(ticketRow());
    const [candidate] = rankCandidates(DEFINITION, ticket === undefined ? [] : [ticket]);

    expect(candidate && dryRunCandidate(candidate)).toMatchObject({
      rank: 1,
      ticket: {
        id: TICKET_ID,
        key: "#489",
        labels: ["bug", "can-bus"],
        effort: "m",
        source: "github",
      },
      score: 1,
      dimensions: 1,
      matchesTrigger: false,
      reason: expect.stringContaining("no `security` label") as string,
    });
  });
});
