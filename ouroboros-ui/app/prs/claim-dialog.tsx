"use client";

import { MAX_CLAIM_LENGTH } from "./outcomes";
import { TextDialog, type TextDialogOutcome } from "./text-dialog";

/** The dialog's title. */
export const CLAIM_TITLE = "Add a claim";

/** The claim field's label. */
export const CLAIM_LABEL = "What the ticket says the PR must do";

/** What the claim field says beneath it. */
export const CLAIM_HINT =
  "Required. One claim, in the ticket's words. It is recorded as manual and starts unverified.";

/** Why the dialog's button waits while the claim is empty. */
export const CLAIM_NEEDS_TEXT = "Write the claim.";

/** The dialog's button. */
export const CLAIM_CONFIRM = "Add claim";

/** The dialog's button, and its reason, while the claim is being sent. */
export const CLAIM_SENDING = "The claim is being added.";

/** The dialog's cancel. */
export const CLAIM_CANCEL = "Keep on this page";

/** What the dialog is told. */
export interface ClaimDialogProps {
  /** Whether it is open. */
  readonly open: boolean;
  /** Close it. */
  readonly onClose: () => void;
  /** Send the claim, trimmed. A refusal is drawn in the dialog. */
  readonly onConfirm: (claim: string) => Promise<TextDialogOutcome>;
}

/**
 * *Add claim*'s dialog ([#366](https://github.com/NobuData/ouroboros/issues/366)) — the MVP's
 * honest editorial step: where planning produced no acceptance criteria, a person writes them,
 * and the row says `manual`.
 *
 * @param props See {@link ClaimDialogProps}.
 * @returns The dialog while open, nothing otherwise.
 */
export function ClaimDialog({ open, onClose, onConfirm }: ClaimDialogProps) {
  return (
    <TextDialog
      cancel={CLAIM_CANCEL}
      confirm={CLAIM_CONFIRM}
      hint={CLAIM_HINT}
      label={CLAIM_LABEL}
      maxLength={MAX_CLAIM_LENGTH}
      needs={CLAIM_NEEDS_TEXT}
      onClose={onClose}
      onConfirm={onConfirm}
      open={open}
      sending={CLAIM_SENDING}
      title={CLAIM_TITLE}
    />
  );
}
