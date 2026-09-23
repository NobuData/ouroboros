"use client";

import { useId, useRef, useState, type FormEvent } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button, TextField } from "@/app/ui";

import type { SubmitOutcome } from "./control-actions";
import {
  ABORTING,
  ABORT_CANCEL,
  ABORT_LOSES,
  ABORT_NEEDS_CONFIRMATION,
  abortConfirmLabel,
  abortFieldLabel,
  abortKeeps,
  abortTitle,
  confirmationMatches,
} from "./controls";

/** What the abort dialog is told. */
export interface AbortDialogProps {
  /** Whether it is open. */
  readonly open: boolean;
  /** Close it — Escape, the backdrop, *Keep running*, or a queued abort. */
  readonly onClose: () => void;
  /** The run's loop number — what has to be typed. */
  readonly loopSeq: number;
  /** The loop's branch, or `null` before it has one — named in the consequences. */
  readonly branch: string | null;
  /**
   * Send the abort with what was typed. The service re-checks it, so a refusal comes back
   * here as a value and the dialog stays open to say so.
   */
  readonly onConfirm: (typed: string) => Promise<SubmitOutcome>;
}

/**
 * *Abort run*'s danger dialog ([#310](https://github.com/NobuData/ouroboros/issues/310)).
 *
 * **It is deliberately not easy.** An abort destroys work in progress, so it sits behind the
 * loop number typed out, with the consequences stated first: what stops, what is lost, and
 * what is kept — the branch is preserved and the run is marked canceled. The button stays
 * inert (and says why) until the typed number matches, which is a courtesy: the service
 * re-checks the confirmation against the run and refuses a forged one, and that refusal is
 * drawn here rather than swallowed.
 *
 * **Announced as a danger action.** The panel is an `alertdialog` whose description is the
 * consequences, so a screen reader reads what will happen before anything else; focus opens
 * in the field, Tab is trapped in the panel and Escape closes it (`ShellOverlay`).
 *
 * @param props See {@link AbortDialogProps}.
 * @returns The dialog while open, nothing otherwise.
 */
export function AbortDialog({ open, onClose, loopSeq, branch, onConfirm }: AbortDialogProps) {
  const consequences = useId();
  const field = useId();
  const input = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const matches = confirmationMatches(typed, loopSeq);
  const reason = sending ? ABORTING : matches ? undefined : ABORT_NEEDS_CONFIRMATION;

  /** Close, leaving nothing typed behind for the next opening. */
  function close(): void {
    setTyped("");
    setRefusal(null);
    onClose();
  }

  /**
   * Send the abort — once, and only for the right number.
   *
   * @param event The form's submission: the button, or Enter in the field.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!matches || sending) return;

    setSending(true);
    setRefusal(null);
    void onConfirm(typed).then((outcome) => {
      setSending(false);
      if (outcome.ok) {
        close();
        return;
      }
      setRefusal(outcome.reason);
    });
  }

  return (
    <ShellOverlay
      describedBy={consequences}
      initialFocus={input}
      label={abortTitle(loopSeq)}
      onClose={close}
      open={open}
      role="alertdialog"
    >
      <form className="run-dialog" noValidate onSubmit={submit}>
        <h2 className="shell-overlay__title">{abortTitle(loopSeq)}</h2>
        <div className="run-dialog__consequences" id={consequences}>
          <p className="run-dialog__text">{ABORT_LOSES}</p>
          <p className="run-dialog__text">{abortKeeps(branch)}</p>
        </div>

        <TextField
          autoComplete="off"
          id={field}
          inputMode="numeric"
          label={abortFieldLabel(loopSeq)}
          mono
          onChange={(event) => setTyped(event.target.value)}
          ref={input}
          spellCheck={false}
          value={typed}
        />

        {refusal !== null && (
          <p className="run-dialog__error" role="alert">
            {refusal}
          </p>
        )}

        <div className="run-dialog__actions">
          <Button reason={reason} tone="danger" type="submit">
            {sending ? ABORTING : abortConfirmLabel(loopSeq)}
          </Button>
          <Button onClick={close} tone="ghost" type="button">
            {ABORT_CANCEL}
          </Button>
        </div>
      </form>
    </ShellOverlay>
  );
}
