import type { DryRun, DryRunArtifact, DryRunStage } from "../db/schema";
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
  stageHowLabel,
  streamedStage,
} from "./dry-runs.resources";
import {
  DEFINITION,
  PINNED_SHA,
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
  metrics: { estimate_ms: 242000, sample_count: 214, spread_ms: 20000, similarity_class: "x" },
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
    expect(dryRunStage(STAGE)).toEqual({
      seq: 4,
      stageKey: "build",
      displayName: "build",
      verdict: "ok",
      how: "replayed",
      howLabel: "replayed from history",
      note: "est. 4m 02s (214 similar builds, ±20s)",
      metrics: STAGE.metrics,
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
    );
    expect(Object.keys(streamed)).toEqual(Object.keys(dryRunStage(STAGE)));
    expect(streamed).toMatchObject({
      howLabel: "skipped",
      skipReason: 'Task kind "exploit-verify" has no route yet',
      skipKind: "unresolved_reference",
      skipInput: null,
      startedAt: null,
      finishedAt: "2026-10-06T15:07:00.000Z",
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
    const resource = dryRunResource(RUN, ticketRow(), [STAGE], []);

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
    expect("budget" in resource).toBe(false);
    expect(dryRunResource(RUN, ticketRow(), [], [], effectiveBudget(1000, 500)).budget).toEqual({
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
