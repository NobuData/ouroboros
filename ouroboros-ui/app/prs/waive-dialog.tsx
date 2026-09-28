"use client";

import { MAX_WAIVE_REASON_LENGTH } from "./outcomes";
import { TextDialog, type TextDialogOutcome } from "./text-dialog";

/** The dialog's title. */
export const WAIVE_TITLE = "Waive this claim";

/** What the dialog says a waiver does. */
export const WAIVE_CONSEQUENCE =
  "A waiver says plainly that this claim could not be verified here. The claim, the reason and " +
  "your name are posted as a comment on the PR, so a reviewer on the host sees it too.";

/** What the dialog says about a claim that is already waived. */
export const WAIVE_AGAIN_CONSEQUENCE =
  "This claim is already waived. Waiving again records a new waiver and updates the same comment " +
  "on the PR — no second comment is posted.";

/** The reason field's label. */
export const WAIVE_REASON_LABEL = "Why it cannot be verified here";

/** What the reason field says beneath it. */
export const WAIVE_REASON_HINT =
  "Required. Posted on the PR as written — “rig runs at 22°C only — thermal chamber not in bench”.";

/** Why the dialog's button waits while the reason is empty. */
export const WAIVE_NEEDS_REASON = "Write why the claim is waived.";

/** The dialog's button. */
export const WAIVE_CONFIRM = "Waive & annotate PR";

/** The dialog's button, and its reason, while the waiver is being sent. */
export const WAIVE_SENDING = "The waiver is being sent.";

/** The dialog's cancel. */
export const WAIVE_CANCEL = "Keep on this page";

/** What the dialog is told. */
export interface WaiveDialogProps {
  /** The claim being waived, or `null` while the dialog is closed. */
  readonly claim: string | null;
  /** Whether the claim is already waived. */
  readonly again: boolean;
  /** Close it. */
  readonly onClose: () => void;
  /** Send the waiver with its reason, trimmed. A refusal is drawn in the dialog. */
  readonly onConfirm: (reason: string) => Promise<TextDialogOutcome>;
}

/**
 * *Waive*'s dialog ([#366](https://github.com/NobuData/ouroboros/issues/366)).
 *
 * A waiver lets an unmet claim through, so it has to leave the building: the service refuses one
 * without a reason and posts it on the host PR (#359). The reason is asked for before anything is
 * sent, and the dialog says where it will be read.
 *
 * @param props See {@link WaiveDialogProps}.
 * @returns The dialog while a claim is given, nothing otherwise.
 */
export function WaiveDialog({ claim, again, onClose, onConfirm }: WaiveDialogProps) {
  return (
    <TextDialog
      cancel={WAIVE_CANCEL}
      confirm={WAIVE_CONFIRM}
      hint={WAIVE_REASON_HINT}
      label={WAIVE_REASON_LABEL}
      lead={
        <>
          <p className="prv-dialog__claim">{claim}</p>
          <p className="prv-dialog__note">{again ? WAIVE_AGAIN_CONSEQUENCE : WAIVE_CONSEQUENCE}</p>
        </>
      }
      maxLength={MAX_WAIVE_REASON_LENGTH}
      needs={WAIVE_NEEDS_REASON}
      onClose={onClose}
      onConfirm={onConfirm}
      open={claim !== null}
      sending={WAIVE_SENDING}
      title={WAIVE_TITLE}
      tone="danger"
    />
  );
}
