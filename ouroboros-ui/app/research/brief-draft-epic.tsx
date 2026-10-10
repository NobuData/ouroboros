"use client";

import { useId, useState } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import {
  DRAFTING_LABEL,
  DRAFT_EPIC_LABEL,
  TARGET_REQUIRED_CODE,
  TRACKERS_LOADING,
  TRACKER_CANCEL_LABEL,
  TRACKER_CONFIRM_LABEL,
  TRACKER_DIALOG_NOTE,
  TRACKER_DIALOG_TITLE,
  type TrackersOutcome,
  VIEWER_DRAFT_REASON,
} from "./brief";
import { draftEpicFromGaps, readTrackers } from "./brief-actions";

/** What the action takes. */
export interface DraftEpicActionProps {
  /** The investigation. */
  readonly investigationId: string;
  /** Whether this reader may draft — `owner`, `admin` or `member`. */
  readonly mayDraft: boolean;
  /** Told where the batch is, once drafted. The card navigates there. */
  readonly onDrafted: (href: string) => void;
  /** Told a refusal the service made, in its words. */
  readonly onRefusal: (message: string) => void;
}

/**
 * **Draft epic from gaps →** (CN.4, [#630](https://github.com/NobuData/ouroboros/issues/630)) —
 * the page's payoff, and obviously safe: it posts CM.5's hand-off, which **files nothing**, and
 * navigates to the batch in Planning for review.
 *
 * **The tracker is asked for only when it is ambiguous.** The service drafts without being told
 * when the workspace has one ticket source and refuses `roadmap_target_required` when it has
 * several; on that refusal — and only then — a dialog lists the workspace's trackers and the
 * pick is posted. Any other refusal is handed up in the service's words.
 *
 * @param props See {@link DraftEpicActionProps}.
 * @returns The button, and the dialog while a tracker is being chosen.
 */
export function DraftEpicAction({ investigationId, mayDraft, onDrafted, onRefusal }: DraftEpicActionProps) {
  const [drafting, setDrafting] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [trackers, setTrackers] = useState<TrackersOutcome | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const noteId = useId();
  const groupId = useId();

  /**
   * Post the hand-off, with a tracker when one was chosen.
   *
   * @param targetSourceId The tracker, or undefined to let the service choose.
   */
  async function draft(targetSourceId?: string): Promise<void> {
    setDrafting(true);
    const outcome = await draftEpicFromGaps(investigationId, targetSourceId);
    setDrafting(false);

    if (outcome.ok) {
      setChoosing(false);
      onDrafted(outcome.href);
      return;
    }
    if (outcome.refusal.code === TARGET_REQUIRED_CODE && targetSourceId === undefined) {
      setChoosing(true);
      setTrackers(null);
      void readTrackers().then((read) => {
        setTrackers(read);
        if (read.ok) setChosen(read.trackers[0]?.id ?? null);
      });
      return;
    }
    setChoosing(false);
    onRefusal(outcome.refusal.message);
  }

  const reason = !mayDraft ? VIEWER_DRAFT_REASON : drafting ? DRAFTING_LABEL : undefined;

  return (
    <>
      <Button onClick={() => void draft()} reason={reason} size="sm" tone="primary">
        {drafting && !choosing ? DRAFTING_LABEL : DRAFT_EPIC_LABEL}
      </Button>

      <ShellOverlay
        describedBy={noteId}
        label={TRACKER_DIALOG_TITLE}
        onClose={() => setChoosing(false)}
        open={choosing}
      >
        <form
          className="research__tracker"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (chosen !== null) void draft(chosen);
          }}
        >
          <h2 className="shell-overlay__title">{TRACKER_DIALOG_TITLE}</h2>
          <p className="research__tracker-note" id={noteId}>
            {TRACKER_DIALOG_NOTE}
          </p>

          {trackers === null && <p className="research__tracker-note">{TRACKERS_LOADING}</p>}
          {trackers?.ok === false && (
            <p className="research__tracker-note" role="alert">
              {trackers.refusal.message}
            </p>
          )}
          {trackers?.ok === true && (
            <div aria-labelledby={groupId} className="research__tracker-options" role="radiogroup">
              <span className="sr-only" id={groupId}>
                {TRACKER_DIALOG_TITLE}
              </span>
              {trackers.trackers.map((tracker) => (
                <label className="research__tracker-option" key={tracker.id}>
                  <input
                    checked={chosen === tracker.id}
                    name="tracker"
                    onChange={() => setChosen(tracker.id)}
                    type="radio"
                    value={tracker.id}
                  />
                  <span>{tracker.displayName}</span>
                  <span className="research__tracker-kind">{tracker.kind}</span>
                </label>
              ))}
            </div>
          )}

          <div className="research__tracker-actions">
            <Button
              reason={drafting ? DRAFTING_LABEL : chosen === null ? TRACKERS_LOADING : undefined}
              tone="primary"
              type="submit"
            >
              {drafting ? DRAFTING_LABEL : TRACKER_CONFIRM_LABEL}
            </Button>
            <Button onClick={() => setChoosing(false)} tone="ghost" type="button">
              {TRACKER_CANCEL_LABEL}
            </Button>
          </div>
        </form>
      </ShellOverlay>
    </>
  );
}
