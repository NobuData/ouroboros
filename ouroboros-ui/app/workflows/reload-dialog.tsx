"use client";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import { CONFLICT_TITLE, type DraftConflict, KEEP_LABEL, RELOAD_LABEL, conflictBody } from "./autosave";

import "./workflows.css";

/** What the dialog takes. */
export interface ReloadDialogProps {
  /** What the stale save was told, or `null` when there is nothing to ask — which closes the dialog. */
  readonly conflict: DraftConflict | null;
  /** When the conflict was found — what *when* is measured from. */
  readonly at: Date;
  /** Reload the stored draft. */
  readonly onReload: () => void;
  /** Keep looking at this copy, with autosave stopped. */
  readonly onKeep: () => void;
}

/**
 * The reload dialog a stale autosave opens — S.6 ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * Two tabs open on one workflow is an ordinary accident, and last-write-wins would destroy the other
 * tab's work. So a save refused with `409` stops autosave and asks: this copy's last edit was **not**
 * saved and **nothing was overwritten**; reload to continue from the draft as it is stored. Declining
 * leaves the page readable and says on the toolbar that autosave is paused.
 *
 * @param props See {@link ReloadDialogProps}.
 * @returns The dialog while a conflict waits; nothing otherwise.
 */
export function ReloadDialog({ conflict, at, onReload, onKeep }: ReloadDialogProps) {
  return (
    <ShellOverlay label={CONFLICT_TITLE} onClose={onKeep} open={conflict !== null}>
      {conflict !== null && (
        <>
          <h2 className="shell-overlay__title">{CONFLICT_TITLE}</h2>
          <p className="shell-overlay__note">{conflictBody(conflict, at)}</p>

          <div className="studio-confirm__actions">
            <Button onClick={onReload} tone="primary" type="button">
              {RELOAD_LABEL}
            </Button>
            <Button onClick={onKeep} tone="ghost" type="button">
              {KEEP_LABEL}
            </Button>
          </div>
        </>
      )}
    </ShellOverlay>
  );
}
