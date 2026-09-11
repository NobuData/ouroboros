"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/app/ui";

import { queueSelected } from "./head-actions";
import { HeadOutcomeLine } from "./head-outcome";
import { useIssueSelection } from "./selection";
import { type HeadOutcome, queueLabel, queueReason } from "./view";

/**
 * The page head's primary action — **Queue N selected ⟳**
 * ([#115](https://github.com/NobuData/ouroboros/issues/115)), over M.3's bulk queue
 * ([#112](https://github.com/NobuData/ouroboros/issues/112)).
 *
 * ### It reflects the selection, and is inert at zero
 *
 * The label carries the selection's live count ({@link useIssueSelection}), and a press sends
 * exactly those ids, in the order they were selected, with no workflow — which the contract reads as
 * *each issue under the workflow its own estimate suggested*, the difference between this button and
 * the selection bar's *Queue → standard-fix*. With nothing selected the button is inert and says
 * why; so is a viewer's, whatever is selected, because the service would refuse the press
 * ({@link queueReason}). Inert is `aria-disabled` with the reason as its tooltip — the #46 button's
 * only way to switch a control off — so the explanation stays in the tab order.
 *
 * ### A press that took clears the selection
 *
 * Those issues are queued now, and a selection still holding them would offer to queue them a second
 * time, which the service refuses as `issue_already_queued`. The route re-reads so what the page draws
 * moves on. A refusal clears nothing: the write is all or nothing, and the reader may want to
 * deselect the one issue the refusal names and press again.
 *
 * **The pending flag is plain state, flipped in `finally`.** It guards against a second press while
 * the first is in flight, and `useTransition`'s flag does not reliably clear under the test
 * environment once an awaited update has rendered.
 *
 * @param props.mayContribute Whether this reader's role may queue issues.
 * @returns The button, with what its last press came back as under it.
 */
export function QueueSelectedButton({ mayContribute }: Readonly<{ mayContribute: boolean }>) {
  const router = useRouter();
  const { ids, clear } = useIssueSelection();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<HeadOutcome | null>(null);

  /** Send the selection, and report what came back. */
  async function press(): Promise<void> {
    if (pending) return;

    setPending(true);
    setOutcome(null);

    try {
      const result = await queueSelected(ids);
      setOutcome(result);

      if (result.ok) {
        clear();
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="issues__action">
      <Button
        aria-busy={pending || undefined}
        onClick={() => void press()}
        reason={queueReason(ids.length, mayContribute)}
        tone="primary"
      >
        {queueLabel(ids.length)}
      </Button>
      <HeadOutcomeLine outcome={outcome} />
    </div>
  );
}
