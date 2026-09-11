"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button, StickyBar } from "@/app/ui";

import {
  CLOSE_LABEL,
  DASHBOARD_QUEUE_HREF,
  DISMISS_LABEL,
  NOTHING_QUEUED_TITLE,
  type Offender,
  SEE_QUEUE_LABEL,
  type WorkflowChoice,
  deselectLabel,
  estimateLabel,
  leftOutNote,
  offenderLine,
  queueUnderLabel,
  queuedToast,
  selectedLabel,
  summarize,
} from "./bar";
import { queueUnder } from "./head-actions";
import { HeadOutcomeLine } from "./head-outcome";
import type { SeenRowMap } from "./seen-rows";
import { useIssueSelection, useSeenRows } from "./selection";
import { type HeadOutcome, queueReason } from "./view";
import { WorkflowMenu } from "./workflow-menu";

/**
 * Mockup 03's `.sel-bar` ([#118](https://github.com/NobuData/ouroboros/issues/118)) — where a
 * multi-select turns into committed work: the selection counted and summed, the workflow to
 * queue it under, and the press that queues it.
 *
 * ### It appears with the selection, and it is the page's sticky slot
 *
 * Nothing is drawn at zero: a bar offering to queue nothing would be the one dishonest thing on
 * the page, and the head's **Queue N selected ⟳** already says where a selection is made. With
 * one row ticked the bar mounts below the table, as the mockup draws it, in the #46 `StickyBar`
 * — the one such slot the chrome contract gives a page (`app/ui/chrome.ts`), reserved for this
 * bar since the page head shipped — wearing the `asking` rim, which is the mockup's glow.
 *
 * ### The number is a preview, and the service's is the truth
 *
 * *"est. 2h 5m combined autonomous work"* is summed here from the selected rows as the table
 * last saw them (`app/issues/seen-rows.ts`), so it is right for every id the selection holds and
 * not only the page on screen. The queue write answers with its own sum over the rows it
 * created, and that is the number the toast prints; `app/issues/bar.ts` says why the two agree.
 *
 * ### One press, three outcomes
 *
 * A press that **took** clears the selection — those issues are queued now, and a selection
 * still holding them would offer to queue them a second time — re-reads the route so the
 * `queued` pills follow, and leaves a toast below the table with the service's count and sum and
 * a link to the dashboard's *Up next in queue* card, where the rows now are. A refusal that
 * **names issues** opens a dialog under the title *Nothing was queued*, one sentence per issue
 * (*"#483 is still being sized."*), the all-or-nothing note for the rest, and a way to deselect
 * exactly the issues it named. A refusal that names **none** — a role, a request the service
 * could not read — is a line in the bar, as the head's are. A refusal clears nothing: the write
 * is all or nothing, and the selection is still the reader's to fix.
 *
 * **The pending flag is plain state, flipped in `finally`**, for the reason the head's button
 * gives: it guards against a second press while the first is in flight, and `useTransition`'s
 * flag does not reliably clear under the test environment.
 *
 * @param props.mayContribute Whether this reader's role may queue issues. A viewer's action is
 *   inert with the reason, as the head's is.
 * @returns The bar while something is selected, the toast after a press that took, and the
 *   dialog while a refusal is being explained.
 */
export function SelectionBar({ mayContribute }: Readonly<{ mayContribute: boolean }>) {
  const router = useRouter();
  const { ids, clear, deselect } = useIssueSelection();
  const seen = useSeenRows();
  const [choice, setChoice] = useState<WorkflowChoice>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<HeadOutcome | null>(null);
  const [named, setNamed] = useState<readonly Offender[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const summary = useMemo(() => summarize(ids, seen), [ids, seen]);

  /** Send the selection under the choice, and draw what came back. */
  async function press(): Promise<void> {
    if (pending) return;

    setPending(true);
    setFailure(null);
    setNamed(null);
    setToast(null);

    try {
      const outcome = await queueUnder(ids, choice);

      if (outcome.ok) {
        setToast(queuedToast(outcome.queued));
        clear();
        router.refresh();
      } else if (outcome.offenders.length > 0) {
        setNamed(outcome.offenders);
      } else {
        setFailure({ ok: false, reason: outcome.reason });
      }
    } finally {
      setPending(false);
    }
  }

  /** Drop the issues the refusal named, keep the rest, and close the dialog. */
  function deselectNamed(): void {
    if (named !== null) deselect(named.map((offender) => offender.issueId));
    setNamed(null);
  }

  return (
    <>
      {ids.length > 0 && (
        <StickyBar className="issues-bar" tone="asking">
          <p className="issues-bar__summary">
            <strong>{selectedLabel(summary.count)}</strong>{" "}
            <span className="issues-bar__estimate">{estimateLabel(summary)}</span>
          </p>
          <div className="issues-bar__actions">
            <WorkflowMenu choice={choice} onChoose={setChoice} />
            <Button
              aria-busy={pending || undefined}
              onClick={() => void press()}
              reason={queueReason(ids.length, mayContribute)}
              size="sm"
              tone="primary"
            >
              {queueUnderLabel(choice, summary)}
            </Button>
          </div>
          <HeadOutcomeLine outcome={failure} />
        </StickyBar>
      )}

      {toast !== null && (
        <div className="issues-toast" role="status">
          <span className="issues-toast__text">{toast}</span>
          <Link className="ou-btn ou-btn--ghost ou-btn--sm" href={DASHBOARD_QUEUE_HREF}>
            {SEE_QUEUE_LABEL}
          </Link>
          <Button aria-label={DISMISS_LABEL} onClick={() => setToast(null)} size="sm" tone="ghost">
            ×
          </Button>
        </div>
      )}

      <RefusalDialog
        named={named}
        onClose={() => setNamed(null)}
        onDeselect={deselectNamed}
        seen={seen}
        selected={ids.length}
      />
    </>
  );
}

/**
 * The designed explanation of a refused press: what the transaction did, which is nothing, and
 * exactly why, one issue at a time.
 *
 * Inside the shell's overlay (`app/shell/overlay.tsx`), so it is modal, Escape closes it and
 * focus returns to the action that opened it. The list is the whole point: M.3 names every
 * offender, so the reader learns which row to fix rather than that something was wrong.
 *
 * @param props.named The issues the refusal named, or `null` while there is no refusal to
 *   explain — in which case nothing is mounted.
 * @param props.selected How many issues were sent, for the all-or-nothing note.
 * @param props.seen The rows as the table last saw them, to name an issue a `404` could not.
 * @param props.onClose Dismiss without changing the selection.
 * @param props.onDeselect Drop the named issues from the selection and dismiss.
 * @returns The dialog while there is a refusal, else nothing.
 */
function RefusalDialog({
  named,
  selected,
  seen,
  onClose,
  onDeselect,
}: Readonly<{
  named: readonly Offender[] | null;
  selected: number;
  seen: SeenRowMap;
  onClose: () => void;
  onDeselect: () => void;
}>) {
  if (named === null) return null;

  const note = leftOutNote(selected, named.length);

  return (
    <ShellOverlay label={NOTHING_QUEUED_TITLE} onClose={onClose} open>
      <div className="issues-confirm">
        <h2 className="shell-overlay__title">{NOTHING_QUEUED_TITLE}</h2>
        <ul className="issues-refusal">
          {named.map((offender) => (
            <li key={offender.issueId}>{offenderLine(offender, seen)}</li>
          ))}
        </ul>
        {note !== null && <p className="shell-overlay__note">{note}</p>}
        <div className="issues-confirm__actions">
          <Button onClick={onDeselect} tone="primary">
            {deselectLabel(named.length)}
          </Button>
          <Button onClick={onClose} tone="ghost">
            {CLOSE_LABEL}
          </Button>
        </div>
      </div>
    </ShellOverlay>
  );
}
