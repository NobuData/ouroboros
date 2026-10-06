"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

import type {
  FirstIssueCard as FirstIssueCardRead,
  OnboardingFirstIssue,
  OnboardingFirstIssueCandidate,
  OnboardingStep,
} from "@/app/api/onboarding";
import type { DryRunPolicy } from "@/app/api/policies";
import type { Reading } from "@/app/api/reading";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { ISSUES_PATH } from "@/app/paths";
import { Button, Card, CardHead, Chip, EffortChip, Tag } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import { pickFirstIssue } from "./actions";
import { type FirstIssuePollOptions, createFirstIssuePoll, firstIssueEndpoint } from "./first-issue-poll";
import {
  ANOTHER_LABEL,
  BREAKDOWN_LABEL,
  BROWSE_LINK,
  COMPONENTS_LABEL,
  EMPTY_LINE,
  EMPTY_TITLE,
  FIRST_ISSUE_TITLE,
  LAUNCHED_REASON,
  NONE_SAFE_LINE,
  NONE_SAFE_TITLE,
  NO_CANDIDATES_REASON,
  ONLY_CANDIDATE_REASON,
  OWN_PICK_LABEL,
  PICKING,
  PLANNING_LINK,
  type PickedTicket,
  SAFETY_GLYPHS,
  SAFETY_MARK_NAMES,
  SAFETY_ROWS_LABEL,
  SIZING_TITLE,
  type SafetyMark,
  type ShownPick,
  UNRANKED_NOTE,
  VIEWER_PICK_REASON,
  breakdownName,
  componentLine,
  estimatorStatus,
  issueNumberOf,
  nextCandidate,
  noneSafeLine,
  pickLine,
  pickedLine,
  reasoningLine,
  safetyRows,
  shownPick,
  sizingLine,
  stepPill,
  stillSizingLine,
  totalLine,
} from "./first-issue-view";
import { PickSheet } from "./pick-sheet";
import { effortOf } from "./templates-view";
import type { Abilities } from "./view";

/** What {@link FirstIssueCard} takes. */
export interface FirstIssueCardProps {
  /** The repository. */
  readonly repo: string;
  /** The first paint's read of the card. */
  readonly initial: Reading<FirstIssueCardRead> | null;
  /** Step 4's status on the rail — the head's pill, and whether the pick may still change. */
  readonly stepStatus: OnboardingStep["status"] | null;
  /** The wizard's stored pick, as its rail read references it, or null when nothing is stored. */
  readonly pickedTicket: PickedTicket | null;
  /** What the person may do: contributors pick, viewers read. */
  readonly abilities: Abilities;
  /** Called after a pick was stored — the rail re-derives step 4 from it. */
  readonly onChanged?: () => void;
  /**
   * Called with the picker's suggestion on screen while the wizard stores no pick (its
   * `issueId`), and with null otherwise — what *Run my first loop* stores before it launches.
   */
  readonly onSuggestion?: (issueId: string | null) => void;
  /** Test seams for the card's poll. */
  readonly poll?: FirstIssuePollOptions;
  /** The clock the estimator's status is aged against — a test seam. */
  readonly now?: () => number;
}

/** What the card says under its actions after a press. */
type Status = { readonly tone: "ok" | "refused"; readonly text: string };

/** The class each safety mark adds — a literal map, so the style suite sees every class. */
const MARK_CLASS: Readonly<Record<SafetyMark, string>> = {
  ok: "safety__row--ok",
  warn: "safety__row--warn",
  pending: "safety__row--pending",
  unknown: "safety__row--unknown",
};

/**
 * The score's breakdown behind a keyboard-reachable control: a real button with `aria-expanded`
 * and a labelled group as the panel — every term with its points, then the total against the bar.
 *
 * @param props.candidate The candidate.
 * @param props.context The weights' version and the bar.
 * @returns The control and, while open, the breakdown.
 */
function Breakdown({
  candidate,
  context,
}: Readonly<{
  candidate: OnboardingFirstIssueCandidate;
  context: { readonly weightsVersion: string; readonly safetyBar: number };
}>) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const name = breakdownName(candidate.number);

  return (
    <div className="pick-score">
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={name}
        className="pick-score__toggle"
        onClick={() => setOpen(!open)}
        type="button"
      >
        {BREAKDOWN_LABEL}
      </button>
      {open && (
        <div aria-label={name} className="pick-score__panel" id={panelId} role="group">
          <ul aria-label={COMPONENTS_LABEL} className="pick-score__rows">
            {candidate.reasoning.components.map((component) => (
              <li className="pick-score__component" key={component.key}>
                {componentLine(component)}
              </li>
            ))}
          </ul>
          <p className="pick-score__total">{totalLine(candidate, context)}</p>
        </div>
      )}
    </div>
  );
}

/**
 * The pick row — the mockup's mono key, title, effort chip, workflow tag and reasoning line, the
 * line assembled from the score's fragments (cost only when priced), with the breakdown beside it;
 * or, for a stored pick the ranking does not hold, the key and title with the note that nothing
 * scored it.
 *
 * @param props.shown The pick.
 * @param props.context The weights' version and the bar.
 * @returns The row.
 */
function PickRow({
  shown,
  context,
}: Readonly<{
  shown: ShownPick;
  context: { readonly weightsVersion: string; readonly safetyBar: number };
}>) {
  if (shown.kind === "unranked") {
    return (
      <div className="pick-row pick-row--unranked">
        <span className="pick-row__key">{shown.key}</span>
        <span className="pick-row__title">{shown.title}</span>
        <span className="pick-row__note">{UNRANKED_NOTE}</span>
      </div>
    );
  }

  const { candidate } = shown;
  const effort = effortOf(candidate.effort);

  return (
    <div className="pick-row">
      <a className="pick-row__key" href={candidate.url}>
        #{candidate.number}
      </a>
      <span className="pick-row__title">{candidate.title}</span>
      {effort !== null && <EffortChip effort={effort} />}
      <Tag>{candidate.suggestedWorkflow}</Tag>
      <span className="pick-row__why">{reasoningLine(candidate)}</span>
      <Breakdown candidate={candidate} context={context} />
    </div>
  );
}

/**
 * A cold state — sizing in progress with the estimator's real status, an empty backlog with the
 * planning pointer, or nothing safe enough, stated plainly with what was set aside.
 *
 * @param props.firstIssue The picker's answer.
 * @param props.now The clock.
 * @returns The state.
 */
function ColdState({ firstIssue, now }: Readonly<{ firstIssue: OnboardingFirstIssue; now: () => number }>) {
  const still = stillSizingLine(firstIssue.backlog);

  if (firstIssue.state === "empty") {
    return (
      <div className="pick-cold">
        <h3 className="pick-cold__title">{EMPTY_TITLE}</h3>
        <p className="pick-cold__line">{EMPTY_LINE}</p>
        {firstIssue.planning !== null && (
          <Link className="pick-cold__link" href={firstIssue.planning.path}>
            {PLANNING_LINK}
          </Link>
        )}
      </div>
    );
  }

  if (firstIssue.state === "sizing") {
    return (
      <div className="pick-cold">
        <h3 className="pick-cold__title">{SIZING_TITLE}</h3>
        <p className="pick-cold__line">{sizingLine(firstIssue.backlog)}</p>
        {firstIssue.estimator !== null && (
          <p className="pick-cold__estimator">{estimatorStatus(firstIssue.estimator, new Date(now()))}</p>
        )}
      </div>
    );
  }

  return (
    <div className="pick-cold">
      <h3 className="pick-cold__title">{NONE_SAFE_TITLE}</h3>
      <p className="pick-cold__line">
        {noneSafeLine(firstIssue)}
        {still !== null && ` ${still}`}
      </p>
      <p className="pick-cold__line">{NONE_SAFE_LINE}</p>
      {firstIssue.estimator !== null && (
        <p className="pick-cold__estimator">{estimatorStatus(firstIssue.estimator, new Date(now()))}</p>
      )}
    </div>
  );
}

/**
 * The three safety rows, each read from state: the mark says whether the claim holds now, the
 * words say what holds, and the links go to the mechanism — the policy, the inbox, the flip.
 *
 * @param props.policy The dry-run policy as read, why it could not be, or null before any read.
 * @returns The rows.
 */
function SafetyRows({ policy }: Readonly<{ policy: Reading<DryRunPolicy> | null }>) {
  return (
    <ul aria-label={SAFETY_ROWS_LABEL} className="safety">
      {safetyRows(policy).map((row) => (
        <li className={cx("safety__row", MARK_CLASS[row.mark])} data-key={row.key} key={row.key}>
          <span aria-hidden className="safety__mark">
            {SAFETY_GLYPHS[row.mark]}
          </span>
          <span className="safety__text">
            <span className="sr-only">{SAFETY_MARK_NAMES[row.mark]}: </span>
            {row.segments.map((segment, index) =>
              segment.kind === "link" ? (
                <Link className="safety__link" href={segment.href} key={`${String(index)}-${segment.text}`}>
                  {segment.text}
                </Link>
              ) : segment.kind === "term" ? (
                <strong className="safety__term" key={`${String(index)}-${segment.text}`}>
                  {segment.text}
                </strong>
              ) : (
                <span key={`${String(index)}-${segment.text}`}>{segment.text}</span>
              ),
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The *"Your first issue"* card (BC.4, [#393](https://github.com/NobuData/ouroboros/issues/393),
 * mockup 13) — the scored pick with its reasoning, an escape hatch to the safety-ranked backlog,
 * and three safety rows that read live policy instead of describing it.
 *
 * **Live.** The card is re-read on the I.8 poll: the dry-run row changes when an operator flips
 * the policy in Settings, and a backlog read as *sizing* becomes a pick when the nightly estimator
 * lands.
 *
 * **The pick on screen is the wizard's.** The stored ticket is resolved to its scored candidate so
 * its reasoning draws; with nothing stored, the picker's suggestion shows and the frame's *Run my
 * first loop* stores it before it launches. *↻ another* moves to the next candidate in safety
 * order and *or pick your own* opens the sheet — both store the pick at once, so the row and the
 * wizard never disagree.
 *
 * @param props See {@link FirstIssueCardProps}.
 * @returns The card.
 */
export function FirstIssueCard({
  repo,
  initial,
  stepStatus,
  pickedTicket,
  abilities,
  onChanged,
  onSuggestion,
  poll,
  now = Date.now,
}: FirstIssueCardProps) {
  const titleId = useId();
  const { snapshot, refresh } = useKeyedPoll(firstIssueEndpoint(repo), (endpoint) =>
    createFirstIssuePoll(endpoint, poll),
  );
  const [applied, setApplied] = useState<{
    readonly over: PickedTicket | null;
    readonly candidate: OnboardingFirstIssueCandidate;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const polled = snapshot.data ?? (initial?.ok === true ? initial.value : null);
  const failure = polled === null ? (snapshot.error ?? (initial?.ok === false ? initial.reason : null)) : null;
  // A pick stored a moment ago shows at once; the rail's next read (a different ticket) takes over.
  const shown: ShownPick | null =
    applied !== null && applied.over === pickedTicket
      ? { kind: "ranked", candidate: applied.candidate, stored: true }
      : shownPick(polled, pickedTicket);
  const suggestedId = shown?.kind === "ranked" && !shown.stored ? shown.candidate.issueId : null;

  useEffect(() => {
    onSuggestion?.(suggestedId);
  }, [onSuggestion, suggestedId]);

  const candidates = polled?.alternatives.candidates ?? [];
  const currentNumber =
    shown === null ? null : shown.kind === "ranked" ? shown.candidate.number : issueNumberOf(shown.key);
  const next = nextCandidate(candidates, currentNumber);
  const held = !abilities.contribute
    ? VIEWER_PICK_REASON
    : stepStatus === "done"
      ? LAUNCHED_REASON
      : busy !== null
        ? PICKING
        : undefined;
  const anotherReason =
    held ?? (next === null ? (candidates.length === 0 ? NO_CANDIDATES_REASON : ONLY_CANDIDATE_REASON) : undefined);
  const ownReason = held ?? (candidates.length === 0 ? NO_CANDIDATES_REASON : undefined);
  const pill = stepPill(stepStatus);

  /** Store a candidate as the pick, then say what the service answered. */
  function pick(candidate: OnboardingFirstIssueCandidate): void {
    if (busy !== null) return;

    setBusy(candidate.issueId);
    setStatus(null);
    void pickFirstIssue(repo, candidate.issueId).then((outcome) => {
      setBusy(null);

      if (outcome.ok) {
        setApplied({ over: pickedTicket, candidate });
        setStatus({ tone: "ok", text: pickedLine(candidate) });
        setSheetOpen(false);
        refresh();
        onChanged?.();
      } else {
        setStatus({ tone: "refused", text: outcome.reason });
      }
    });
  }

  const actions = (
    <div className="pick-card__actions">
      {shown !== null && (
        <Button
          onClick={() => {
            if (next !== null && anotherReason === undefined) pick(next);
          }}
          reason={anotherReason}
          size="sm"
          tone="ghost"
        >
          {ANOTHER_LABEL}
        </Button>
      )}
      <Button
        onClick={() => {
          if (ownReason === undefined) setSheetOpen(true);
        }}
        reason={ownReason}
        size="sm"
        tone="ghost"
      >
        {OWN_PICK_LABEL}
      </Button>
      {status !== null && !sheetOpen && (
        <p
          className={cx("pick-card__status", status.tone === "refused" && "pick-card__status--refused")}
          role={status.tone === "refused" ? "alert" : "status"}
        >
          {status.text}
        </p>
      )}
    </div>
  );

  return (
    <Card aria-labelledby={titleId} as="section" className="pick-card">
      <CardHead
        beside={
          pill === null ? undefined : (
            <Chip dot={pill.tone === "accent" ? "pulse" : undefined} tone={pill.tone}>
              {pill.text}
            </Chip>
          )
        }
        title={FIRST_ISSUE_TITLE}
        titleId={titleId}
        trailing={
          <Link className="pick-card__browse" href={ISSUES_PATH}>
            {BROWSE_LINK}
          </Link>
        }
      />

      {polled === null ? (
        failure !== null && (
          <p className="pick-card__line" role="alert">
            {failure}
          </p>
        )
      ) : shown !== null ? (
        <>
          <p className="pick-card__line">{pickLine(shown, polled.firstIssue)}</p>
          <PickRow context={polled.firstIssue} shown={shown} />
          {actions}
        </>
      ) : (
        <>
          <ColdState firstIssue={polled.firstIssue} now={now} />
          {polled.firstIssue.state === "none_safe" && candidates.length > 0 && actions}
        </>
      )}

      <hr className="pick-card__divider" />
      <SafetyRows policy={polled?.dryRun ?? null} />

      {polled !== null && (
        <PickSheet
          alternatives={polled.alternatives}
          busy={busy}
          current={currentNumber}
          onClose={() => setSheetOpen(false)}
          onPick={pick}
          open={sheetOpen}
          refusal={status?.tone === "refused" ? status.text : null}
        />
      )}
    </Card>
  );
}
