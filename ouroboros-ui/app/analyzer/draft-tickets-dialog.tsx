"use client";

import { useState } from "react";

import type { AnalysisUndraftedTicket } from "@/app/api/analyzer";
import { initialTracker } from "@/app/planning/generator";
import { TrackerSegment } from "@/app/planning/tracker-segment";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Eyebrow } from "@/app/ui";

import { draftTickets } from "./analyzer-actions";
import { useAnalyzer } from "./analyzer-store";
import { CHOOSE_TRACKER, DRAFT_ROLE_REASON } from "./suggestions-view";
import {
  DRAFTING_TICKETS,
  DRAFT_EYEBROW,
  DRAFT_LEDE,
  DRAFT_TRACKER_LABEL,
  TRACKER_FIXED_NOTE,
  draftIds,
  draftLabel,
  draftTitle,
} from "./tickets-view";

/**
 * The flow behind **Draft N tickets** (BW.4,
 * [#519](https://github.com/NobuData/ouroboros/issues/519)) — how the ticket suggestions an
 * analysis composed become a planning batch.
 *
 * The dialog lists what will be drafted, says what drafting does and does not do — a batch sized
 * by the estimator, nothing in a tracker — and asks the one thing the service needs and cannot
 * change afterwards: **which tracker the batch is for**. The choice is the planning page's own
 * segment over the trackers the page read, so one that cannot be written to is disabled here with
 * the same reason it is there.
 *
 * On success it closes and the page is read again: the batch is on the card, its rows `sizing…`
 * until the estimator answers. A refusal stays in the dialog, in the service's words.
 *
 * A member reads all of it; the confirm is inert with the reason.
 *
 * @param props.suggestions The suggestions **Draft N tickets** was pressed for, or `null`.
 * @param props.onClose Called when the dialog closes — backed out of, or done.
 * @returns The dialog while suggestions are given; nothing otherwise.
 */
export function DraftTicketsDialog({
  suggestions,
  onClose,
}: Readonly<{ suggestions: readonly AnalysisUndraftedTicket[] | null; onClose: () => void }>) {
  const open = suggestions !== null && suggestions.length > 0;

  return (
    <ShellOverlay label={DRAFT_EYEBROW} onClose={onClose} open={open}>
      {open && <DraftTickets onClose={onClose} suggestions={suggestions} />}
    </ShellOverlay>
  );
}

/**
 * The dialog's content.
 *
 * @param props.suggestions The suggestions to draft, in the card's order.
 * @param props.onClose Called to close the dialog.
 * @returns What will be drafted, the tracker choice and the confirm.
 */
function DraftTickets({
  suggestions,
  onClose,
}: Readonly<{ suggestions: readonly AnalysisUndraftedTicket[]; onClose: () => void }>) {
  const { mayAdminister, trackers, trackersFailure, refresh } = useAnalyzer();
  const [chosen, setChosen] = useState<string | null>(() => initialTracker(trackers, null));
  const [drafting, setDrafting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /** Draft them for the chosen tracker. */
  function draft(): void {
    if (drafting || chosen === null || !mayAdminister) return;

    setDrafting(true);
    setFailure(null);
    void draftTickets(draftIds(suggestions), chosen).then((answer) => {
      setDrafting(false);

      if (!answer.ok) {
        setFailure(answer.reason);
        return;
      }

      refresh();
      onClose();
    });
  }

  const confirmReason = !mayAdminister
    ? DRAFT_ROLE_REASON
    : drafting
      ? DRAFTING_TICKETS
      : chosen === null
        ? CHOOSE_TRACKER
        : undefined;

  return (
    <div className="analyzer-tixdraft">
      <div>
        <Eyebrow>{DRAFT_EYEBROW}</Eyebrow>
        <h2 className="shell-overlay__title">{draftTitle(suggestions.length)}</h2>
      </div>
      <p className="analyzer-tixdraft__lede">{DRAFT_LEDE}</p>

      <ul className="analyzer-tixdraft__list">
        {suggestions.map((suggestion) => (
          <li className="analyzer-tixdraft__item" key={suggestion.id}>
            <span className="analyzer-tixdraft__title">{suggestion.title}</span>
            <span className="analyzer-tixdraft__evidence">{suggestion.evidenceLine}</span>
          </li>
        ))}
      </ul>

      {mayAdminister && (
        <div>
          <p className="analyzer-tixdraft__label">{DRAFT_TRACKER_LABEL}</p>
          {trackersFailure === null ? (
            <TrackerSegment
              onChange={setChosen}
              options={trackers}
              reason={drafting ? DRAFTING_TICKETS : undefined}
              value={chosen}
            />
          ) : (
            <p className="analyzer-tixdraft__error" role="alert">
              {trackersFailure}
            </p>
          )}
          <p className="analyzer-tixdraft__note">{TRACKER_FIXED_NOTE}</p>
        </div>
      )}

      {failure !== null && (
        <p className="analyzer-tixdraft__error" role="alert">
          {failure}
        </p>
      )}

      <div className="analyzer-tixdraft__actions">
        <Button onClick={onClose} tone="ghost">
          Cancel
        </Button>
        <Button onClick={draft} reason={confirmReason} tone="primary">
          {drafting ? DRAFTING_TICKETS : draftLabel(suggestions.length)}
        </Button>
      </div>
    </div>
  );
}
