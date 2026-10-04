"use client";

import { useId, useRef, useState } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import { CANCEL, type MembersWrite, WORKING } from "./view";

import "./members.css";

/** One confirmation's content. */
export interface Confirmation {
  /** The dialog's title. */
  readonly title: string;
  /** What will happen — said before it does. */
  readonly warning: string;
  /** The confirming button's label. */
  readonly confirm: string;
}

/** What {@link ConfirmDialog} takes. */
export interface ConfirmDialogProps {
  /** What to confirm, or `null` when closed. */
  readonly confirmation: Confirmation | null;
  /** Do it. A refusal keeps the dialog open with the service's sentence. */
  readonly onConfirm: () => Promise<MembersWrite<unknown>>;
  /** Close without doing it — and after it has been done. */
  readonly onClose: () => void;
}

/**
 * A destructive action's confirmation, for the service-account row's **Rotate** and **Revoke**
 * (BS.3, [#493](https://github.com/NobuData/ouroboros/issues/493)): the consequence stated before
 * the press, one confirming press behind a latch, and a refusal kept in the dialog.
 *
 * @param props See {@link ConfirmDialogProps}.
 * @returns The dialog.
 */
export function ConfirmDialog({ confirmation, onConfirm, onClose }: ConfirmDialogProps) {
  const described = useId();
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const sent = useRef(false);

  function close(): void {
    setRefusal(null);
    onClose();
  }

  async function confirm(): Promise<void> {
    if (sent.current) return;

    sent.current = true;
    setSending(true);
    setRefusal(null);

    try {
      const result = await onConfirm();
      if (!result.ok) setRefusal(result.reason);
    } finally {
      sent.current = false;
      setSending(false);
    }
  }

  return (
    <ShellOverlay
      describedBy={described}
      label={confirmation?.title ?? ""}
      onClose={close}
      open={confirmation !== null}
      role="alertdialog"
    >
      {confirmation !== null && (
        <div className="members-dialog">
          <h2 className="members-dialog__title">{confirmation.title}</h2>
          <p className="members-dialog__warning" id={described}>
            {confirmation.warning}
          </p>
          {refusal !== null && (
            <p className="members-dialog__refusal" role="alert">
              {refusal}
            </p>
          )}
          <div className="members-dialog__actions">
            <Button onClick={close} type="button">
              {CANCEL}
            </Button>
            <Button
              reason={sending ? WORKING : undefined}
              onClick={() => void confirm()}
              tone="danger"
            >
              {sending ? WORKING : confirmation.confirm}
            </Button>
          </div>
        </div>
      )}
    </ShellOverlay>
  );
}
