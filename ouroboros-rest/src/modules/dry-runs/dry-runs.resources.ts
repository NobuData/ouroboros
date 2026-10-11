/**
 * The dry run's wire shapes (CD.4, [#562](https://github.com/NobuData/ouroboros/issues/562)).
 *
 * Mockup 20's card, as data: the header (`DRY RUN — #489 …`, `2m 41s · $0.31`), the result rows
 * with the truth of how each was produced, the simulated diff, the guard audit, and the footer's
 * `history: 1 dry run · draft v0.3 (2 copilot edits applied)`.
 *
 * Three rules, kept from V111:
 *
 *   * **A cost is `null` when unpriced** — never a fabricated `0`.
 *   * **The `how` label is derived**, not stored, so it cannot drift from the truth it names:
 *     {@link stageHowLabel} is `dry_run_stage_how_label()` in this service's language.
 *   * **A populated guard audit is a failure signal**, and `guardsClean` is the audit's own
 *     emptiness, never a second opinion.
 */

import type {
  DraftProvenanceSummary,
  DryRun,
  DryRunArtifact,
  DryRunGuardAuditEntry,
  DryRunMode,
  DryRunPathChange,
  DryRunSkipKind,
  DryRunStage,
  DryRunStageHow,
  DryRunStageVerdict,
  DryRunStatus,
} from "../db/schema";
import type { EngineDryRunStage } from "../engine/engine.dryruns";
import type { PublishFinding } from "../workflows/publish.gate";
import type { DryRunBudget } from "./dry-runs.budget";
import type { PickerCandidate } from "./dry-runs.picker";
import type { DryRunSpendRow, DryRunTicketRow } from "./dry-runs.repository";

/** The ticket a dry run ran against. */
export interface DryRunTicketResource {
  readonly id: string;
  /** `#489`. */
  readonly key: string;
  readonly title: string;
  /** The ticket in its own tracker. */
  readonly url: string;
}

/** One result row of the card. */
export interface DryRunStageResource {
  readonly seq: number;
  readonly stageKey: string;
  /** What the card prints — `review ×2`. */
  readonly displayName: string;
  readonly verdict: DryRunStageVerdict;
  readonly how: DryRunStageHow;
  /** `replayed from history` | `skipped` | `simulated` | `null`. */
  readonly howLabel: string | null;
  readonly note: string;
  readonly metrics: Readonly<Record<string, unknown>>;
  readonly skipReason: string | null;
  /** Why it skipped, as a value — `null` unless the row skipped (and on rows older than V128). */
  readonly skipKind: DryRunSkipKind | null;
  /** On a `nothing_to_do` skip, the ticket label that would have carried the missing input. */
  readonly skipInput: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

/** The overlay diff, or an excerpt. */
export interface DryRunArtifactResource {
  readonly kind: DryRunArtifact["kind"];
  readonly content: string;
  /** Whether `content` is a prefix of something larger. */
  readonly truncated: boolean;
  readonly originalBytes: number;
  /** `[{path, added, removed}]` on the diff; `null` on an excerpt. */
  readonly pathSummary: readonly DryRunPathChange[] | null;
}

/** The budget a dry run was started under. */
export interface DryRunBudgetResource {
  /** The most the run may spend, in cents. */
  readonly capCents: number;
  /** Which cap decided it. */
  readonly source: DryRunBudget["source"];
  readonly workspaceCapCents: number;
  /** The draft's own spend guard, or `null` when it carries none. */
  readonly draftGuardCents: number | null;
}

/** One dry run. */
export interface DryRunResource {
  readonly id: string;
  readonly workflowId: string;
  /** The draft under test. */
  readonly draft: {
    readonly baseVersion: number | null;
    readonly rev: number;
    /** `v0.3`. */
    readonly label: string;
  };
  readonly ticket: DryRunTicketResource;
  /** The copilot session that proposed it, or `null`. */
  readonly sessionId: string | null;
  /** The commit the virtual workspace read at. */
  readonly pinnedSha: string;
  readonly mode: DryRunMode;
  /**
   * `precheck` → `running` → `complete` | `failed` | `budget_stopped` | `cancelled`. The four
   * ends are distinct: a cancelled run was stopped by a person, a budget stop reached its cap,
   * and a failure broke (or had to block a call).
   */
  readonly status: DryRunStatus;
  /** Why it stopped — set exactly for `failed` and `budget_stopped`. */
  readonly failureReason: string | null;
  /** Wall time, tokens and cost; each `null` until known (cost also when unpriced). */
  readonly totals: {
    readonly durationMs: number | null;
    readonly costCents: number | null;
    readonly tokens: number | null;
  };
  /** Every call the tool boundary refused; `[]` on a clean run. */
  readonly guardAudit: readonly DryRunGuardAuditEntry[];
  /** Whether {@link guardAudit} is empty. */
  readonly guardsClean: boolean;
  /** The structural pre-check's anchored findings; `null` until it has run. */
  readonly precheckFindings: readonly PublishFinding[] | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  /** The result rows so far, in card order. */
  readonly stages: readonly DryRunStageResource[];
  /** The simulated diff and excerpts. */
  readonly artifacts: readonly DryRunArtifactResource[];
  /** The budget it was started under — present on the answer to a start or a re-run. */
  readonly budget?: DryRunBudgetResource;
}

/** One line of the history. */
export interface DryRunSummaryResource {
  readonly id: string;
  readonly draftLabel: string;
  readonly draftRev: number;
  readonly ticket: { readonly key: string; readonly title: string };
  readonly status: DryRunStatus;
  readonly failureReason: string | null;
  readonly totals: DryRunResource["totals"];
  readonly guardsClean: boolean;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

/** What `GET /api/v1/workflows/{id}/dry-runs` answers — the footer's line, and what is behind it. */
export interface DryRunHistoryResource {
  /** The draft as it stands now — `draft v0.3 (2 copilot edits applied)`. */
  readonly draft: {
    readonly label: string;
    readonly rev: number;
    readonly baseVersion: number | null;
    /** Operation batches the copilot applied to the current draft. */
    readonly copilotEdits: number;
  };
  /** How many dry runs this workflow has had — the `N` of `history: N dry runs`. */
  readonly count: number;
  /**
   * The workflow's dry-run accounting: what its dry runs cost. Kept apart from loop spend — it
   * is in no run, stage or usage figure.
   */
  readonly spend: {
    /** The sum of priced dry runs, or `null` when none was priced. */
    readonly costCents: number | null;
    /** Finished dry runs that carry no price. */
    readonly unpriced: number;
  };
  /** Newest first; runs of the same draft revision and ticket sit together for comparison. */
  readonly runs: readonly DryRunSummaryResource[];
}

/** One ranked candidate of the picker. */
export interface DryRunCandidateResource {
  readonly rank: number;
  readonly ticket: DryRunTicketResource & {
    readonly labels: readonly string[];
    readonly effort: string | null;
    readonly source: string;
  };
  /** How many of the draft's ticket-testing dimensions it mismatches. */
  readonly score: number;
  /** How many such dimensions the draft has. */
  readonly dimensions: number;
  /** Whether the ticket would trigger the workflow as drafted. */
  readonly matchesTrigger: boolean;
  readonly mismatches: PickerCandidate["mismatches"];
  /** Why it ranks where it does, as one sentence. */
  readonly reason: string;
}

/** What `GET /api/v1/workflows/{id}/dry-runs/candidates` answers. */
export interface DryRunCandidatesResource {
  /** The draft the ranking is for. */
  readonly draftLabel: string;
  readonly candidates: readonly DryRunCandidateResource[];
}

/**
 * The label of the draft a run tested.
 *
 * @param baseVersion - The published version it was based on, or `null`.
 * @param draftRev - The draft revision.
 * @returns `v{base or 0}.{rev}`.
 */
export function dryRunDraftLabel(baseVersion: number | null, draftRev: number): string {
  return `v${baseVersion ?? 0}.${draftRev}`;
}

/**
 * The label a result row shows beside its stage name — `dry_run_stage_how_label()` (V111).
 *
 * @param how - How the row's result was produced.
 * @param metrics - The row's metrics.
 * @returns `replayed from history` for a replay, `skipped` for a skip, `simulated` for a model
 *   stage whose writes were virtualized, and `null` otherwise.
 */
export function stageHowLabel(
  how: DryRunStageHow,
  metrics: Readonly<Record<string, unknown>>,
): string | null {
  if (how === "replayed") return "replayed from history";
  if (how === "skipped") return "skipped";

  const writes = metrics.simulated_writes;
  return how === "llm" && typeof writes === "number" && writes > 0 ? "simulated" : null;
}

/**
 * A nullable `bigint` column as a number.
 *
 * @param value - What the driver returned.
 * @returns The number, or `null`.
 */
function bigintOrNull(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * A stored stage row, as the API shows it.
 *
 * @param row - The row.
 * @returns The resource.
 */
export function dryRunStage(row: DryRunStage): DryRunStageResource {
  return {
    seq: row.seq,
    stageKey: row.stage_key,
    displayName: row.display_name,
    verdict: row.verdict,
    how: row.how,
    howLabel: stageHowLabel(row.how, row.metrics),
    note: row.note,
    metrics: row.metrics,
    skipReason: row.skip_reason,
    skipKind: row.skip_kind,
    skipInput: row.skip_input,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}

/**
 * A stage row as the harness streamed it — the same resource a stored row makes, so a live row
 * and the row a reload reads are one shape.
 *
 * @param stage - The harness's row.
 * @returns The resource.
 */
export function streamedStage(stage: EngineDryRunStage): DryRunStageResource {
  return {
    seq: stage.seq,
    stageKey: stage.stageKey,
    displayName: stage.displayName,
    verdict: stage.verdict,
    how: stage.how,
    howLabel: stageHowLabel(stage.how, stage.metrics),
    note: stage.note,
    metrics: stage.metrics,
    skipReason: stage.skipReason,
    skipKind: stage.skipKind,
    skipInput: stage.skipInput,
    startedAt: stage.startedAt === null ? null : new Date(stage.startedAt).toISOString(),
    finishedAt: stage.finishedAt === null ? null : new Date(stage.finishedAt).toISOString(),
  };
}

/**
 * A stored artifact, as the API shows it.
 *
 * @param row - The row.
 * @returns The resource.
 */
export function dryRunArtifact(row: DryRunArtifact): DryRunArtifactResource {
  return {
    kind: row.kind,
    content: row.content,
    truncated: row.truncated,
    originalBytes: Number(row.original_bytes),
    pathSummary: row.path_summary,
  };
}

/**
 * A budget, as the API shows it.
 *
 * @param budget - The budget.
 * @returns The resource.
 */
export function dryRunBudget(budget: DryRunBudget): DryRunBudgetResource {
  return {
    capCents: budget.capCents,
    source: budget.source,
    workspaceCapCents: budget.workspaceCapCents,
    draftGuardCents: budget.draftGuardCents,
  };
}

/**
 * The totals of a run.
 *
 * @param run - The row.
 * @returns Duration, cost and tokens, each `null` until known.
 */
function totalsOf(run: DryRun): DryRunResource["totals"] {
  return {
    durationMs: bigintOrNull(run.duration_ms),
    costCents: run.cost_cents,
    tokens: bigintOrNull(run.tokens),
  };
}

/**
 * One dry run, whole.
 *
 * @param run - The row.
 * @param ticket - The ticket it ran against.
 * @param stages - Its result rows.
 * @param artifacts - Its artifacts.
 * @param budget - The budget it was started under, on a start's answer.
 * @returns The resource.
 */
export function dryRunResource(
  run: DryRun,
  ticket: Pick<DryRunTicketRow, "id" | "external_key" | "title" | "external_url">,
  stages: readonly DryRunStage[],
  artifacts: readonly DryRunArtifact[],
  budget?: DryRunBudget,
): DryRunResource {
  return {
    id: run.id,
    workflowId: run.workflow_id,
    draft: {
      baseVersion: run.base_version,
      rev: run.draft_rev,
      label: dryRunDraftLabel(run.base_version, run.draft_rev),
    },
    ticket: {
      id: ticket.id,
      key: ticket.external_key,
      title: ticket.title,
      url: ticket.external_url,
    },
    sessionId: run.session_id,
    pinnedSha: run.pinned_sha,
    mode: run.mode,
    status: run.status,
    failureReason: run.failure_reason,
    totals: totalsOf(run),
    guardAudit: run.guard_audit,
    guardsClean: run.guards_clean,
    precheckFindings: run.precheck_findings as PublishFinding[] | null,
    startedAt: run.started_at.toISOString(),
    finishedAt: run.finished_at?.toISOString() ?? null,
    stages: stages.map(dryRunStage),
    artifacts: artifacts.map(dryRunArtifact),
    ...(budget === undefined ? {} : { budget: dryRunBudget(budget) }),
  };
}

/**
 * The history, from its rows.
 *
 * @param workflow - The workflow's draft position and provenance.
 * @param workflow.current_version - The version in force, or `null`.
 * @param workflow.draft_rev - The draft's revision.
 * @param workflow.provenance_summary - Batches per actor on the current draft.
 * @param runs - The runs, newest first, each with its ticket's key and title.
 * @param spend - The workflow's dry-run accounting.
 * @returns The resource.
 */
export function dryRunHistory(
  workflow: {
    readonly current_version: number | null;
    readonly draft_rev: number;
    readonly provenance_summary: DraftProvenanceSummary;
  },
  runs: readonly (DryRun & { ticket_key: string; ticket_title: string })[],
  spend: DryRunSpendRow,
): DryRunHistoryResource {
  return {
    draft: {
      label: dryRunDraftLabel(workflow.current_version, workflow.draft_rev),
      rev: workflow.draft_rev,
      baseVersion: workflow.current_version,
      copilotEdits: workflow.provenance_summary.copilot,
    },
    count: spend.runs,
    spend: { costCents: spend.cost_cents, unpriced: spend.unpriced },
    runs: runs.map((run) => ({
      id: run.id,
      draftLabel: dryRunDraftLabel(run.base_version, run.draft_rev),
      draftRev: run.draft_rev,
      ticket: { key: run.ticket_key, title: run.ticket_title },
      status: run.status,
      failureReason: run.failure_reason,
      totals: totalsOf(run),
      guardsClean: run.guards_clean,
      startedAt: run.started_at.toISOString(),
      finishedAt: run.finished_at?.toISOString() ?? null,
    })),
  };
}

/**
 * One ranked candidate, as the API shows it.
 *
 * @param candidate - The picker's candidate.
 * @returns The resource.
 */
export function dryRunCandidate(candidate: PickerCandidate): DryRunCandidateResource {
  return {
    rank: candidate.rank,
    ticket: {
      id: candidate.ticket.id,
      key: candidate.ticket.key,
      title: candidate.ticket.title,
      url: candidate.ticket.url,
      labels: candidate.ticket.labels,
      effort: candidate.ticket.effort,
      source: candidate.ticket.source,
    },
    score: candidate.score,
    dimensions: candidate.dimensions,
    matchesTrigger: candidate.matchesTrigger,
    mismatches: candidate.mismatches,
    reason: candidate.reason,
  };
}
