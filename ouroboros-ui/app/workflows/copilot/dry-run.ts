/**
 * Every decision the dry-run card makes, as functions with inputs and outputs (CE.4,
 * [#568](https://github.com/NobuData/ouroboros/issues/568)) — mockup 20's `DRY RUN — #489 …` card.
 *
 * The card puts estimates, simulations and skips beside genuine results in rows that look alike,
 * so every honesty problem on the page lives here. Each judgement is a function so its
 * acceptance criterion is a unit test on a small value: which mark a verdict gets, what a
 * replayed row's provenance says and what it says when there was not enough history to say
 * anything, which of the run's ends is drawn, what an Apply will do before it does it, and why a
 * control cannot act.
 *
 * **Framework-free and pure**, the way `copilot-view.ts` is: nothing here imports React, `next/*`
 * or the server-only client — the API types are type-only imports, erased before a Client
 * Component could pull them in.
 *
 * ### The service's words are printed, not paraphrased
 *
 * A row's `how` label and its note, a failure's reason, a candidate's reason, a refusal's
 * sentence and a rule's description are the service's and are drawn as served. This module adds
 * the frame around them — headings, marks, the sentences that say what a control will do.
 */

import type { components } from "@/app/api/schema";
import { moneyOfCents, spanOfMs } from "@/app/format";

import { type OperationShape, operationPhrase } from "./conversation";

/* ------------------------------------------------------------------ what the card reads */

/** One dry run, in full. */
export type DryRun = components["schemas"]["DryRun"];

/** One result row. `estimate` is `null` on every row that is not a replay. */
export type DryRunStage = components["schemas"]["DryRunStage"];

/**
 * A replayed row's provenance — the estimate with its sample, or the honest absence of one.
 *
 * `estimated` carries the median and its spread; `insufficient_history` carries **no number**:
 * only how many similar samples the window held and how many the policy needs.
 */
export type StageEstimate = components["schemas"]["DryRunStageEstimate"];

/** The simulated diff, or an excerpt. */
export type DryRunArtifact = components["schemas"]["DryRunArtifact"];

/** A workflow's dry-run history. */
export type DryRunHistory = components["schemas"]["DryRunHistory"];

/** One callout. */
export type DryRunSuggestion = components["schemas"]["DryRunSuggestion"];

/** A suggestion's derivation. */
export type DryRunExplanation = components["schemas"]["DryRunSuggestionExplanation"];

/** What an Apply answers. */
export type DryRunApplied = components["schemas"]["DryRunSuggestionApplied"];

/** One ranked candidate of the picker. */
export type DryRunCandidate = components["schemas"]["DryRunCandidate"];

/** One call the tool boundary refused. */
export type GuardAuditEntry = components["schemas"]["DryRunGuardAuditEntry"];

/** A pre-check finding, anchored to its stage. */
export type DryRunFinding = components["schemas"]["WorkflowFinding"];

/** One event of a run's stream. */
export type DryRunStreamEvent =
  | { readonly kind: "accepted"; readonly dryRun: DryRun }
  | { readonly kind: "stage_started"; readonly seq: number; readonly stageKey: string; readonly displayName: string }
  | { readonly kind: "stage_finished"; readonly stage: DryRunStage }
  | { readonly kind: "guard_blocked"; readonly guard: string; readonly call: string; readonly stageKey: string }
  | { readonly kind: "done"; readonly dryRun: DryRun };

/** The names of the stream's events, as the service spells them. */
export const DRY_RUN_EVENT_KINDS = ["accepted", "stage_started", "stage_finished", "guard_blocked", "done"] as const;

/**
 * What the route read for the card: the history, the newest run in full, and its suggestions.
 *
 * `run` is `null` for a workflow that has never been dry-run. `suggestions` is `null` when they
 * could not be read — the card then says so rather than drawing none.
 */
export interface DryRunBoard {
  /** The history — the draft as it stands, and how many runs there have been. */
  readonly history: DryRunHistory;
  /** The newest run, or `null`. */
  readonly run: DryRun | null;
  /** That run's suggestions, in card order; `null` when the read was refused. */
  readonly suggestions: readonly DryRunSuggestion[] | null;
}

/* ------------------------------------------------------------------ the head */

/** The card's heading before any run — and the seat's. */
export const DRY_RUN_TITLE = "Dry run";

/** The pill beside the title, verbatim from mockup 20. */
export const SIMULATED_PILL = "simulated — no writes · no PRs · no merges";

/** The banner over a dry-run read that was refused. */
export const DRY_RUN_FAILED_HEADLINE = "The dry run could not be read.";

/**
 * The card's heading — *Dry run — #489 CAN arbitration-lost storm…*.
 *
 * @param ticket The run's ticket, or `null` before any run.
 * @returns The heading. The sheet sets it in capitals, as it does every card title.
 */
export function dryRunTitle(ticket: Pick<DryRun["ticket"], "key" | "title"> | null): string {
  return ticket === null ? DRY_RUN_TITLE : `${DRY_RUN_TITLE} — ${ticket.key} ${ticket.title}`;
}

/** Whether a status is one a run has before it ends. */
export function isLive(status: DryRun["status"]): boolean {
  return status === "precheck" || status === "running";
}

/**
 * A finished run's totals — `2m 41s · $0.31`.
 *
 * @param totals The run's totals.
 * @returns The parts to join: the wall time when it is known, and the cost when the run was
 *   priced. An unpriced run draws no cost at all — an absent price is never a zero.
 */
export function totalsParts(totals: DryRun["totals"]): readonly string[] {
  const parts: string[] = [];

  if (totals.durationMs !== null) parts.push(spanOfMs(totals.durationMs));
  if (totals.costCents !== null) parts.push(moneyOfCents(totals.costCents));

  return parts;
}

/** What separates the totals' parts, and a row's. */
export const SEPARATOR = " · ";

/**
 * What stands in the totals' place while a run is in flight.
 *
 * @param status `precheck` or `running`.
 * @param startedAt When the run started, ISO 8601.
 * @param now The present, in epoch milliseconds.
 * @returns *checking the draft · 4s* or *running · 1m 12s*.
 */
export function elapsedLine(status: DryRun["status"], startedAt: string, now: number): string {
  const started = Date.parse(startedAt);
  const elapsed = spanOfMs(Number.isFinite(started) ? Math.max(0, now - started) : 0);

  return `${status === "precheck" ? "checking the draft" : "running"}${SEPARATOR}${elapsed}`;
}

/* ------------------------------------------------------------------ the rows */

/** What a row's mark says. */
export type RowTone = "ok" | "warn" | "idle" | "err" | "live";

/** A verdict's mark, its hue, and what a screen reader hears in its place. */
export interface VerdictMark {
  readonly glyph: string;
  readonly tone: RowTone;
  readonly word: string;
}

/** Each verdict's mark — mockup 20's `✓`, `⏸` and `○`, and `✕` for the failure it does not draw. */
export const VERDICT_MARKS: Readonly<Record<DryRunStage["verdict"], VerdictMark>> = {
  ok: { glyph: "✓", tone: "ok", word: "passed" },
  skipped: { glyph: "⏸", tone: "warn", word: "skipped" },
  not_reached: { glyph: "○", tone: "idle", word: "not run" },
  failed: { glyph: "✕", tone: "err", word: "failed" },
};

/** The mark of a stage the stream says has started and not finished. */
export const RUNNING_MARK: VerdictMark = { glyph: "◌", tone: "live", word: "running" };

/** What a running row says in its note's place. */
export const RUNNING_NOTE = "running…";

/** What the rows' place says while the pre-check runs and no stage has started. */
export const QUEUED_NOTE = "Queued — the draft is being checked before any stage runs.";

/** What the rows' place says when a run is going and no stage has been announced yet. */
export const WAITING_NOTE = "Waiting for the first stage…";

/** What the card says while a run is polled because its stream cannot be followed. */
export const POLLING_NOTE = "The live stream is not available, so this run is read again every few seconds.";

/** The refusal's dismissal. */
export const DISMISS_LABEL = "Dismiss";

/** The rows' accessible name. */
export const ROWS_LABEL = "Dry-run results";

/** One row of the card. */
export interface ResultRow {
  /** A stable key — the stage's place on the card. */
  readonly seq: number;
  /** The stage's key, as the run names it. */
  readonly stageKey: string;
  /** What the card prints — `review ×2`. */
  readonly name: string;
  /** The verdict's mark. */
  readonly mark: VerdictMark;
  /** The `how` label — `simulated`, `replayed from history`, `skipped` — or `null` for a real result. */
  readonly how: string | null;
  /** Whether the row is a skip, which the label and the note wear on the warning hue. */
  readonly warn: boolean;
  /** The service's composed note, verbatim. */
  readonly note: string;
  /** The row's provenance, when it is a replay. */
  readonly estimate: StageEstimate | null;
  /** Whether the stage has started and not finished. */
  readonly running: boolean;
}

/** A stage the stream announced. */
export interface StartedStage {
  readonly seq: number;
  readonly stageKey: string;
  readonly displayName: string;
}

/**
 * Compose the card's rows: every finished stage in `seq` order, then the ones that have started.
 *
 * @param stages The run's stages.
 * @param started The stages the stream says are running.
 * @returns The rows.
 */
export function resultRows(stages: readonly DryRunStage[], started: readonly StartedStage[] = []): readonly ResultRow[] {
  const finished: ResultRow[] = stages.map((stage) => ({
    seq: stage.seq,
    stageKey: stage.stageKey,
    name: stage.displayName,
    mark: VERDICT_MARKS[stage.verdict],
    how: stage.howLabel,
    warn: stage.verdict === "skipped",
    note: stage.note,
    estimate: stage.estimate,
    running: false,
  }));
  const seen = new Set(finished.map((row) => row.seq));
  const running: ResultRow[] = started
    .filter((stage) => !seen.has(stage.seq))
    .map((stage) => ({
      seq: stage.seq,
      stageKey: stage.stageKey,
      name: stage.displayName,
      mark: RUNNING_MARK,
      how: null,
      warn: false,
      note: RUNNING_NOTE,
      estimate: null,
      running: true,
    }));

  return [...finished, ...running].sort((a, b) => a.seq - b.seq);
}

/* ------------------------------------------------------------------ a replayed row's provenance */

/**
 * The name of a row's provenance control.
 *
 * @param name The stage's name.
 * @returns *Where build's estimate comes from*.
 */
export function estimateButtonName(name: string): string {
  return `Where ${name}'s estimate comes from`;
}

/** One line of a provenance: a term and what it is. */
export interface Fact {
  readonly term: string;
  readonly value: string;
}

/** What a replayed row's disclosure says. */
export interface EstimateNote {
  /** Whether there is a number at all. */
  readonly estimated: boolean;
  /** The sentence that leads — for `insufficient_history`, the whole of it. */
  readonly lead: string;
  /** The estimate's parts — empty when there is no number. */
  readonly facts: readonly Fact[];
  /**
   * The registered formula — its id and version, then its summary — or `null` when the service
   * could not tell which applies. No line is drawn then: the card never guesses one.
   */
  readonly formula: string | null;
}

/**
 * What kind of thing a formula samples — *builds* for the build replay, *runs* for the rest.
 *
 * @param estimate The provenance.
 * @returns The plural noun.
 */
function sampleNoun(estimate: StageEstimate): "builds" | "runs" {
  return estimate.formula?.id.startsWith("build") === true ? "builds" : "runs";
}

/**
 * What a replayed row's disclosure says.
 *
 * An estimate is drawn with everything a reader needs to decide how far to trust it: the sample
 * count, the spread, the window and the formula. `insufficient_history` draws **no number
 * anywhere** — only how many were found and how many are needed.
 *
 * @param estimate The row's provenance.
 * @returns The note.
 */
export function estimateNote(estimate: StageEstimate): EstimateNote {
  const formula =
    estimate.formula === null
      ? null
      : `formula ${estimate.formula.id} v${estimate.formula.version} — ${estimate.formula.summary}`;
  const noun = sampleNoun(estimate);

  if (estimate.status !== "estimated" || estimate.estimateMs === null) {
    return {
      estimated: false,
      lead:
        `Not enough history: ${estimate.sampleCount} similar ${estimate.sampleCount === 1 ? noun.slice(0, -1) : noun} ` +
        `in the last ${estimate.windowDays} days, ${estimate.sampleFloor} needed.`,
      facts: [],
      formula,
    };
  }

  const facts: Fact[] = [
    { term: "estimate", value: spanOfMs(estimate.estimateMs) },
    { term: "sample", value: `n = ${estimate.sampleCount}` },
  ];
  if (estimate.spreadMs !== null) facts.push({ term: "spread", value: `± ${spanOfMs(estimate.spreadMs)}` });
  facts.push({ term: "window", value: `${estimate.windowDays}-day window` });

  return {
    estimated: true,
    lead: `An estimate replayed from history, not a measurement — the ${noun.slice(0, -1)} did not run.`,
    facts,
    formula,
  };
}

/* ------------------------------------------------------------------ the run's end */

/** Which of a run's states the card draws. */
export type RunOutcome =
  | "precheck"
  | "running"
  | "complete"
  | "guard_violation"
  | "precheck_failed"
  | "failed"
  | "budget_stopped"
  | "cancelled";

/**
 * Decide which state a run is in.
 *
 * A guard that had to hold outranks everything: a run whose tool boundary refused a call is a
 * real problem whatever status it ended with, and must not read as an ordinary failure. A failed
 * run that carries pre-check findings failed before any stage ran, and its findings — not its
 * reason — are what the reader needs.
 *
 * @param run The run.
 * @returns The state.
 */
export function runOutcome(run: Pick<DryRun, "status" | "guardsClean" | "guardAudit" | "precheckFindings">): RunOutcome {
  if (!run.guardsClean || run.guardAudit.length > 0) return "guard_violation";

  switch (run.status) {
    case "precheck":
    case "running":
    case "complete":
    case "budget_stopped":
    case "cancelled":
      return run.status;
    case "failed":
      return run.precheckFindings !== null && run.precheckFindings.length > 0 ? "precheck_failed" : "failed";
  }
}

/** The heading over a guard-audit violation. */
export const GUARD_HEADING = "A guard had to stop this dry run";

/** What follows it: why this is not an ordinary failure. */
export const GUARD_NOTE =
  "The harness tried something a dry run must never do, and the tool boundary refused it. " +
  "Nothing was written — but do not trust this run's results, and do not promote this draft until you know why.";

/** The heading over a failed pre-check. */
export const PRECHECK_HEADING = "The draft did not pass the pre-check";

/** What follows it. */
export const PRECHECK_NOTE = "No stage ran. Each finding leads to the stage it is about.";

/** The heading over a run that failed. */
export const FAILED_HEADING = "This dry run failed";

/** What stands in for a failure's reason when the service gave none. */
export const FAILED_FALLBACK = "The service did not say why.";

/** The heading over a run its budget stopped. */
export const BUDGET_HEADING = "This dry run was stopped at its budget";

/** The heading over a cancelled run. */
export const CANCELLED_HEADING = "This dry run was cancelled";

/** What follows a stopped or cancelled run's heading. */
export const PARTIAL_NOTE = "The rows it reached are kept below.";

/**
 * Which cap stopped a run, and what it was.
 *
 * @param budget The budget the run was started under, when the service sent one.
 * @returns *Its cap was $5.00 — the draft's own spend guard.*, or `null` when no budget was sent.
 */
export function budgetLine(budget: DryRun["budget"] | undefined): string | null {
  if (budget === undefined) return null;

  const source = budget.source === "draft_guard" ? "the draft's own spend guard" : "the workspace's dry-run cap";

  return `Its cap was ${moneyOfCents(budget.capCents)} — ${source}.`;
}

/**
 * What a budget-stopped run had spent (CE.5, #569).
 *
 * @param totals The run's totals.
 * @returns *It had spent $4.98 when it was stopped.*, or `null` for an unpriced run — an absent
 *   price is never a zero.
 */
export function budgetSpentLine(totals: DryRun["totals"]): string | null {
  return totals.costCents === null ? null : `It had spent ${moneyOfCents(totals.costCents)} when it was stopped.`;
}

/** What to change after the draft's own spend guard stopped a run. */
export const BUDGET_ADVICE_DRAFT_GUARD =
  "To let it finish, ask the copilot to raise the draft's per-run spend cap, or make the model stages cheaper, then re-run.";

/** What to change after the workspace's dry-run cap stopped a run. */
export const BUDGET_ADVICE_WORKSPACE_CAP =
  "To let it finish, make the draft's model stages cheaper, or ask a workspace owner to raise the workspace's dry-run cap, then re-run.";

/** What to change when the service did not say which cap it was. */
export const BUDGET_ADVICE_FALLBACK = "To let it finish, make the draft's model stages cheaper, then re-run.";

/**
 * What to change so the next run is not stopped at its budget (CE.5, #569).
 *
 * @param budget The budget the run was started under, when the service sent one.
 * @returns The advice for the cap that stopped it.
 */
export function budgetAdvice(budget: DryRun["budget"] | undefined): string {
  if (budget === undefined) return BUDGET_ADVICE_FALLBACK;

  return budget.source === "draft_guard" ? BUDGET_ADVICE_DRAFT_GUARD : BUDGET_ADVICE_WORKSPACE_CAP;
}

/**
 * One blocked call, as the alert lists it.
 *
 * @param entry The audit's entry.
 * @returns *`git push origin main` — refused by allow_list, 2 times, in stage implement*.
 */
export function guardLine(entry: GuardAuditEntry): string {
  const times = entry.count === 1 ? "once" : `${entry.count} times`;
  const stage = entry.stage_key === undefined ? "" : `, in stage ${entry.stage_key}`;

  return `${entry.call} — refused by ${entry.guard}, ${times}${stage}`;
}

/**
 * The polite announcement a run's start or end makes — one per run, never one per row.
 *
 * @param run The run.
 * @returns The sentence.
 */
export function runAnnouncement(run: Pick<DryRun, "status" | "guardsClean" | "guardAudit" | "precheckFindings" | "ticket">): string {
  const on = `Dry run on ${run.ticket.key}`;

  switch (runOutcome(run)) {
    case "precheck":
    case "running":
      return `${on} started.`;
    case "complete":
      return `${on} finished.`;
    case "guard_violation":
      return `${on} was stopped by a guard.`;
    case "precheck_failed":
      return `${on} did not pass the pre-check.`;
    case "failed":
      return `${on} failed.`;
    case "budget_stopped":
      return `${on} was stopped at its budget.`;
    case "cancelled":
      return `${on} was cancelled.`;
  }
}

/* ------------------------------------------------------------------ the simulated diff */

/** The line inside the diff block that says what it is — the ticket's words. */
export const DIFF_HEADLINE = "simulated diff (never written to repo)";

/** The diff scroller's accessible name. */
export const DIFF_SCROLL_LABEL = "Simulated diff, scrollable";

/** What a diff line is. */
export type DiffLineKind = "file" | "hunk" | "add" | "del" | "ctx";

/** One line of the diff. */
export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
}

/**
 * Read a unified diff into lines the block can colour.
 *
 * @param content The artifact's content.
 * @returns Its lines; a trailing newline adds none.
 */
export function diffLines(content: string): readonly DiffLine[] {
  const lines = content.replace(/\n$/, "").split("\n");

  return lines.map((text) => {
    if (text.startsWith("+++ ") || text.startsWith("--- ") || text.startsWith("diff ")) return { kind: "file", text };
    if (text.startsWith("@@")) return { kind: "hunk", text };
    if (text.startsWith("+")) return { kind: "add", text };
    if (text.startsWith("-")) return { kind: "del", text };

    return { kind: "ctx", text };
  });
}

/**
 * The run's simulated diff, if it has one.
 *
 * @param artifacts The run's artifacts.
 * @returns The `overlay_diff`, or `null`. Plan and review excerpts are not diffs and are not drawn.
 */
export function overlayDiff(artifacts: readonly DryRunArtifact[]): DryRunArtifact | null {
  return artifacts.find((artifact) => artifact.kind === "overlay_diff") ?? null;
}

/**
 * The diff's files with their ± counts — `drivers/can/arbitration.c +41 −9`.
 *
 * @param artifact The diff.
 * @returns One line per file, from the artifact's own record.
 */
export function diffSummary(artifact: Pick<DryRunArtifact, "pathSummary">): readonly string[] {
  return (artifact.pathSummary ?? []).map((file) => `${file.path} +${file.added} −${file.removed}`);
}

/**
 * A byte count a person can read.
 *
 * @param bytes How many.
 * @returns `812 B`, `64.0 KB`, `1.2 MB`.
 */
export function bytesOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * What a truncated diff says of itself.
 *
 * @param artifact The diff.
 * @returns *Truncated — showing the first 64.0 KB of 212.4 KB.*, or `null` for a whole diff.
 */
export function truncationLine(artifact: Pick<DryRunArtifact, "content" | "truncated" | "originalBytes">): string | null {
  if (!artifact.truncated) return null;

  const shown = new TextEncoder().encode(artifact.content).length;

  return `Truncated — showing the first ${bytesOf(shown)} of ${bytesOf(artifact.originalBytes)}.`;
}

/* ------------------------------------------------------------------ the suggestions */

/** The mark that leads a callout. */
export const SUGGESTION_MARK = "✦";

/** The callouts' accessible name. */
export const SUGGESTIONS_LABEL = "Suggestions";

/** The three actions. */
export const APPLY_LABEL = "Apply to draft";
export const EXPLAIN_LABEL = "Explain";
export const IGNORE_LABEL = "Ignore";

/** The label an LLM-sourced suggestion wears in the place of a confidence. */
export const LLM_LABEL = "from the model · unscored";

/** Why an advisory suggestion's Apply cannot act. */
export const ADVISORY_REASON = "This suggestion is advice only — it proposes no change to apply.";

/** Why a viewer's suggestion actions cannot act. */
export const SUGGESTION_ROLE_REASON = "Applying and ignoring suggestions is for workspace owners, admins and members.";

/** What the callouts' place says when the suggestions could not be read. */
export const SUGGESTIONS_UNREAD = "This run's suggestions could not be read. Reload the page to try again.";

/** What the callouts' place says while they are being fetched after a live run. */
export const SUGGESTIONS_LOADING = "Reading this run's suggestions…";

/** The quiet line an ignore leaves. */
export const IGNORED_NOTE = "it will not be raised again for this draft revision";

/**
 * A suggestion's provenance, quietly — *rule · skipped-nothing-to-do v1*, or the model's label.
 *
 * @param suggestion The suggestion.
 * @returns The line.
 */
export function sourceLine(suggestion: Pick<DryRunSuggestion, "source" | "ruleId" | "ruleVersion">): string {
  if (suggestion.source === "llm" || suggestion.ruleId === null) return LLM_LABEL;

  return suggestion.ruleVersion === null
    ? `rule${SEPARATOR}${suggestion.ruleId}`
    : `rule${SEPARATOR}${suggestion.ruleId} v${suggestion.ruleVersion}`;
}

/**
 * A suggestion's confidence, as its button prints it.
 *
 * @param suggestion The suggestion.
 * @returns `93%` — or `null` for a model's suggestion, which is never scored and draws no percentage.
 */
export function confidenceText(suggestion: Pick<DryRunSuggestion, "source" | "confidence">): string | null {
  return suggestion.source === "llm" || suggestion.confidence === null ? null : `${suggestion.confidence}%`;
}

/**
 * The name of a confidence's control.
 *
 * @param confidence `93%`.
 * @returns *Confidence 93% — how it was scored*.
 */
export function confidenceButtonName(confidence: string): string {
  return `Confidence ${confidence} — how it was scored`;
}

/**
 * A suggestion's body without the title it repeats.
 *
 * The rule pack composes a body that opens with the title and a dash — mockup 20's bold lead —
 * so the card draws the title once, in bold, and then what follows it.
 *
 * @param suggestion The suggestion.
 * @returns What follows the title; the whole body when it does not open with it.
 */
export function suggestionRest(suggestion: Pick<DryRunSuggestion, "title" | "body">): string {
  const { title, body } = suggestion;
  if (title === "" || !body.startsWith(title)) return body;

  return body.slice(title.length).replace(/^\s*[—–-]\s*/, "");
}

/** A run's suggestions, sorted into what glows and what is settled. */
export interface SuggestionGroups {
  /** The open ones — the callouts — in the service's order. */
  readonly open: readonly DryRunSuggestion[];
  /** The applied and ignored ones — one quiet line each — in the service's order. */
  readonly resolved: readonly DryRunSuggestion[];
}

/**
 * Sort a run's suggestions.
 *
 * @param suggestions The suggestions, in card order.
 * @returns Both groups; the service's order is kept within each.
 */
export function groupSuggestions(suggestions: readonly DryRunSuggestion[]): SuggestionGroups {
  return {
    open: suggestions.filter((suggestion) => suggestion.status === "open"),
    resolved: suggestions.filter((suggestion) => suggestion.status !== "open"),
  };
}

/**
 * The quiet line a settled suggestion leaves.
 *
 * @param suggestion The suggestion.
 * @returns *Applied — Make exploit-verify conditional*, or the ignored line with what ignoring means.
 */
export function resolvedLine(suggestion: Pick<DryRunSuggestion, "status" | "title">): string {
  return suggestion.status === "applied"
    ? `Applied — ${suggestion.title}`
    : `Ignored — ${suggestion.title} (${IGNORED_NOTE})`;
}

/**
 * A value of the service's, as text a definition list can hold.
 *
 * @param value Anything JSON can carry.
 * @returns The string itself, a number or a boolean as written, a list of scalars joined by
 *   commas, and anything else as its JSON.
 */
export function factValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number")) {
    return value.length === 0 ? "—" : value.join(", ");
  }

  return JSON.stringify(value);
}

/**
 * An object of the service's as terms and values — its own keys, in its own order.
 *
 * @param record The object.
 * @returns One fact per key. Nothing is renamed: the keys are data, not copy.
 */
export function factsOf(record: Readonly<Record<string, unknown>>): readonly Fact[] {
  return Object.entries(record).map(([term, value]) => ({ term, value: factValue(value) }));
}

/**
 * A confidence's scoring basis, as a definition list.
 *
 * @param basis The basis.
 * @returns The method first, then every input.
 */
export function basisFacts(basis: DryRunSuggestion["confidenceBasis"]): readonly Fact[] {
  return [{ term: "method", value: basis.method }, ...factsOf(basis.inputs)];
}

/* ------------------------------------------------------------------ apply */

/** The Apply dialog's title. */
export const APPLY_TITLE = "Apply this suggestion to the draft?";

/** The heading over the operations. */
export const APPLY_OPERATIONS_HEADING = "What it will do";

/** The answer that applies. */
export const APPLY_CONFIRM = "Apply to draft";

/** The answer that does not. */
export const APPLY_CANCEL = "Cancel";

/** What the dialog says while the apply is in flight. */
export const APPLYING = "Applying…";

/** The disclosure over an operation's raw form. */
export const RAW_OPERATION_LABEL = "kind and params";

/** The code a `409` answers when the draft moved and an operation no longer fits. */
export const SUGGESTION_CONFLICT = "dry_run_suggestion_conflict";

/** The code a `409` answers when the suggestion was already settled. */
export const SUGGESTION_RESOLVED = "dry_run_suggestion_resolved";

/** The code a `409` answers for an advisory suggestion. */
export const SUGGESTION_NOT_APPLICABLE = "dry_run_suggestion_not_applicable";

/** What a conflict offers. */
export const RERUN_OFFER = "Nothing was changed. Re-run the dry run to get suggestions for the draft as it is now.";

/** One operation of a preview. */
export interface OperationPreview {
  /** What it does, in the conversation's quiet words. */
  readonly phrase: string;
  /** The operation's kind, as the service spells it. */
  readonly kind: string;
  /** Its params, as indented JSON. */
  readonly params: string;
}

/**
 * What an Apply will run, before it runs it.
 *
 * @param ops The suggestion's operations.
 * @returns One preview per operation, in the order they are applied.
 */
export function applyPreview(ops: readonly OperationShape[]): readonly OperationPreview[] {
  return ops.map((op) => ({
    phrase: operationPhrase(op),
    kind: op.kind,
    params: JSON.stringify(op.params ?? {}, null, 2),
  }));
}

/**
 * A value as a non-empty string.
 *
 * @param value Anything.
 * @returns The string, or `null`.
 */
function word(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * A value as an object to read keys of.
 *
 * @param value Anything.
 * @returns The object, or an empty one.
 */
function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * The stages a set of operations touches and leaves in the draft — what the toast links to.
 *
 * A stage added or updated is named by its node; an edge added or removed touches both its ends.
 * A stage an operation **removes** has no row left to link to and is left out, wherever else the
 * same batch named it.
 *
 * @param ops The operations.
 * @returns The node ids, each once, in the order they are first touched.
 */
export function touchedStages(ops: readonly OperationShape[]): readonly string[] {
  const touched: string[] = [];
  const removed = new Set<string>();
  const touch = (id: string | null): void => {
    if (id !== null && !touched.includes(id)) touched.push(id);
  };

  for (const op of ops) {
    const params = record(op.params);
    const edge = record(params.edge);

    switch (op.kind) {
      case "add_stage":
      case "set_stage":
        touch(word(record(params.node).id) ?? word(params.id));
        removed.delete(word(record(params.node).id) ?? word(params.id) ?? "");
        break;
      case "remove_stage": {
        const id = word(params.id) ?? word(record(params.node).id);
        if (id !== null) removed.add(id);
        break;
      }
      case "add_edge":
      case "remove_edge":
        touch(word(edge.from) ?? word(params.from));
        touch(word(edge.to) ?? word(params.to));
        break;
      default:
        break;
    }
  }

  return touched.filter((id) => !removed.has(id));
}

/**
 * The revision an Apply will make.
 *
 * @param draft The draft as it stands.
 * @returns *This makes draft v0.4.* — the label after one more revision, composed the way the
 *   service composes it.
 */
export function nextRevisionLine(draft: Pick<DryRunHistory["draft"], "rev" | "baseVersion">): string {
  return `This makes draft v${draft.baseVersion ?? 0}.${draft.rev + 1}.`;
}

/**
 * The toast an Apply that took leaves.
 *
 * @param label The draft's new label, as the service answered it.
 * @returns *Applied — the draft is now v0.4.*
 */
export function appliedNotice(label: string): string {
  return `Applied — the draft is now ${label}.`;
}

/** What leads the toast's links. */
export const APPLIED_LINKS_LABEL = "Changed stages:";

/* ------------------------------------------------------------------ explain */

/** The Explain sheet's title. */
export const EXPLAIN_TITLE = "Why this suggestion";

/** What the sheet says while the explanation is read. */
export const EXPLAINING = "Reading the explanation…";

/** The sheet's close. */
export const EXPLAIN_CLOSE = "Close";

/** The headings inside the sheet. */
export const RULE_HEADING = "The rule";
export const EVIDENCE_HEADING = "What it computed";
export const SCORING_HEADING = "How the confidence was scored";
export const OPERATIONS_HEADING = "What Apply would do";

/** What the sheet says of a model's suggestion, plainly. */
export const LLM_EXPLANATION =
  "This suggestion came from the model, not from a rule. It was validated as operations and is not scored — there is no confidence to show.";

/** What the sheet says when a suggestion proposes no operations. */
export const NO_OPERATIONS = "It proposes no change to the draft.";

/** What the sheet says when the rule pack no longer describes the rule. */
export const RULE_UNDESCRIBED = "The running rule pack no longer describes this rule.";

/**
 * A rule, by id, version and pack — *skipped-nothing-to-do v1 · rule pack v1*.
 *
 * @param rule The explanation's rule.
 * @returns The line.
 */
export function ruleLine(rule: NonNullable<DryRunExplanation["rule"]>): string {
  return `${rule.id} v${rule.version}${SEPARATOR}rule pack v${rule.packVersion}`;
}

/* ------------------------------------------------------------------ the footer */

/** The footer's two controls, and the one a run in flight gets. */
export const RERUN_LABEL = "Re-run dry run";
export const PICKER_LABEL = "Dry-run another issue";
export const PICKER_GLYPH = "▾";
export const CANCEL_LABEL = "Cancel dry run";

/**
 * The history line — *history: 1 dry run · draft v0.3 (2 copilot edits)*.
 *
 * @param history The history.
 * @returns The line.
 */
export function historyLine(history: Pick<DryRunHistory, "count" | "draft">): string {
  const runs = history.count === 1 ? "1 dry run" : `${history.count} dry runs`;
  const edits = history.draft.copilotEdits === 1 ? "1 copilot edit" : `${history.draft.copilotEdits} copilot edits`;

  return `history: ${runs}${SEPARATOR}draft ${history.draft.label} (${edits})`;
}

/**
 * What **Re-run dry run** says when the draft has moved since the run.
 *
 * @param runLabel The draft the run tested — `v0.3`.
 * @param currentLabel The draft as it stands — `v0.4`.
 * @returns *re-runs on draft v0.4*, or `null` when they are the same draft.
 */
export function rerunHint(runLabel: string, currentLabel: string): string | null {
  return runLabel === currentLabel ? null : `re-runs on draft ${currentLabel}`;
}

/** Why a viewer's controls cannot act. */
export const CONTROL_ROLE_REASON = "Starting and stopping dry runs is for workspace owners, admins and members.";

/** Why the controls cannot act while a run is in flight. */
export const IN_FLIGHT_REASON = "One dry run at a time — this one is still running.";

/** Why a run cannot start on a draft with no stages. */
export const NO_STAGES_REASON = "The draft has no stages yet, so there is nothing to dry-run.";

/** Why a control cannot act while one of the card's own requests is out. */
export const BUSY_REASON = "Working…";

/** What the card knows when it decides its controls. */
export interface ControlFacts {
  /** Whether the reader's role may start, cancel and re-run — `mayContribute`. */
  readonly mayContribute: boolean;
  /** Whether the shown run is in flight. */
  readonly live: boolean;
  /** Whether the draft has any stage. */
  readonly hasStages: boolean;
  /** Whether one of the card's own writes is out. */
  readonly busy: boolean;
}

/**
 * Why **Re-run dry run** and **Dry-run another issue** cannot act, or `undefined` when they can.
 *
 * The order is from what cannot change to what will pass by itself: the role; a run in flight;
 * a draft with nothing to run; a request already out.
 *
 * @param facts What the card knows.
 * @returns The reason, or `undefined`.
 */
export function startReason(facts: ControlFacts): string | undefined {
  if (!facts.mayContribute) return CONTROL_ROLE_REASON;
  if (facts.live) return IN_FLIGHT_REASON;
  if (!facts.hasStages) return NO_STAGES_REASON;
  if (facts.busy) return BUSY_REASON;

  return undefined;
}

/**
 * Why **Cancel dry run** cannot act, or `undefined` when it can.
 *
 * @param facts What the card knows.
 * @returns The reason, or `undefined`.
 */
export function cancelReason(facts: Pick<ControlFacts, "mayContribute" | "busy">): string | undefined {
  if (!facts.mayContribute) return CONTROL_ROLE_REASON;
  if (facts.busy) return BUSY_REASON;

  return undefined;
}

/**
 * Why a suggestion's **Apply to draft** cannot act, or `undefined` when it can.
 *
 * @param suggestion The suggestion.
 * @param facts What the card knows.
 * @returns The reason, or `undefined`. Advice is said to be advice whoever reads it.
 */
export function applyReason(
  suggestion: Pick<DryRunSuggestion, "applicable">,
  facts: Pick<ControlFacts, "mayContribute" | "busy">,
): string | undefined {
  if (!suggestion.applicable) return ADVISORY_REASON;
  if (!facts.mayContribute) return SUGGESTION_ROLE_REASON;
  if (facts.busy) return BUSY_REASON;

  return undefined;
}

/**
 * Why a suggestion's **Ignore** cannot act, or `undefined` when it can.
 *
 * @param facts What the card knows.
 * @returns The reason, or `undefined`.
 */
export function ignoreReason(facts: Pick<ControlFacts, "mayContribute" | "busy">): string | undefined {
  if (!facts.mayContribute) return SUGGESTION_ROLE_REASON;
  if (facts.busy) return BUSY_REASON;

  return undefined;
}

/* ------------------------------------------------------------------ the picker */

/** The picker's accessible name. */
export const PICKER_PANEL_LABEL = "Issues to dry-run against";

/** What leads the picker. */
export const PICKER_NOTE =
  "Ranked by how much of the draft each issue would exercise — the reason says what makes it a good test.";

/** What the picker says while the candidates are read. */
export const PICKER_LOADING = "Reading the candidates…";

/** What the picker says when the service ranks nothing. */
export const PICKER_EMPTY = "No open issue in this workspace can be dry-run against this draft yet.";

/** The mark of a candidate that would not trigger the workflow as drafted. */
export const OFF_TRIGGER_LABEL = "would not trigger this workflow";

/**
 * A candidate's start button.
 *
 * @param key The ticket's key.
 * @returns *Dry-run #490*.
 */
export function startLabel(key: string): string {
  return `Dry-run ${key}`;
}

/* ------------------------------------------------------------------ refusals */

/** A refusal the card shows — the service's status, code and sentence. */
export interface Refusal {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

/** The codes a start can be refused with. */
export const DRY_RUN_IN_PROGRESS_CODE = "dry_run_in_progress";
export const DRAFT_STALE_CODE = "dry_run_draft_stale";
export const REPOSITORY_UNRESOLVED_CODE = "dry_run_repository_unresolved";
export const SOURCE_UNSUPPORTED_CODE = "dry_run_source_unsupported";
export const ENGINE_UNAVAILABLE_CODE = "engine_unavailable";
export const NOT_RUNNING_CODE = "dry_run_not_running";

/** The heading over any other refusal. */
export const REFUSED_HEADING = "The dry run did not start";

/**
 * The heading over a refused start — what kind of refusal it was. The service's own sentence is
 * drawn under it.
 *
 * @param refusal The refusal.
 * @returns The heading.
 */
export function refusalHeading(refusal: Pick<Refusal, "code" | "status">): string {
  switch (refusal.code) {
    case DRY_RUN_IN_PROGRESS_CODE:
      return "A dry run of this workflow is already running";
    case DRAFT_STALE_CODE:
      return "The draft changed before the dry run could start";
    case REPOSITORY_UNRESOLVED_CODE:
      return "That issue has no repository to read";
    case SOURCE_UNSUPPORTED_CODE:
      return "That issue's tracker cannot trigger a workflow";
    case ENGINE_UNAVAILABLE_CODE:
      return "The dry-run engine is not available";
    case NOT_RUNNING_CODE:
      return "That dry run had already ended";
    case "forbidden":
      return "Your role cannot do that";
    default:
      return REFUSED_HEADING;
  }
}

/**
 * What the card adds under a refusal's sentence, when there is something more to say.
 *
 * @param refusal The refusal.
 * @param hasRun Whether a previous run is still on screen.
 * @returns The sentence, or `null`.
 */
export function refusalFollowUp(refusal: Pick<Refusal, "code">, hasRun: boolean): string | null {
  if (refusal.code === DRAFT_STALE_CODE) return "This page has read the draft again — start the dry run once more.";
  if (refusal.code === DRY_RUN_IN_PROGRESS_CODE) return "This page has read it again and follows it below.";

  return hasRun ? "The previous run's results are still shown below." : null;
}

/** Whether a refusal means the page's picture is out of date and should be read again. */
export function refusalRereads(refusal: Pick<Refusal, "code">): boolean {
  return (
    refusal.code === DRAFT_STALE_CODE ||
    refusal.code === DRY_RUN_IN_PROGRESS_CODE ||
    refusal.code === NOT_RUNNING_CODE ||
    refusal.code === SUGGESTION_RESOLVED
  );
}

/* ------------------------------------------------------------------ the empty state */

/** The empty state's title. */
export const EMPTY_TITLE = "No dry run yet";

/** …and its note for a reader who may start one. */
export const EMPTY_NOTE =
  "A dry run walks this draft against a real issue with real models and simulated writes — no branch, no PR, no merge. Pick an issue to see what the draft would do.";

/** …and for a viewer. */
export const EMPTY_VIEWER_NOTE =
  "A dry run walks this draft against a real issue with real models and simulated writes. Nobody has run one yet; owners, admins and members can.";

/** The empty state's picker button. */
export const EMPTY_PICK_LABEL = "Choose an issue";

/** What the picker says when the copilot's proposal is not among the candidates. */
export function proposalMissing(key: string): string {
  return `${key} is not among the ranked candidates — choose one below.`;
}

/** A dry run the copilot proposed. */
export interface Proposal {
  /** The ticket's key — `#489`. */
  readonly ticket: string;
  /** Why, in the copilot's words, or `null`. */
  readonly reason: string | null;
}

/** The part of a message the proposal is read from. */
interface ProposingMessage {
  readonly toolTrace?: { readonly dryRunProposals?: readonly { readonly ticket?: unknown; readonly reason?: unknown }[] } | null;
}

/**
 * The newest dry run the copilot proposed in a conversation.
 *
 * @param messages The conversation's messages, oldest first.
 * @returns The last proposal of the last message that made one, or `null`.
 */
export function latestProposal(messages: readonly ProposingMessage[]): Proposal | null {
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const proposals = messages[at]?.toolTrace?.dryRunProposals ?? [];
    const proposal = proposals[proposals.length - 1];
    const ticket = word(proposal?.ticket);

    if (ticket !== null) return { ticket, reason: word(proposal?.reason) };
  }

  return null;
}

/**
 * The invitation that names the copilot's proposal.
 *
 * @param proposal The proposal.
 * @returns *The copilot suggested dry-running #489 — security workflow × no-CVE issue.*
 */
export function proposalLine(proposal: Proposal): string {
  return proposal.reason === null
    ? `The copilot suggested dry-running ${proposal.ticket}.`
    : `The copilot suggested dry-running ${proposal.ticket} — ${proposal.reason}`;
}

/**
 * The candidate a proposal names.
 *
 * @param candidates The picker's candidates.
 * @param key The proposed ticket's key.
 * @returns The candidate with that key, or `null`.
 */
export function matchCandidate(candidates: readonly DryRunCandidate[], key: string): DryRunCandidate | null {
  return candidates.find((candidate) => candidate.ticket.key === key) ?? null;
}

/* ------------------------------------------------------------------ the card's state */

/** One call the stream said a guard refused, before the run's own audit arrives. */
export interface LiveBlock {
  readonly guard: string;
  readonly call: string;
  readonly stageKey: string;
  readonly count: number;
}

/** What the card holds. */
export interface CardState {
  /** The board the state was last reconciled with — an identity, to notice a new read. */
  readonly board: DryRunBoard;
  /** The run shown. */
  readonly run: DryRun | null;
  /** The stages the stream says have started and not finished. */
  readonly started: readonly StartedStage[];
  /** The calls the stream said a guard refused. */
  readonly blocked: readonly LiveBlock[];
  /** The shown run's suggestions; `null` while unread or unreadable. */
  readonly suggestions: readonly DryRunSuggestion[] | null;
  /** Whether the suggestions are being fetched after a live run. */
  readonly suggestionsPending: boolean;
  /** Whether the stream could not be followed, and the run is being polled instead. */
  readonly polling: boolean;
  /** The last refusal of a start, a re-run or a cancel. */
  readonly refusal: Refusal | null;
  /** The one polite announcement — a run's start or end. */
  readonly announcement: string;
}

/** What can happen to the card. */
export type CardAction =
  /** An event of the run's stream. */
  | { readonly type: "event"; readonly runId: string; readonly event: DryRunStreamEvent }
  /** The run, read again — a poll, the read after `done`, a cancel's answer. */
  | { readonly type: "detail"; readonly run: DryRun }
  /** A run this card started or re-ran. */
  | { readonly type: "started"; readonly run: DryRun }
  /** The stream could not be followed; the run is polled from here. */
  | { readonly type: "dropped"; readonly runId: string }
  /** The suggestions are being fetched. */
  | { readonly type: "suggestions_pending"; readonly runId: string }
  /** The suggestions arrived, or could not be read (`null`). */
  | { readonly type: "suggestions"; readonly runId: string; readonly suggestions: readonly DryRunSuggestion[] | null }
  /** One suggestion was settled. */
  | { readonly type: "settled"; readonly suggestion: DryRunSuggestion }
  /** A start, a re-run or a cancel was refused — or the refusal was dismissed (`null`). */
  | { readonly type: "refused"; readonly refusal: Refusal | null };

/**
 * Open the card on what the route read.
 *
 * @param board The route's read.
 * @returns The state.
 */
export function openCard(board: DryRunBoard): CardState {
  return {
    board,
    run: board.run,
    started: [],
    blocked: [],
    suggestions: board.run === null ? [] : board.suggestions,
    suggestionsPending: false,
    polling: false,
    refusal: null,
    announcement: "",
  };
}

/**
 * Whether one account of a run is at least as far along as another.
 *
 * @param candidate The account that arrived.
 * @param held The account held.
 * @returns True when the candidate has ended, or has at least as many rows.
 */
function notBehind(candidate: DryRun, held: DryRun): boolean {
  if (!isLive(candidate.status)) return true;
  if (!isLive(held.status)) return false;

  return candidate.stages.length >= held.stages.length;
}

/**
 * Take a newer account of the shown run.
 *
 * @param state The state.
 * @param run The account.
 * @returns The state with it, announcing the end when this is the account that ended it.
 */
function takeRun(state: CardState, run: DryRun): CardState {
  const held = state.run;
  if (held === null || held.id !== run.id) return state;
  if (!notBehind(run, held)) return state;

  const ended = isLive(held.status) && !isLive(run.status);
  const finished = new Set(run.stages.map((stage) => stage.seq));

  return {
    ...state,
    run,
    started: ended ? [] : state.started.filter((stage) => !finished.has(stage.seq)),
    polling: ended ? false : state.polling,
    announcement: ended ? runAnnouncement(run) : state.announcement,
  };
}

/**
 * Reconcile the card with a new read of the route.
 *
 * The page reads the board again after every `router.refresh()`. The history is always the
 * read's. The run is the read's unless this card holds a newer account of it: a run it is
 * following live (the stream is ahead of the read), a run it knows has ended when the read still
 * says running, or a run it started that the read does not know yet.
 *
 * @param state The state.
 * @param board The new read.
 * @returns The state — the same object when the board is the one already reconciled.
 */
export function adoptBoard(state: CardState, board: DryRunBoard): CardState {
  if (board === state.board) return state;

  const held = state.run;
  const read = board.run;
  const keep = { ...state, board };

  // A read that names no run cannot be newer than a run this card holds.
  if (read === null) return keep;
  if (held === null) return { ...openCard(board), refusal: state.refusal, announcement: state.announcement };

  if (read.id === held.id) {
    // The same run: the stream, or this card's own knowledge that it ended, is the newer account.
    if (isLive(held.status) || isLive(read.status)) return takeRun(keep, read);

    return { ...keep, run: read, suggestions: board.suggestions ?? state.suggestions, suggestionsPending: false };
  }

  // Another run: whichever started later is the newest.
  if (Date.parse(read.startedAt) < Date.parse(held.startedAt)) return keep;

  return { ...openCard(board), refusal: state.refusal, announcement: state.announcement };
}

/**
 * Fold one thing that happened into the card.
 *
 * Events are folded so that the stream's order does not matter more than it has to: a duplicate
 * changes nothing, a `stage_started` that arrives after its `stage_finished` is ignored, and an
 * account of the run that is behind the one held is dropped. Events of a run other than the one
 * shown are dropped.
 *
 * @param state The state.
 * @param action What happened.
 * @returns The next state.
 */
export function cardReducer(state: CardState, action: CardAction): CardState {
  switch (action.type) {
    case "started":
      return {
        ...state,
        run: action.run,
        started: [],
        blocked: [],
        suggestions: null,
        suggestionsPending: false,
        polling: false,
        refusal: null,
        announcement: runAnnouncement(action.run),
      };

    case "detail":
      return takeRun(state, action.run);

    case "dropped":
      return state.run?.id === action.runId && isLive(state.run.status) ? { ...state, polling: true } : state;

    case "suggestions_pending":
      return state.run?.id === action.runId ? { ...state, suggestionsPending: true } : state;

    case "suggestions":
      return state.run?.id === action.runId
        ? { ...state, suggestions: action.suggestions, suggestionsPending: false }
        : state;

    case "settled":
      return state.suggestions === null
        ? state
        : {
            ...state,
            suggestions: state.suggestions.map((held) => (held.id === action.suggestion.id ? action.suggestion : held)),
          };

    case "refused":
      return { ...state, refusal: action.refusal };

    case "event": {
      const run = state.run;
      if (run === null || run.id !== action.runId) return state;

      const event = action.event;
      switch (event.kind) {
        case "accepted":
        case "done":
          return event.dryRun.id === run.id ? takeRun(state, event.dryRun) : state;

        case "stage_started": {
          if (!isLive(run.status)) return state;
          if (run.stages.some((stage) => stage.seq === event.seq)) return state;
          if (state.started.some((stage) => stage.seq === event.seq)) return state;

          return {
            ...state,
            started: [...state.started, { seq: event.seq, stageKey: event.stageKey, displayName: event.displayName }],
          };
        }

        case "stage_finished": {
          if (!isLive(run.status)) return state;

          const stages = [...run.stages.filter((stage) => stage.seq !== event.stage.seq), event.stage].sort(
            (a, b) => a.seq - b.seq,
          );

          return {
            ...state,
            run: { ...run, stages },
            started: state.started.filter((stage) => stage.seq !== event.stage.seq),
          };
        }

        case "guard_blocked": {
          const same = (block: LiveBlock): boolean =>
            block.guard === event.guard && block.call === event.call && block.stageKey === event.stageKey;

          return {
            ...state,
            blocked: state.blocked.some(same)
              ? state.blocked.map((block) => (same(block) ? { ...block, count: block.count + 1 } : block))
              : [...state.blocked, { guard: event.guard, call: event.call, stageKey: event.stageKey, count: 1 }],
          };
        }
      }
    }
  }
}

/**
 * The guard audit the card draws: the run's own once it has one, and until then what the stream
 * has said — so a blocked call shows the moment it happens.
 *
 * @param state The state.
 * @returns The entries.
 */
export function shownAudit(state: Pick<CardState, "run" | "blocked">): readonly GuardAuditEntry[] {
  const audit = state.run?.guardAudit ?? [];
  if (audit.length > 0) return audit;

  return state.blocked.map((block) => ({
    guard: block.guard,
    call: block.call,
    count: block.count,
    stage_key: block.stageKey,
  }));
}
