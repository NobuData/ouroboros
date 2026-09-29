"use client";

import { TextDialog, type TextDialogClasses, type TextDialogOutcome } from "@/app/prs/text-dialog";

import { MAX_NOTE_LENGTH } from "./mark-route";
import {
  WAIVE_CANCEL,
  WAIVE_CONFIRM,
  WAIVE_CONSEQUENCE,
  WAIVE_DEFERRED,
  WAIVE_NEEDS_REASON,
  WAIVE_REASON_HINT,
  WAIVE_REASON_LABEL,
  WAIVE_SENDING,
  WAIVE_TITLE,
} from "./mark-route-decision";

/** The dialog's parts, drawn from this page's sheet. */
const CLASSES: TextDialogClasses = {
  form: "tests-waive",
  lead: "tests-waive__lead",
  error: "tests-waive__error",
  actions: "tests-waive__actions",
};

/** What the dialog is told. */
export interface WaiveDialogProps {
  /** The failure being waived, as the card names it — or `null` while the dialog is closed. */
  readonly failure: string | null;
  /** Close it. */
  readonly onClose: () => void;
  /** Send the waiver with its reason, trimmed. A refusal is drawn in the dialog. */
  readonly onConfirm: (reason: string) => Promise<TextDialogOutcome>;
}

/**
 * *Waive & annotate PR*'s dialog ([#340](https://github.com/NobuData/ouroboros/issues/340)).
 *
 * A waiver lets a failure through, so the reason is asked for before anything is sent and the
 * service refuses one without it. **The dialog says plainly which half is deferred**: the waiver
 * is recorded now, and the PR is not annotated until the PR plane's activation
 * ([#344](https://github.com/NobuData/ouroboros/issues/344)).
 *
 * The dialog itself is the PR verification page's `TextDialog` — the required field, the single
 * send and the refusal drawn in place — and the modal contract is the shell overlay's: focus
 * moves in, Tab stays inside, Escape and a press outside close, and focus returns to the button
 * that opened it.
 *
 * @param props See {@link WaiveDialogProps}.
 * @returns The dialog while a failure is given, nothing otherwise.
 */
export function WaiveDialog({ failure, onClose, onConfirm }: WaiveDialogProps) {
  return (
    <TextDialog
      cancel={WAIVE_CANCEL}
      classes={CLASSES}
      confirm={WAIVE_CONFIRM}
      hint={WAIVE_REASON_HINT}
      label={WAIVE_REASON_LABEL}
      lead={
        <>
          <p className="tests-waive__failure">{failure}</p>
          <p className="tests-waive__note">{WAIVE_CONSEQUENCE}</p>
          <p className="tests-waive__note">{WAIVE_DEFERRED}</p>
        </>
      }
      maxLength={MAX_NOTE_LENGTH}
      needs={WAIVE_NEEDS_REASON}
      onClose={onClose}
      onConfirm={onConfirm}
      open={failure !== null}
      sending={WAIVE_SENDING}
      title={WAIVE_TITLE}
      tone="danger"
    />
  );
}
