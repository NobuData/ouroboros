"use client";

import { useId, useRef, useState } from "react";

import type { InboxSnoozeResult } from "@/app/api/inbox";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import { snoozeAll } from "./inbox-actions";
import {
  CANCEL,
  SNOOZE_ALL_LABEL,
  WORKING,
  type SnoozeConfirmation,
  snoozeAllReason,
  snoozeConfirmation,
} from "./view";

/** What {@link SnoozeAll} takes. */
export interface SnoozeAllProps {
  /** Asking items now. */
  readonly count: number;
  /** Whether this reader may snooze. */
  readonly maySnooze: boolean;
  /** How an instant is printed — `14:20`. */
  readonly clock: (atMs: number) => string;
  /** The clock the wake time is computed from — a test seam. */
  readonly now?: () => number;
  /** Hears what the service did, so the page can re-read the queue. */
  readonly onSnoozed: (result: InboxSnoozeResult) => void;
}

/**
 * *Snooze all 1h* (BO.1, [#466](https://github.com/NobuData/ouroboros/issues/466)) — a button
 * that asks first. It silences everything for an hour and one of those items may be blocking a
 * deployment, so the dialog names how many and until when; inert at zero, and for a viewer.
 *
 * @param props See {@link SnoozeAllProps}.
 * @returns The button and its confirmation.
 */
export function SnoozeAll({ count, maySnooze, clock, now = Date.now, onSnoozed }: SnoozeAllProps) {
  const described = useId();
  const [asking, setAsking] = useState<SnoozeConfirmation | null>(null);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const sent = useRef(false);
  const reason = snoozeAllReason(count, maySnooze);

  function close(): void {
    setRefusal(null);
    setAsking(null);
  }

  async function confirm(): Promise<void> {
    if (sent.current) return;

    sent.current = true;
    setSending(true);
    setRefusal(null);

    try {
      const outcome = await snoozeAll();

      if (outcome.ok) {
        onSnoozed(outcome.value);
        setAsking(null);
      } else {
        setRefusal(outcome.reason);
      }
    } finally {
      sent.current = false;
      setSending(false);
    }
  }

  return (
    <>
      <Button
        aria-haspopup="dialog"
        onClick={() => setAsking(snoozeConfirmation(count, now(), clock))}
        reason={reason}
        tone="ghost"
      >
        {SNOOZE_ALL_LABEL}
      </Button>
      <ShellOverlay
        describedBy={described}
        label={asking?.title ?? ""}
        onClose={close}
        open={asking !== null}
        role="alertdialog"
      >
        {asking !== null && (
          <div className="inbox-dialog">
            <h2 className="shell-overlay__title">{asking.title}</h2>
            <p className="inbox-dialog__warning" id={described}>
              {asking.warning}
            </p>
            {refusal !== null && (
              <p className="inbox-dialog__refusal" role="alert">
                {refusal}
              </p>
            )}
            <div className="inbox-dialog__actions">
              <Button onClick={close} type="button">
                {CANCEL}
              </Button>
              <Button onClick={() => void confirm()} reason={sending ? WORKING : undefined} tone="primary">
                {sending ? WORKING : asking.confirm}
              </Button>
            </div>
          </div>
        )}
      </ShellOverlay>
    </>
  );
}
