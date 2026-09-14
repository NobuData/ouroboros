"use client";

import type { WorkflowDefinition } from "@/app/api/workflows";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import { type Deletion, deletionSummary } from "./canvas/edit";
import { DELETE_CANCEL_LABEL, DELETE_CONFIRM_LABEL, deletePrompt } from "./canvas/view";

import "./workflows.css";

/** What the confirmation takes. */
export interface ConfirmDeleteProps {
  /** What is waiting to be deleted, or `null` when nothing is — which closes the dialog. */
  readonly deletion: Deletion | null;
  /** The draft, which the prompt names the stages and edges from. */
  readonly definition: WorkflowDefinition;
  /** Delete. */
  readonly onConfirm: () => void;
  /** Keep everything — Cancel, Escape, or a press outside the dialog. */
  readonly onCancel: () => void;
}

/**
 * The confirmation a delete asks for (S.5, [#151](https://github.com/NobuData/ouroboros/issues/151))
 * — from the Delete key over the canvas, **Delete stage** or **Delete edge** in the inspector.
 *
 * A delete is one key press away, and a stage takes every edge that touches it with it, so the dialog
 * names what goes — the stage, the edge, how many connected edges follow — and says Undo brings it
 * back (`view.ts`'s `deletePrompt`). It is the shell's overlay (`app/shell/overlay.tsx`), which owns
 * the modal contract: focus in, Tab kept inside, Escape and a press outside cancel, focus back out.
 *
 * @param props See {@link ConfirmDeleteProps}.
 * @returns The dialog while a deletion waits; nothing otherwise.
 */
export function ConfirmDelete({ deletion, definition, onConfirm, onCancel }: ConfirmDeleteProps) {
  const prompt = deletion === null ? null : deletePrompt(deletionSummary(definition, deletion));

  return (
    <ShellOverlay label={prompt?.title ?? DELETE_CONFIRM_LABEL} onClose={onCancel} open={prompt !== null}>
      {prompt !== null && (
        <>
          <h2 className="shell-overlay__title">{prompt.title}</h2>
          <p className="shell-overlay__note">{prompt.body}</p>

          <div className="studio-confirm__actions">
            <Button onClick={onConfirm} tone="danger" type="button">
              {DELETE_CONFIRM_LABEL}
            </Button>
            <Button onClick={onCancel} tone="ghost" type="button">
              {DELETE_CANCEL_LABEL}
            </Button>
          </div>
        </>
      )}
    </ShellOverlay>
  );
}
