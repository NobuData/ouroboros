"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { AnalysisSuggestion } from "@/app/api/analyzer";
import { type TrackerOption, initialTracker } from "@/app/planning/generator";
import { TrackerSegment } from "@/app/planning/tracker-segment";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Eyebrow } from "@/app/ui";

import { type DraftOutcome, draftSpike, readDraftTargets } from "./analyzer-actions";
import { useAnalyzer } from "./analyzer-store";
import {
  CHOOSE_TRACKER,
  DRAFT_ROLE_REASON,
  GO_GLYPH,
  OPEN_DRAFT,
  SPIKE_CONFIRM,
  SPIKE_DRAFTED,
  SPIKE_DRAFTING,
  SPIKE_EYEBROW,
  SPIKE_LABELS,
  SPIKE_LEDE,
  TRACKERS_LOADING,
  spikeTitle,
  spikeUncertainty,
} from "./suggestions-view";

/** The workspace's trackers: being read, read, or why not. */
type Trackers =
  | { readonly phase: "loading" }
  | { readonly phase: "failed"; readonly reason: string }
  | { readonly phase: "ready"; readonly options: readonly TrackerOption[] };

/**
 * The single-draft flow behind **Draft spike ticket** (BW.3,
 * [#518](https://github.com/NobuData/ouroboros/issues/518)) — what a row whose change the analyzer
 * could not verify offers where the others have Apply.
 *
 * The dialog shows the ticket before it is drafted: its title, **what is uncertain** — the impact
 * basis's own words, carried into the ticket's body by the service — and the evidence. It says the
 * ticket asserts no impact, asks which tracker it is for (the planning page's own segment, so a
 * tracker that cannot be written to is disabled here with the same reason), and drafts it into a
 * planning batch. Nothing reaches a tracker: the dialog then links to the batch, where the ticket
 * is edited and pushed like any other.
 *
 * A member reads all of it; the confirm is inert with the reason, and the trackers are not read.
 *
 * @param props.suggestion The spike whose control was pressed, or `null`.
 * @param props.onClose Called when the reader backs out before drafting.
 * @param props.onResolved Called with the suggestion's id when a dialog that drafted it closes.
 * @returns The dialog while a suggestion is given; nothing otherwise.
 */
export function SpikeDialog({
  suggestion,
  onClose,
  onResolved,
}: Readonly<{
  suggestion: AnalysisSuggestion | null;
  onClose: () => void;
  onResolved: (id: string) => void;
}>) {
  const [drafted, setDrafted] = useState<string | null>(null);
  const label = suggestion === null ? SPIKE_EYEBROW : `${SPIKE_EYEBROW} · ${suggestion.title}`;

  /** Close the dialog — onto the resolved row, when this dialog drafted it. */
  function close(): void {
    if (suggestion !== null && drafted === suggestion.id) onResolved(suggestion.id);
    else onClose();
  }

  return (
    <ShellOverlay label={label} onClose={close} open={suggestion !== null}>
      {suggestion !== null && (
        <SpikeDraft key={suggestion.id} onClose={close} onDrafted={setDrafted} suggestion={suggestion} />
      )}
    </ShellOverlay>
  );
}

/**
 * The dialog's content, for one spike.
 *
 * @param props.suggestion The suggestion.
 * @param props.onClose Called to close the dialog.
 * @param props.onDrafted Called with the suggestion's id once it has been drafted.
 * @returns The ticket as it will be drafted, the tracker choice and the confirm — or, once
 *   drafted, where the draft is.
 */
function SpikeDraft({
  suggestion,
  onClose,
  onDrafted,
}: Readonly<{ suggestion: AnalysisSuggestion; onClose: () => void; onDrafted: (id: string) => void }>) {
  const { mayAdminister, resolveLocally, now } = useAnalyzer();
  const [trackers, setTrackers] = useState<Trackers>({ phase: "loading" });
  const [chosen, setChosen] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [outcome, setOutcome] = useState<DraftOutcome | null>(null);

  useEffect(() => {
    // Only somebody who can draft is asked which tracker for.
    if (!mayAdminister) return;

    let open = true;
    void readDraftTargets().then((answer) => {
      if (!open) return;

      if (!answer.ok) {
        setTrackers({ phase: "failed", reason: answer.reason });
        return;
      }

      setTrackers({ phase: "ready", options: answer.options });
      // Opens on the first tracker that can be written to, as the planning page's generator does.
      setChosen(initialTracker(answer.options, null));
    });

    return () => {
      open = false;
    };
  }, [mayAdminister]);

  /** Draft the spike for the chosen tracker. */
  function draft(): void {
    if (drafting || chosen === null || !mayAdminister) return;

    setDrafting(true);
    void draftSpike(suggestion.id, chosen).then((answer) => {
      setDrafting(false);
      setOutcome(answer);
      if (!answer.ok) return;

      resolveLocally(suggestion.id, {
        status: "drafted",
        at: now.toISOString(),
        reason: null,
        draftBatchId: answer.batchId,
        windowDays: null,
      });
      onDrafted(suggestion.id);
    });
  }

  if (outcome?.ok === true) {
    return (
      <div className="analyzer-spike">
        <div>
          <Eyebrow>{SPIKE_EYEBROW}</Eyebrow>
          <h2 className="shell-overlay__title">{outcome.title ?? spikeTitle(suggestion)}</h2>
        </div>
        <p className="analyzer-spike__done" role="status">
          {outcome.localKey === null ? "" : `${outcome.localKey} · `}
          {SPIKE_DRAFTED}
        </p>
        <div className="analyzer-spike__actions">
          <Button onClick={onClose} tone="ghost">
            Close
          </Button>
          <Link className="analyzer-spike__link" href={outcome.href}>
            {OPEN_DRAFT} <span aria-hidden="true">{GO_GLYPH}</span>
          </Link>
        </div>
      </div>
    );
  }

  const confirmReason = !mayAdminister
    ? DRAFT_ROLE_REASON
    : drafting
      ? SPIKE_DRAFTING
      : chosen === null
        ? CHOOSE_TRACKER
        : undefined;

  return (
    <div className="analyzer-spike">
      <div>
        <Eyebrow>{SPIKE_EYEBROW}</Eyebrow>
        <h2 className="shell-overlay__title">{suggestion.title}</h2>
      </div>
      <p className="analyzer-spike__lede">{SPIKE_LEDE}</p>

      <dl className="analyzer-spike__parts">
        <div>
          <dt className="analyzer-spike__label">{SPIKE_LABELS.title}</dt>
          <dd className="analyzer-spike__value">{spikeTitle(suggestion)}</dd>
        </div>
        <div>
          <dt className="analyzer-spike__label">{SPIKE_LABELS.uncertain}</dt>
          <dd className="analyzer-spike__value">{spikeUncertainty(suggestion)}</dd>
        </div>
        <div>
          <dt className="analyzer-spike__label">{SPIKE_LABELS.evidence}</dt>
          <dd className="analyzer-spike__value analyzer-spike__value--mono">{suggestion.evidenceLine}</dd>
        </div>
      </dl>

      {mayAdminister && (
        <div>
          <p className="analyzer-spike__label">{SPIKE_LABELS.tracker}</p>
          {trackers.phase === "loading" && (
            <p className="analyzer-spike__note" role="status">
              {TRACKERS_LOADING}
            </p>
          )}
          {trackers.phase === "failed" && (
            <p className="analyzer-spike__error" role="alert">
              {trackers.reason}
            </p>
          )}
          {trackers.phase === "ready" && (
            <TrackerSegment
              onChange={setChosen}
              options={trackers.options}
              reason={drafting ? SPIKE_DRAFTING : undefined}
              value={chosen}
            />
          )}
        </div>
      )}

      {outcome?.ok === false && (
        <p className="analyzer-spike__error" role="alert">
          {outcome.reason}
        </p>
      )}

      <div className="analyzer-spike__actions">
        <Button onClick={onClose} tone="ghost">
          Cancel
        </Button>
        <Button onClick={draft} reason={confirmReason} tone="primary">
          {drafting ? SPIKE_DRAFTING : SPIKE_CONFIRM}
        </Button>
      </div>
    </div>
  );
}
