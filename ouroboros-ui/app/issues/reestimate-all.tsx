"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Reading } from "@/app/api/reading";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import { reestimateAll } from "./head-actions";
import { HeadOutcomeLine } from "./head-outcome";
import {
  type BacklogCounts,
  CANCEL_LABEL,
  type HeadOutcome,
  REESTIMATE_LABEL,
  REESTIMATE_NOTE,
  REESTIMATE_TITLE,
  reestimateConfirmLabel,
  reestimateReason,
  reestimateScope,
} from "./view";

/**
 * The page head's ghost action — **Re-estimate all**
 * ([#115](https://github.com/NobuData/ouroboros/issues/115)), over L.4's fan-out
 * ([#108](https://github.com/NobuData/ouroboros/issues/108)).
 *
 * ### It asks first, and it states the scope
 *
 * One press claims every issue the workspace mirrors and spends the workspace's engine quota on
 * them, so the button opens a confirmation rather than acting. L.4 wrote the confirmation contract
 * as two halves, and this draws both. The dialog says *"This re-estimates N issues"* from the
 * page's own read — the mirrored count, open and closed, because that is the set the fan-out claims
 * from (`app/issues/data.ts` argues it). The answer then says how many it **actually** started,
 * which can be fewer: issues already in flight are left alone.
 *
 * A press that could not state a number is not offered. When the counts failed to read, or the
 * workspace mirrors nothing, the button is inert with the reason ({@link reestimateReason}), and the
 * dialog is never mounted.
 *
 * ### Who sees it
 *
 * The issue calls it *admin-visible*, and `app/issues/issues-screen.tsx` renders this only for an
 * `owner` or an `admin` — a member sees no control rather than one they cannot press. The gate that
 * enforces is the service's; `app/issues/head-actions.ts` says what a press that went around the
 * presentation is answered with.
 *
 * @param props.counts The head's counts, or why the backlog could not be counted.
 * @returns The button, what its last press came back as, and the confirmation while it is open.
 */
export function ReestimateAllButton({ counts }: Readonly<{ counts: Reading<BacklogCounts> }>) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<HeadOutcome | null>(null);

  /** Commit to the confirmation: close it, start the fan-out, and report what started. */
  async function confirm(): Promise<void> {
    setConfirming(false);
    if (pending) return;

    setPending(true);
    setOutcome(null);

    try {
      const result = await reestimateAll();
      setOutcome(result);

      // The issues' statuses have moved into `estimating`; the route re-reads so what the page
      // draws follows them.
      if (result.ok) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="issues__action">
      <Button
        aria-busy={pending || undefined}
        onClick={() => {
          if (!pending) setConfirming(true);
        }}
        reason={reestimateReason(counts)}
        tone="ghost"
      >
        {REESTIMATE_LABEL}
      </Button>
      <HeadOutcomeLine outcome={outcome} />

      {counts.ok && (
        <ShellOverlay label={REESTIMATE_TITLE} onClose={() => setConfirming(false)} open={confirming}>
          <div className="issues-confirm">
            <h2 className="shell-overlay__title">{REESTIMATE_TITLE}</h2>
            <p className="shell-overlay__note">{reestimateScope(counts.value.mirroredCount)}</p>
            <p className="shell-overlay__note">{REESTIMATE_NOTE}</p>
            <div className="issues-confirm__actions">
              <Button onClick={() => void confirm()} tone="primary">
                {reestimateConfirmLabel(counts.value.mirroredCount)}
              </Button>
              <Button onClick={() => setConfirming(false)} tone="ghost">
                {CANCEL_LABEL}
              </Button>
            </div>
          </div>
        </ShellOverlay>
      )}
    </div>
  );
}
