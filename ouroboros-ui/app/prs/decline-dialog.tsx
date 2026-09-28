"use client";

import { useId, useState, type FormEvent } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button, TextAreaField } from "@/app/ui";

import {
  APPROVAL_SENDING,
  DECLINE_CANCEL,
  DECLINE_LABEL,
  DECLINE_NEEDS_NOTE,
  DECLINE_NOTE_HINT,
  DECLINE_NOTE_LABEL,
  declineTitle,
} from "./gates";
import { type ApprovalOutcome, MAX_APPROVAL_NOTE_LENGTH } from "./outcomes";

/** What the dialog is told. */
export interface DeclineDialogProps {
  /** Whether it is open. */
  readonly open: boolean;
  /** Close it — Escape, the backdrop, the cancel, or a decline that landed. */
  readonly onClose: () => void;
  /** The host's number for the PR. */
  readonly number: number;
  /**
   * Send the decline with its note. A refusal comes back here as a value and the dialog stays
   * open to say so.
   */
  readonly onConfirm: (note: string) => Promise<ApprovalOutcome>;
}

/**
 * *Decline*'s dialog ([#365](https://github.com/NobuData/ouroboros/issues/365)).
 *
 * Declining turns human approval red, and a red gate says why — the service refuses a decline
 * without a note (`422 pr_decline_note_required`). So the note is asked for before anything is
 * sent: the button stays inert, with the reason, while it is empty. The note is sent trimmed.
 *
 * The modal contract — focus in, Tab kept inside, Escape and a press outside close, focus back to
 * the button that opened it — is the shell overlay's.
 *
 * @param props See {@link DeclineDialogProps}.
 * @returns The dialog while open, nothing otherwise.
 */
export function DeclineDialog({ open, onClose, number, onConfirm }: DeclineDialogProps) {
  const noteId = useId();
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const trimmed = note.trim();
  const reason = sending ? APPROVAL_SENDING : trimmed === "" ? DECLINE_NEEDS_NOTE : undefined;

  /** Close, leaving no note behind for the next opening. */
  function close(): void {
    setNote("");
    setRefusal(null);
    onClose();
  }

  /**
   * Send the decline — once, and only with a note.
   *
   * @param event The form's submission.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (trimmed === "" || sending) return;

    setSending(true);
    setRefusal(null);
    void onConfirm(trimmed).then((outcome) => {
      setSending(false);
      if (outcome.ok) {
        close();
        return;
      }
      setRefusal(outcome.reason);
    });
  }

  return (
    <ShellOverlay label={declineTitle(number)} onClose={close} open={open} role="dialog">
      <form className="prv-decline" noValidate onSubmit={submit}>
        <h2 className="shell-overlay__title">{declineTitle(number)}</h2>

        <TextAreaField
          hint={DECLINE_NOTE_HINT}
          id={noteId}
          label={DECLINE_NOTE_LABEL}
          maxLength={MAX_APPROVAL_NOTE_LENGTH}
          onChange={(event) => setNote(event.currentTarget.value)}
          required
          rows={4}
          value={note}
        />

        {refusal !== null && (
          <p className="prv-decline__error" role="alert">
            {refusal}
          </p>
        )}

        <div className="prv-decline__actions">
          <Button reason={reason} tone="danger" type="submit">
            {sending ? APPROVAL_SENDING : DECLINE_LABEL}
          </Button>
          <Button onClick={close} tone="ghost" type="button">
            {DECLINE_CANCEL}
          </Button>
        </div>
      </form>
    </ShellOverlay>
  );
}
