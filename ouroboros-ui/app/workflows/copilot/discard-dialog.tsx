"use client";

import { useState } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import { DISCARDING, DISCARD_CANCEL, DISCARD_CONFIRM, DISCARD_TITLE, discardBody } from "./copilot-view";

import "../workflows.css";

/** What the confirmation takes. */
export interface DiscardDialogProps {
  /** The workflow's name, which the prompt says stays. */
  readonly name: string;
  /** The version in force, or `null` — what the workflow returns to. */
  readonly currentVersion: number | null;
  /** Discard; resolves to the refusal to show, or `null` once it took. */
  readonly onConfirm: () => Promise<string | null>;
  /** Keep everything — Cancel, Escape, or a press outside the dialog. */
  readonly onCancel: () => void;
}

/**
 * The confirmation **Discard draft** asks for (CE.1,
 * [#565](https://github.com/NobuData/ouroboros/issues/565)), modelled on the canvas's delete
 * confirmation (`app/workflows/confirm-delete.tsx`) and drawn in its classes.
 *
 * Discarding is destructive to work and not to reasoning, and the prompt says both before the
 * press: the draft is thrown away for good, the workflow stays — on its published version, or
 * empty if it never had one — and **the conversation is kept, read-only**. Unlike a delete on the
 * canvas there is no Undo to promise, so the sentence does not promise one.
 *
 * A refusal stays in the dialog, in words (`copilot-view.ts`' `discardFailure`): a dry run still
 * running, or nothing left to discard. The shell's overlay owns the modal contract.
 *
 * Mounted only while open, so every opening starts with no stale refusal.
 *
 * @param props See {@link DiscardDialogProps}.
 * @returns The dialog.
 */
export function DiscardDialog({ name, currentVersion, onConfirm, onCancel }: DiscardDialogProps) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /** Discard, once. */
  async function confirm(): Promise<void> {
    if (pending) return;

    setPending(true);
    setFailure(null);
    try {
      setFailure(await onConfirm());
    } finally {
      setPending(false);
    }
  }

  return (
    <ShellOverlay label={DISCARD_TITLE} onClose={onCancel} open>
      <h2 className="shell-overlay__title">{DISCARD_TITLE}</h2>
      <p className="shell-overlay__note">{discardBody(name, currentVersion)}</p>

      {failure !== null && (
        <p className="studio-dialog__failure" role="alert">
          {failure}
        </p>
      )}
      {pending && (
        <p className="studio-dialog__state" role="status">
          {DISCARDING}
        </p>
      )}

      <div className="studio-confirm__actions">
        <Button onClick={() => void confirm()} reason={pending ? DISCARDING : undefined} tone="danger" type="button">
          {DISCARD_CONFIRM}
        </Button>
        <Button onClick={onCancel} tone="ghost" type="button">
          {DISCARD_CANCEL}
        </Button>
      </div>
    </ShellOverlay>
  );
}
