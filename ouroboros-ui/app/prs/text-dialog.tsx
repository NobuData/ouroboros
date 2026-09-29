"use client";

import { type FormEvent, type ReactNode, useId, useState } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button, type ButtonTone, TextAreaField } from "@/app/ui";

/** What the dialog's confirmation answers: that it landed, or why it did not. */
export type TextDialogOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** The classes the dialog's parts are drawn with — a page's own, from its own sheet. */
export interface TextDialogClasses {
  /** The form. */
  readonly form: string;
  /** What is said above the field. */
  readonly lead: string;
  /** A refusal. */
  readonly error: string;
  /** The buttons' row. */
  readonly actions: string;
}

/** The PR verification page's classes (`prs.css`) — the default. */
const PR_CLASSES: TextDialogClasses = {
  form: "prv-dialog",
  lead: "prv-dialog__lead",
  error: "prv-dialog__error",
  actions: "prv-dialog__actions",
};

/** What the dialog is told. */
export interface TextDialogProps {
  /** Whether it is open. */
  readonly open: boolean;
  /** Close it — Escape, the backdrop, the cancel, or a confirmation that landed. */
  readonly onClose: () => void;
  /** The dialog's title, and its accessible name. */
  readonly title: string;
  /** What is said above the field — what the confirmation does — or nothing. */
  readonly lead?: ReactNode;
  /** The field's label. */
  readonly label: string;
  /** What the field says beneath it. */
  readonly hint: string;
  /** The most characters the text may have. */
  readonly maxLength: number;
  /** Why the button waits while the field is empty. */
  readonly needs: string;
  /** The button's label. */
  readonly confirm: string;
  /** The button's label, and its reason, while the text is being sent. */
  readonly sending: string;
  /** The cancel's label. */
  readonly cancel: string;
  /** The button's treatment. Defaults to `primary`. */
  readonly tone?: ButtonTone;
  /**
   * The classes its parts are drawn with, for a page other than the PR verification page
   * ([#340](https://github.com/NobuData/ouroboros/issues/340)) — a page loads its own sheet, not
   * this one's. Defaults to the PR page's.
   */
  readonly classes?: TextDialogClasses;
  /**
   * Send the text, trimmed. A refusal comes back here as a value and the dialog stays open to
   * say so.
   */
  readonly onConfirm: (text: string) => Promise<TextDialogOutcome>;
}

/**
 * A dialog that asks for one piece of required text before anything is sent
 * ([#366](https://github.com/NobuData/ouroboros/issues/366)) — a claim, or the reason for a
 * waiver.
 *
 * The button stays inert, with the reason, while the field is empty; the text is sent trimmed,
 * and once. A refusal is drawn in the dialog, which stays open with what was typed.
 *
 * The modal contract — focus in, Tab kept inside, Escape and a press outside close, focus back to
 * the button that opened it — is the shell overlay's.
 *
 * @param props See {@link TextDialogProps}.
 * @returns The dialog while open, nothing otherwise.
 */
export function TextDialog({
  open,
  onClose,
  title,
  lead,
  label,
  hint,
  maxLength,
  needs,
  confirm,
  sending,
  cancel,
  tone = "primary",
  classes = PR_CLASSES,
  onConfirm,
}: TextDialogProps) {
  const fieldId = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const trimmed = text.trim();
  const reason = busy ? sending : trimmed === "" ? needs : undefined;

  /** Close, leaving no text behind for the next opening. */
  function close(): void {
    setText("");
    setRefusal(null);
    onClose();
  }

  /**
   * Send the text — once, and only when there is some.
   *
   * @param event The form's submission.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (trimmed === "" || busy) return;

    setBusy(true);
    setRefusal(null);
    void onConfirm(trimmed).then((outcome) => {
      setBusy(false);
      if (outcome.ok) {
        close();
        return;
      }
      setRefusal(outcome.reason);
    });
  }

  return (
    <ShellOverlay label={title} onClose={close} open={open} role="dialog">
      <form className={classes.form} noValidate onSubmit={submit}>
        <h2 className="shell-overlay__title">{title}</h2>

        {lead !== undefined && <div className={classes.lead}>{lead}</div>}

        <TextAreaField
          hint={hint}
          id={fieldId}
          label={label}
          maxLength={maxLength}
          onChange={(event) => setText(event.currentTarget.value)}
          required
          rows={4}
          value={text}
        />

        {refusal !== null && (
          <p className={classes.error} role="alert">
            {refusal}
          </p>
        )}

        <div className={classes.actions}>
          <Button reason={reason} tone={tone} type="submit">
            {busy ? sending : confirm}
          </Button>
          <Button onClick={close} tone="ghost" type="button">
            {cancel}
          </Button>
        </div>
      </form>
    </ShellOverlay>
  );
}
