"use client";

import { useRouter } from "next/navigation";
import { type KeyboardEvent, useCallback, useEffect, useEffectEvent, useId, useMemo, useState } from "react";

import type { CopilotConversation } from "@/app/api/workflow-copilot";
import type { WorkflowDefinition } from "@/app/api/workflows";
import { Button, Card, CardHead, Chip, EmptyState, cx } from "@/app/ui";

import { FindingList } from "../finding-list";
import { useCopilotAnnounce } from "./copilot-flows";
import { publishDryRun, readCopilotLive, touchDraft } from "./copilot-live";
import { findingStageTarget, seatElementId, stageAnchorHref } from "./copilot-view";
import type { TransportOutcome } from "./conversation-transport";
import {
  APPLIED_LINKS_LABEL,
  BUDGET_HEADING,
  BUSY_REASON,
  CANCELLED_HEADING,
  CANCEL_LABEL,
  type CardAction,
  type CardState,
  DIFF_HEADLINE,
  DIFF_SCROLL_LABEL,
  DISMISS_LABEL,
  type DiffLineKind,
  type DryRun,
  type DryRunArtifact,
  type DryRunBoard,
  type DryRunCandidate,
  type DryRunSuggestion,
  EMPTY_NOTE,
  EMPTY_PICK_LABEL,
  EMPTY_TITLE,
  EMPTY_VIEWER_NOTE,
  FAILED_FALLBACK,
  FAILED_HEADING,
  GUARD_HEADING,
  GUARD_NOTE,
  OFF_TRIGGER_LABEL,
  PARTIAL_NOTE,
  PICKER_EMPTY,
  PICKER_GLYPH,
  PICKER_LABEL,
  PICKER_LOADING,
  PICKER_NOTE,
  PICKER_PANEL_LABEL,
  POLLING_NOTE,
  PRECHECK_HEADING,
  PRECHECK_NOTE,
  QUEUED_NOTE,
  RERUN_LABEL,
  ROWS_LABEL,
  type Refusal,
  type ResultRow,
  type RowTone,
  SEPARATOR,
  SIMULATED_PILL,
  SUGGESTIONS_LABEL,
  SUGGESTIONS_LOADING,
  SUGGESTIONS_UNREAD,
  SUGGESTION_RESOLVED,
  WAITING_NOTE,
  adoptBoard,
  appliedNotice,
  applyReason,
  budgetAdvice,
  budgetLine,
  budgetSpentLine,
  cancelReason,
  cardReducer,
  diffLines,
  diffSummary,
  dryRunTitle,
  elapsedLine,
  estimateButtonName,
  estimateNote,
  groupSuggestions,
  guardLine,
  historyLine,
  ignoreReason,
  isLive,
  latestProposal,
  matchCandidate,
  openCard,
  overlayDiff,
  proposalLine,
  proposalMissing,
  refusalFollowUp,
  refusalHeading,
  refusalRereads,
  rerunHint,
  resolvedLine,
  resultRows,
  runOutcome,
  shownAudit,
  startLabel,
  startReason,
  totalsParts,
  touchedStages,
  truncationLine,
} from "./dry-run";
import { ApplyDialog, ExplainDialog, Facts, SuggestionCallout } from "./dry-run-suggestions";
import {
  type DryRunFollower,
  type DryRunTransport,
  type FollowSourceFactory,
  browserDryRunTransport,
  followDryRun,
} from "./dry-run-transport";

import "./copilot.css";
import "./dry-run.css";

/**
 * The dry-run card (CE.4, [#568](https://github.com/NobuData/ouroboros/issues/568)) — mockup 20's
 * `DRY RUN — #489 …`, in the frame's **dry-run** seat under the stage list.
 *
 * The card shows the workflow's newest dry run: a row per stage carrying **how** its result was
 * produced, the simulated diff, the suggestions the run led to, and the controls to run again.
 * Every judgement is `dry-run.ts`'; this draws them.
 *
 * ### The `how` label is load-bearing
 *
 * `simulated`, `replayed from history` and `skipped` are what separate a diff drafted in memory
 * from a duration inferred from history from a stage that did nothing. Each is drawn in its own
 * treatment beside the stage's name, and a replayed row carries an ⓘ that opens — in the flow of
 * the row, so nothing clips it — the estimate with its sample count, spread, window and formula,
 * or, when there was not enough history, a sentence that says so and **no number at all**.
 *
 * ### A run in flight is followed, not waited for
 *
 * A run that is `precheck` or `running` — on arrival, or started from this card — is followed
 * over server-sent events (`dry-run-transport.ts`' `followDryRun`): rows appear as stages start
 * and fill in as they finish, a blocked call shows the moment it happens, and when the run ends
 * the card reads it again, shows its diff, then reads and shows its suggestions. Without an
 * `EventSource`, or when the stream drops, the run is read every three seconds instead. One
 * polite live region says that a run started and how it ended — never one announcement per row.
 *
 * ### Every end is its own state, and partial rows are kept
 *
 * `complete`; `failed`, in the service's words; stopped at its budget, naming the cap and whose
 * it was; cancelled; a **pre-check failure**, whose findings link to the stage rows they are
 * about; and a **guard-audit violation** — an alert, on the error treatment, naming each blocked
 * call. That last one is a real problem and is never drawn as an ordinary failure.
 *
 * ### Who can do what
 *
 * Starting, cancelling and re-running a dry run, and applying or ignoring a suggestion, are for
 * owners, admins and members — wider than the conversation, which is for owners and admins. A
 * viewer reads the same card with every control inert and the reason on it. Controls are also
 * inert while a run is in flight (one at a time) and while the draft has no stages.
 *
 * ### A refusal is a state, not a toast
 *
 * A start the service refuses — a run already open, a draft that moved, an issue with no
 * repository, a GitHub token that cannot pin a commit — is drawn inside the card as an alert in
 * the service's own sentence, **above the previous run's results, which stay**.
 */

/** What the card takes. */
export interface DryRunCardProps {
  /** The workflow's id — what every request and the live store are keyed by. */
  readonly workflowId: string;
  /** What the route read: the history, the newest run and its suggestions. */
  readonly board: DryRunBoard;
  /** The conversation, for the active session's id and the copilot's proposal; `null` when none. */
  readonly conversation?: CopilotConversation | null;
  /** The draft's document — what a failed pre-check's findings are anchored in. */
  readonly definition?: WorkflowDefinition;
  /** Whether the draft has any stage. Defaults to `true`: an unread draft gates nothing. */
  readonly hasStages?: boolean;
  /** Whether the reader's role may start runs and settle suggestions — `mayContribute`. */
  readonly mayContribute?: boolean;
  /** When the page was read, ISO 8601 — where a running run's clock starts from. */
  readonly now?: string;
  /** The reads and writes; a test substitutes its own. */
  readonly transport?: DryRunTransport;
  /** How a run is followed; a test substitutes its own. */
  readonly follow?: DryRunFollower;
  /** How the stream is opened; a test hands in a fake `EventSource`. */
  readonly openSource?: FollowSourceFactory;
  /** The fallback poll's interval, in milliseconds. */
  readonly pollMs?: number;
}

/** Which dialog is open, and on which suggestion. */
type OpenDialog = { readonly kind: "apply" | "explain"; readonly id: string } | null;

/** The picker's state. */
interface Picker {
  readonly open: boolean;
  /** The candidates — `null` while they are read. */
  readonly candidates: TransportOutcome<readonly DryRunCandidate[]> | null;
  /** A sentence over the list — the proposal that was not among them. */
  readonly note: string | null;
}

/** The picker, closed and unread. */
const CLOSED_PICKER: Picker = { open: false, candidates: null, note: null };

/** Each mark's hue. */
const MARK_CLASS: Readonly<Record<RowTone, string>> = {
  ok: "copilot-dry__mark--ok",
  warn: "copilot-dry__mark--warn",
  idle: "copilot-dry__mark--idle",
  err: "copilot-dry__mark--err",
  live: "copilot-dry__mark--live",
};

/** Each diff line's class — the shared diff treatments, from the same tokens as the PR page's. */
const LINE_CLASS: Readonly<Record<DiffLineKind, string>> = {
  file: "copilot-dry__diff-line--file",
  hunk: "copilot-dry__diff-line--hunk",
  add: "copilot-dry__diff-line--add",
  del: "copilot-dry__diff-line--del",
  ctx: "copilot-dry__diff-line--ctx",
};

/** A clock's tick, in milliseconds. */
const TICK_MS = 1000;

/**
 * The present, ticking each second while something is running.
 *
 * @param active Whether to tick.
 * @param initial Where the clock starts — the page's own read time, so the first render is the
 *   same on the server and in the browser.
 * @returns The present, in epoch milliseconds.
 */
function useNow(active: boolean, initial: number): number {
  const [now, setNow] = useState(initial);

  useEffect(() => {
    if (!active) return;

    const timer = setInterval(() => setNow(Date.now()), TICK_MS);

    return () => clearInterval(timer);
  }, [active]);

  return now;
}

/**
 * The dry-run card.
 *
 * @param props See {@link DryRunCardProps}.
 * @returns The card.
 */
export function DryRunCard({
  workflowId,
  board,
  conversation = null,
  definition = NO_DEFINITION,
  hasStages = true,
  mayContribute = false,
  now: readAt,
  transport = browserDryRunTransport,
  follow = followDryRun,
  openSource,
  pollMs,
}: DryRunCardProps) {
  const router = useRouter();
  const announce = useCopilotAnnounce();
  const element = seatElementId("dry-run");
  const titleId = `${element}-title`;
  const ids = useId();

  // The card's state, reconciled during render with whatever the route read — React's *adjusting
  // state when a prop changes*, since the fold is pure.
  const [held, setHeld] = useState<CardState>(() => openCard(board));
  const state = adoptBoard(held, board);
  if (state !== held) setHeld(state);
  const dispatch = useCallback((action: CardAction) => setHeld((current) => cardReducer(current, action)), []);

  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [picker, setPicker] = useState<Picker>(CLOSED_PICKER);

  const { run } = state;
  const history = state.board.history;
  const live = run !== null && isLive(run.status);
  const liveId = live ? run.id : null;
  const liveStatus = live ? run.status : null;
  const sessionId = conversation !== null && conversation.session.status === "active" ? conversation.session.id : undefined;
  const now = useNow(live, readAt === undefined ? 0 : Date.parse(readAt));

  /* ---- a run that has ended: read it again, then its suggestions, then the page ---- */

  /**
   * Settle a run that has ended.
   *
   * @param dryRunId The run.
   */
  async function settle(dryRunId: string): Promise<void> {
    const detail = await transport.detail(workflowId, dryRunId);
    if (detail.ok) dispatch({ type: "detail", run: detail.value });

    dispatch({ type: "suggestions_pending", runId: dryRunId });
    const suggestions = await transport.suggestions(workflowId, dryRunId);
    dispatch({ type: "suggestions", runId: dryRunId, suggestions: suggestions.ok ? suggestions.value : null });

    // The readiness, the history and the draft all moved; the server reads them again.
    router.refresh();
  }

  /* ---- a run in flight is followed ---- */

  // The follow belongs to the run, not to a render: what it calls and how it is wired are read
  // when they are needed, so a re-render never closes and reopens the stream.
  const onEnded = useEffectEvent((dryRunId: string) => void settle(dryRunId));
  const wiring = useEffectEvent(() => ({ follow, open: openSource, read: transport.detail, intervalMs: pollMs }));

  useEffect(() => {
    if (liveId === null) return;

    const { follow: begin, ...options } = wiring();

    return begin(
      workflowId,
      liveId,
      {
        onEvent: (event) => dispatch({ type: "event", runId: liveId, event }),
        onDetail: (detail) => dispatch({ type: "detail", run: detail }),
        onDropped: () => dispatch({ type: "dropped", runId: liveId }),
        onEnded: () => onEnded(liveId),
      },
      options,
    );
  }, [dispatch, liveId, workflowId]);

  // The composer is gated on a dry run in the way; this card knows one started or ended before
  // the route's readiness is read again.
  useEffect(() => {
    if (liveId !== null && liveStatus !== null) {
      publishDryRun(workflowId, { id: liveId, status: liveStatus as "precheck" | "running" });
    } else if (readCopilotLive(workflowId).dryRun !== null) {
      publishDryRun(workflowId, false);
    }
  }, [workflowId, liveId, liveStatus]);

  /* ---- the writes ---- */

  /**
   * Take a run a start or a re-run answered with.
   *
   * @param outcome The answer.
   */
  function began(outcome: TransportOutcome<DryRun>): void {
    if (!outcome.ok) {
      dispatch({ type: "refused", refusal: outcome.refusal });
      if (refusalRereads(outcome.refusal)) router.refresh();
      return;
    }

    dispatch({ type: "started", run: outcome.value });
    setPicker(CLOSED_PICKER);
    if (isLive(outcome.value.status)) router.refresh();
    else void settle(outcome.value.id);
  }

  /**
   * Start a dry run on a ticket.
   *
   * @param ticketId The canonical ticket.
   */
  async function start(ticketId: string): Promise<void> {
    if (busy) return;

    setBusy(true);
    try {
      began(
        await transport.start(workflowId, {
          ticketId,
          draftRev: history.draft.rev,
          ...(sessionId === undefined ? {} : { sessionId }),
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  /** Run the shown run again, on the draft as it is now. */
  async function rerun(): Promise<void> {
    if (busy || run === null) return;

    setDialog(null);
    setBusy(true);
    try {
      began(await transport.rerun(workflowId, run.id));
    } finally {
      setBusy(false);
    }
  }

  /** Stop the run in flight. */
  async function cancel(): Promise<void> {
    if (busy || run === null) return;

    setBusy(true);
    try {
      const outcome = await transport.cancel(workflowId, run.id);
      if (outcome.ok) {
        dispatch({ type: "detail", run: outcome.value });
        // The follow stops with the run it was following, so the card settles it itself.
        if (!isLive(outcome.value.status)) void settle(outcome.value.id);
      } else {
        dispatch({ type: "refused", refusal: outcome.refusal });
        if (refusalRereads(outcome.refusal)) router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Apply a suggestion.
   *
   * @param suggestion The suggestion.
   * @returns The refusal for the dialog to show, or `null` once it took.
   */
  async function apply(suggestion: DryRunSuggestion): Promise<Refusal | null> {
    if (run === null) return null;

    const outcome = await transport.apply(workflowId, run.id, suggestion.id);
    if (!outcome.ok) {
      if (outcome.refusal.code !== SUGGESTION_RESOLVED) return outcome.refusal;

      // Somebody settled it first: the card reads what it is now.
      setDialog(null);
      void settle(run.id);
      return null;
    }

    dispatch({ type: "settled", suggestion: outcome.value.suggestion });
    announce(
      appliedNotice(outcome.value.draftLabel),
      touchedStages(suggestion.proposedOps).map((nodeId) => ({ href: stageAnchorHref(nodeId), label: nodeId })),
      APPLIED_LINKS_LABEL,
    );
    setDialog(null);
    // The stage list reads the draft again now; the server reads everything else.
    touchDraft(workflowId);
    router.refresh();
    return null;
  }

  /**
   * Ignore a suggestion.
   *
   * @param suggestion The suggestion.
   * @returns The refusal for the callout to show, or `null` once it took.
   */
  async function ignore(suggestion: DryRunSuggestion): Promise<Refusal | null> {
    if (run === null) return null;

    const outcome = await transport.ignore(workflowId, run.id, suggestion.id);
    if (outcome.ok) {
      dispatch({ type: "settled", suggestion: outcome.value });
      return null;
    }
    if (outcome.refusal.code !== SUGGESTION_RESOLVED) return outcome.refusal;

    void settle(run.id);
    return null;
  }

  /* ---- the picker ---- */

  /**
   * Read the candidates, once per opening.
   *
   * @returns The answer.
   */
  async function readCandidates(): Promise<TransportOutcome<readonly DryRunCandidate[]>> {
    const answer = await transport.candidates(workflowId);
    setPicker((current) => ({ ...current, candidates: answer }));

    return answer;
  }

  /** Open the picker, or close it. */
  function togglePicker(): void {
    if (picker.open) {
      setPicker(CLOSED_PICKER);
      return;
    }

    setPicker({ open: true, candidates: null, note: null });
    void readCandidates();
  }

  /**
   * Start the dry run the copilot proposed — when its ticket is among the candidates; otherwise
   * open the picker and say so.
   *
   * @param key The proposed ticket's key.
   */
  async function startProposal(key: string): Promise<void> {
    if (busy) return;

    setBusy(true);
    let match: DryRunCandidate | null = null;
    try {
      const answer = await readCandidates();
      match = answer.ok ? matchCandidate(answer.value, key) : null;
    } finally {
      setBusy(false);
    }

    if (match === null) setPicker((current) => ({ ...current, open: true, note: proposalMissing(key) }));
    else await start(match.ticket.id);
  }

  /* ---- what is drawn ---- */

  const facts = { mayContribute, live, hasStages, busy };
  const starting = startReason(facts);
  const rows = useMemo(() => resultRows(run?.stages ?? [], state.started), [run, state.started]);
  const audit = shownAudit(state);
  const outcome = run === null ? null : runOutcome(run);
  const diff = run === null || live ? null : overlayDiff(run.artifacts);
  const groups = groupSuggestions(state.suggestions ?? []);
  const opened = dialog === null ? null : (groups.open.find((suggestion) => suggestion.id === dialog.id) ?? null);
  const proposal = run === null ? latestProposal(conversation?.messages ?? []) : null;
  const pickerId = `${ids}-picker`;
  const pickerToggleId = `${ids}-picker-toggle`;
  const title = dryRunTitle(run === null ? null : run.ticket);

  const loadExplanation = useCallback(
    () => transport.explanation(workflowId, run?.id ?? "", dialog?.id ?? ""),
    [transport, workflowId, run?.id, dialog?.id],
  );

  const pickerPanel = picker.open && (
    <PickerPanel
      id={pickerId}
      onClose={() => {
        setPicker(CLOSED_PICKER);
        document.getElementById(pickerToggleId)?.focus();
      }}
      onStart={(candidate) => void start(candidate.ticket.id)}
      picker={picker}
      reason={starting}
    />
  );

  const pickerToggle = (label: string, tone: "ghost" | "primary") => (
    <Button
      aria-controls={pickerId}
      aria-expanded={picker.open}
      id={pickerToggleId}
      onClick={togglePicker}
      reason={starting}
      size="sm"
      tone={tone}
    >
      {label} <span aria-hidden="true">{PICKER_GLYPH}</span>
    </Button>
  );

  return (
    <Card aria-labelledby={titleId} as="section" className={cx("copilot-view__seat", "copilot-dry")} id={element}>
      <CardHead
        beside={<Chip tone="accent">{SIMULATED_PILL}</Chip>}
        className="copilot-dry__head"
        title={
          <span className="copilot-dry__title" title={title}>
            {title}
          </span>
        }
        titleId={titleId}
        trailing={
          run === null ? undefined : (
            <span className="copilot-dry__totals">
              {live ? elapsedLine(run.status, run.startedAt, now) : totalsParts(run.totals).join(SEPARATOR)}
            </span>
          )
        }
      />

      {/* One polite region: that a run started, and how it ended — never one announcement per row.
          `aria-live` without the `status` role: the page's notice is the page's one status. */}
      <p aria-atomic="true" aria-live="polite" className="sr-only">
        {state.announcement}
      </p>

      {state.refusal !== null && (
        <div className="copilot-dry__refusal" role="alert">
          <p className="copilot-dry__state-title">{refusalHeading(state.refusal)}</p>
          <p className="copilot-dry__state-text">{state.refusal.message}</p>
          {refusalFollowUp(state.refusal, run !== null) !== null && (
            <p className="copilot-dry__state-text">{refusalFollowUp(state.refusal, run !== null)}</p>
          )}
          <Button onClick={() => dispatch({ type: "refused", refusal: null })} size="sm" tone="ghost">
            {DISMISS_LABEL}
          </Button>
        </div>
      )}

      {run === null ? (
        <>
          <EmptyState note={mayContribute ? EMPTY_NOTE : EMPTY_VIEWER_NOTE} title={EMPTY_TITLE} variant="flush">
            {proposal !== null && <p className="copilot-dry__proposal">{proposalLine(proposal)}</p>}
            <div className="copilot-dry__controls">
              {proposal !== null && (
                <Button onClick={() => void startProposal(proposal.ticket)} reason={starting} size="sm" tone="primary">
                  {startLabel(proposal.ticket)}
                </Button>
              )}
              {pickerToggle(EMPTY_PICK_LABEL, proposal === null ? "primary" : "ghost")}
            </div>
            {starting !== undefined && <p className="copilot-dry__why">{starting}</p>}
          </EmptyState>
          {pickerPanel}
        </>
      ) : (
        <>
          {audit.length > 0 && (
            <div aria-labelledby={`${ids}-guard`} className="copilot-dry__guard" role="alert">
              <p className="copilot-dry__state-title" id={`${ids}-guard`}>
                <span aria-hidden="true">⛔ </span>
                {GUARD_HEADING}
              </p>
              <p className="copilot-dry__state-text">{GUARD_NOTE}</p>
              <ul className="copilot-dry__blocked">
                {audit.map((entry, at) => (
                  <li className="copilot-dry__blocked-call" key={at}>
                    {guardLine(entry)}
                  </li>
                ))}
              </ul>
              {run.failureReason !== null && <p className="copilot-dry__state-text">{run.failureReason}</p>}
            </div>
          )}

          {outcome === "precheck_failed" && (
            <div
              aria-labelledby={`${ids}-state`}
              className={cx("copilot-dry__state", "copilot-dry__state--err")}
              role="group"
            >
              <p className="copilot-dry__state-title" id={`${ids}-state`}>
                {PRECHECK_HEADING}
              </p>
              <p className="copilot-dry__state-text">{PRECHECK_NOTE}</p>
              <FindingList
                definition={definition}
                findings={run.precheckFindings ?? []}
                onSelect={NOTHING}
                stageHref={stageAnchorHref}
                target={findingStageTarget}
              />
            </div>
          )}

          {outcome === "failed" && (
            <div
              aria-labelledby={`${ids}-state`}
              className={cx("copilot-dry__state", "copilot-dry__state--err")}
              role="group"
            >
              <p className="copilot-dry__state-title" id={`${ids}-state`}>
                {FAILED_HEADING}
              </p>
              <p className="copilot-dry__state-text">{run.failureReason ?? FAILED_FALLBACK}</p>
              {rows.length > 0 && <p className="copilot-dry__state-text">{PARTIAL_NOTE}</p>}
            </div>
          )}

          {outcome === "budget_stopped" && (
            <div
              aria-labelledby={`${ids}-state`}
              className={cx("copilot-dry__state", "copilot-dry__state--warn")}
              role="group"
            >
              <p className="copilot-dry__state-title" id={`${ids}-state`}>
                {BUDGET_HEADING}
              </p>
              {run.failureReason !== null && <p className="copilot-dry__state-text">{run.failureReason}</p>}
              {budgetSpentLine(run.totals) !== null && (
                <p className="copilot-dry__state-text">{budgetSpentLine(run.totals)}</p>
              )}
              {budgetLine(run.budget) !== null && <p className="copilot-dry__state-text">{budgetLine(run.budget)}</p>}
              <p className="copilot-dry__state-text">{PARTIAL_NOTE}</p>
              <p className="copilot-dry__state-text">{budgetAdvice(run.budget)}</p>
            </div>
          )}

          {outcome === "cancelled" && (
            <div
              aria-labelledby={`${ids}-state`}
              className={cx("copilot-dry__state", "copilot-dry__state--quiet")}
              role="group"
            >
              <p className="copilot-dry__state-title" id={`${ids}-state`}>
                {CANCELLED_HEADING}
              </p>
              <p className="copilot-dry__state-text">{PARTIAL_NOTE}</p>
            </div>
          )}

          {rows.length > 0 && (
            <ol aria-label={ROWS_LABEL} className="copilot-dry__rows">
              {rows.map((row) => (
                <ResultItem key={row.seq} row={row} />
              ))}
            </ol>
          )}

          {live && rows.length === 0 && (
            <p className="copilot-dry__waiting">{run.status === "precheck" ? QUEUED_NOTE : WAITING_NOTE}</p>
          )}
          {live && state.polling && (
            <p className="copilot-dry__waiting">{POLLING_NOTE}</p>
          )}

          {diff !== null && <DiffBlock artifact={diff} />}

          {!live && state.suggestionsPending && <p className="copilot-dry__waiting">{SUGGESTIONS_LOADING}</p>}
          {!live && !state.suggestionsPending && state.suggestions === null && (
            <p className="copilot-dry__waiting">{SUGGESTIONS_UNREAD}</p>
          )}

          {!live && groups.open.length > 0 && (
            <ul aria-label={SUGGESTIONS_LABEL} className="copilot-dry__suggestions">
              {groups.open.map((suggestion) => (
                <SuggestionCallout
                  applyReason={applyReason(suggestion, facts)}
                  ignoreReason={ignoreReason(facts)}
                  key={suggestion.id}
                  onApply={() => setDialog({ kind: "apply", id: suggestion.id })}
                  onExplain={() => setDialog({ kind: "explain", id: suggestion.id })}
                  onIgnore={() => ignore(suggestion)}
                  suggestion={suggestion}
                />
              ))}
            </ul>
          )}

          {!live && groups.resolved.length > 0 && (
            <ul className="copilot-dry__resolved">
              {groups.resolved.map((suggestion) => (
                <li className="copilot-dry__resolved-line" key={suggestion.id}>
                  {resolvedLine(suggestion)}
                </li>
              ))}
            </ul>
          )}

          <div className="copilot-dry__foot">
            <div className="copilot-dry__controls">
              {live && (
                <Button onClick={() => void cancel()} reason={cancelReason(facts)} size="sm" tone="danger">
                  {CANCEL_LABEL}
                </Button>
              )}
              <Button onClick={() => void rerun()} reason={starting} size="sm" tone="ghost">
                {RERUN_LABEL}
              </Button>
              {pickerToggle(PICKER_LABEL, "ghost")}
            </div>
            <p className="copilot-dry__history">{historyLine(history)}</p>
          </div>

          {starting !== undefined && starting !== BUSY_REASON && <p className="copilot-dry__why">{starting}</p>}
          {starting === undefined && rerunHint(run.draft.label, history.draft.label) !== null && (
            <p className="copilot-dry__why">{rerunHint(run.draft.label, history.draft.label)}</p>
          )}

          {pickerPanel}
        </>
      )}

      {dialog?.kind === "apply" && opened !== null && (
        <ApplyDialog
          draft={history.draft}
          onCancel={() => setDialog(null)}
          onConfirm={() => apply(opened)}
          onRerun={startReason({ ...facts, busy: false }) === undefined ? () => void rerun() : undefined}
          suggestion={opened}
        />
      )}
      {dialog?.kind === "explain" && opened !== null && (
        <ExplainDialog load={loadExplanation} onClose={() => setDialog(null)} suggestion={opened} />
      )}
    </Card>
  );
}

/** The document findings are anchored in when the draft could not be read: every finding is listed, none is a link. */
const NO_DEFINITION: WorkflowDefinition = {};

/** A finding's link is its own navigation; the card has nothing to do on the press. */
const NOTHING = (): void => {};

/**
 * One result row: its mark, the stage, **how** the result was produced, and the service's note —
 * with, on a replayed row, the control that opens its provenance under the row's line.
 *
 * Escape closes the provenance and returns focus to the ⓘ that opened it.
 *
 * @param props.row The row.
 * @returns The list item.
 */
function ResultItem({ row }: Readonly<{ row: ResultRow }>) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const noteId = `${ids}-provenance`;
  const toggleId = `${ids}-info`;
  const provenance = row.estimate === null ? null : estimateNote(row.estimate);

  function onKeyDown(event: KeyboardEvent<HTMLLIElement>): void {
    if (event.key !== "Escape" || !open) return;

    event.stopPropagation();
    setOpen(false);
    document.getElementById(toggleId)?.focus();
  }

  return (
    <li className={cx("copilot-dry__row", row.running && "copilot-dry__row--running")} onKeyDown={onKeyDown}>
      <div className="copilot-dry__line">
        <span aria-hidden="true" className={cx("copilot-dry__mark", MARK_CLASS[row.mark.tone])}>
          {row.mark.glyph}
        </span>
        <span className="copilot-dry__stage">
          <span className="sr-only">{`${row.mark.word}: `}</span>
          {row.name}
        </span>

        {row.how !== null && (
          <span className={cx("copilot-dry__how", row.warn && "copilot-dry__how--warn")}>{`(${row.how})`}</span>
        )}

        {provenance !== null && (
          <button
            aria-controls={noteId}
            aria-expanded={open}
            aria-label={estimateButtonName(row.name)}
            className="copilot-dry__info"
            id={toggleId}
            onClick={() => setOpen(!open)}
            type="button"
          >
            <span aria-hidden="true">ⓘ</span>
          </button>
        )}

        <span className={cx("copilot-dry__note", row.warn && "copilot-dry__note--warn")}>{row.note}</span>
      </div>

      {/* In the tree whenever the row is a replay, so the ⓘ's `aria-controls` names something. */}
      {provenance !== null && (
        <div className="copilot-dry__provenance" hidden={!open} id={noteId} role="note">
          {open && (
            <>
              <p className="copilot-dry__provenance-lead">{provenance.lead}</p>
              {provenance.facts.length > 0 && <Facts facts={provenance.facts} />}
              {provenance.formula !== null && <p className="copilot-dry__formula">{provenance.formula}</p>}
            </>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The simulated diff: the line that says it was never written, the files it touches with their
 * ± counts, the diff inside its own bounded scroller, and — when the artifact is a prefix of
 * something larger — a line that says so with both sizes.
 *
 * @param props.artifact The `overlay_diff` artifact.
 * @returns The block.
 */
function DiffBlock({ artifact }: Readonly<{ artifact: DryRunArtifact }>) {
  const truncated = truncationLine(artifact);

  return (
    <div className="copilot-dry__diff">
      <p className="copilot-dry__diff-head">
        <span className="copilot-dry__diff-what">{DIFF_HEADLINE}</span>
        {diffSummary(artifact).map((file) => (
          <span className="copilot-dry__diff-file" key={file}>
            {file}
          </span>
        ))}
      </p>

      {/* Scrolls inside itself, both ways: focusable, so a keyboard can scroll it, and named. */}
      <div aria-label={DIFF_SCROLL_LABEL} className="copilot-dry__diff-scroll" role="group" tabIndex={0}>
        <pre className="copilot-dry__diff-block">
          {diffLines(artifact.content).map((line, at) => (
            <span className={cx("copilot-dry__diff-line", LINE_CLASS[line.kind])} key={at}>
              {line.text}
            </span>
          ))}
        </pre>
      </div>

      {truncated !== null && <p className="copilot-dry__diff-truncated">{truncated}</p>}
    </div>
  );
}

/**
 * The picker: the service's ranked candidates, each with **why it ranks where it does** — the
 * page explaining what a good test case is, not just listing tickets.
 *
 * A candidate that would not trigger the workflow as drafted is still listed, and marked.
 * Escape closes the panel and returns focus to the control that opened it.
 *
 * @param props.id The panel's id — what its control names.
 * @param props.picker The picker's state.
 * @param props.reason Why a run cannot start, or `undefined`.
 * @param props.onStart Start a run on a candidate.
 * @param props.onClose Close the panel.
 * @returns The panel.
 */
function PickerPanel({
  id,
  picker,
  reason,
  onStart,
  onClose,
}: Readonly<{
  id: string;
  picker: Picker;
  reason: string | undefined;
  onStart: (candidate: DryRunCandidate) => void;
  onClose: () => void;
}>) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Escape") return;

    event.stopPropagation();
    onClose();
  }

  const { candidates } = picker;

  return (
    <div aria-label={PICKER_PANEL_LABEL} className="copilot-dry__picker" id={id} onKeyDown={onKeyDown} role="group">
      <p className="copilot-dry__picker-note">{PICKER_NOTE}</p>
      {picker.note !== null && <p className="copilot-dry__picker-missing">{picker.note}</p>}

      {candidates === null && (
        <p className="copilot-dry__waiting" role="status">
          {PICKER_LOADING}
        </p>
      )}
      {candidates !== null && !candidates.ok && (
        <p className="copilot-dry__failure" role="alert">
          {candidates.refusal.message}
        </p>
      )}
      {candidates !== null && candidates.ok && candidates.value.length === 0 && (
        <p className="copilot-dry__waiting">{PICKER_EMPTY}</p>
      )}

      {candidates !== null && candidates.ok && candidates.value.length > 0 && (
        <ol className="copilot-dry__candidates">
          {candidates.value.map((candidate) => (
            <li className="copilot-dry__candidate" key={candidate.ticket.id}>
              <span className="copilot-dry__rank">{candidate.rank}</span>
              <div className="copilot-dry__candidate-main">
                <p className="copilot-dry__candidate-title">
                  <span className="copilot-dry__key">{candidate.ticket.key}</span> {candidate.ticket.title}{" "}
                  {!candidate.matchesTrigger && <Chip tone="warn">{OFF_TRIGGER_LABEL}</Chip>}
                </p>
                <p className="copilot-dry__reason">{candidate.reason}</p>
              </div>
              <Button onClick={() => onStart(candidate)} reason={reason} size="sm" tone="ghost">
                {startLabel(candidate.ticket.key)}
              </Button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
