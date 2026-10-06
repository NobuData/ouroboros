"use client";

import { useId } from "react";

import type { OnboardingFirstIssueAlternatives, OnboardingFirstIssueCandidate } from "@/app/api/onboarding";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Chip, EffortChip, Tag } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import {
  BELOW_BAR_TAG,
  CURRENT_TAG,
  NO_CANDIDATES_REASON,
  PICKING,
  SHEET_CANCEL,
  SHEET_LIST_LABEL,
  SHEET_TITLE,
  candidateName,
  reasoningLine,
  scoreLine,
  sheetNote,
} from "./first-issue-view";
import { effortOf } from "./templates-view";

/** What {@link PickSheet} is told. */
export interface PickSheetProps {
  /** Whether it is open. */
  readonly open: boolean;
  /** The ranking — every qualifying candidate, safest first, with its reasoning. */
  readonly alternatives: OnboardingFirstIssueAlternatives;
  /** The number of the pick on screen, or null when there is none. */
  readonly current: number | null;
  /** The `issueId` of the pick in flight, or null. */
  readonly busy: string | null;
  /** Why the last pick was refused, while the sheet stays open to try another. */
  readonly refusal: string | null;
  /** Keep the current pick — Escape, the backdrop, or the cancel. */
  readonly onClose: () => void;
  /** Store a candidate as the pick. */
  readonly onPick: (candidate: OnboardingFirstIssueCandidate) => void;
}

/**
 * *Or pick your own ▾* (BC.4, [#393](https://github.com/NobuData/ouroboros/issues/393)) — the
 * backlog **safety-ranked**, not a filter dropdown: each candidate carries its own reasoning
 * line and score, the ones below the bar say so, and the current pick is marked. A press stores
 * the candidate as the wizard's pick; the card shows the swap.
 *
 * Every row is a button, so the list is keyboard-operable; `ShellOverlay` traps Tab in the panel,
 * Escape keeps the current pick, and focus returns to the control that opened it.
 *
 * @param props See {@link PickSheetProps}.
 * @returns The sheet while open, nothing otherwise.
 */
export function PickSheet({ open, alternatives, current, busy, refusal, onClose, onPick }: PickSheetProps) {
  const noteId = useId();
  const { candidates } = alternatives;

  if (!open) return null;

  return (
    <ShellOverlay describedBy={noteId} label={SHEET_TITLE} onClose={onClose} open>
      <div className="pick-sheet">
        <h2 className="shell-overlay__title">{SHEET_TITLE}</h2>
        <p className="shell-overlay__note" id={noteId}>
          {sheetNote(alternatives)}
        </p>
        {refusal !== null && (
          <p className="pick-sheet__refusal" role="alert">
            {refusal}
          </p>
        )}
        {candidates.length === 0 ? (
          <p className="pick-sheet__empty">{NO_CANDIDATES_REASON}</p>
        ) : (
          <ul aria-label={SHEET_LIST_LABEL} className="pick-sheet__rows">
            {candidates.map((candidate) => {
              const isCurrent = candidate.number === current;
              const effort = effortOf(candidate.effort);

              return (
                <li
                  className={cx(
                    "pick-sheet__row",
                    isCurrent && "pick-sheet__row--current",
                    !candidate.clearsBar && "pick-sheet__row--below",
                  )}
                  key={candidate.issueId}
                >
                  <button
                    aria-disabled={busy !== null ? "true" : undefined}
                    aria-label={candidateName(candidate)}
                    aria-pressed={isCurrent}
                    className="pick-sheet__select"
                    onClick={() => {
                      if (busy === null) onPick(candidate);
                    }}
                    type="button"
                  >
                    <span className="pick-sheet__head">
                      <span className="pick-sheet__key">#{candidate.number}</span>
                      <span className="pick-sheet__title">{candidate.title}</span>
                    </span>
                    <span className="pick-sheet__chips">
                      {effort !== null && <EffortChip effort={effort} />}
                      <Tag>{candidate.suggestedWorkflow}</Tag>
                      {!candidate.clearsBar && <Chip tone="warn">{BELOW_BAR_TAG}</Chip>}
                      {isCurrent && <Chip tone="accent">{CURRENT_TAG}</Chip>}
                      {busy === candidate.issueId && <Chip tone="accent">{PICKING}</Chip>}
                    </span>
                    <span className="pick-sheet__why">
                      {reasoningLine(candidate)} · {scoreLine(candidate)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="pick-sheet__actions">
          <Button onClick={onClose} tone="ghost" type="button">
            {SHEET_CANCEL}
          </Button>
        </div>
      </div>
    </ShellOverlay>
  );
}
