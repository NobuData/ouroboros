"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { TicketSource, TicketSourceRemoval } from "@/app/api/sources";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import { readSourceRemoval, removeSource } from "./actions";
import {
  REMOVE_BLOCKED,
  REMOVE_CANCEL,
  REMOVE_CONFIRM,
  REMOVE_DIALOG_TITLE,
  REMOVE_INTRO,
  REMOVE_IRREVERSIBLE,
  REMOVE_KEPT,
  REMOVE_LABEL,
  REMOVE_READING,
  REMOVE_READ_ONLY,
  REMOVING,
  removalLines,
} from "./view";

import "./sources.css";

/**
 * The **Remove** control of a source's row, and the dialog that confirms it.
 *
 * Removing a source removes everything mirrored through it, so nothing is removed unseen: the
 * dialog first reads what would go — tickets, pull request records, draft batches — and only
 * then offers the control that does it. A source the service would refuse says why instead,
 * and offers no control at all.
 */

/** What the dialog is showing. */
type Drawn =
  /** The counts are being read. */
  | { readonly kind: "reading" }
  /** The counts could not be read, or the removal was refused: the sentence. */
  | { readonly kind: "refused"; readonly reason: string }
  /** The counts, and whether the removal would go through. */
  | { readonly kind: "counted"; readonly removal: TicketSourceRemoval };

/** What {@link RemoveSource} takes. */
export interface RemoveSourceProps {
  /** The source. */
  readonly source: TicketSource;
  /** Whether this reader may remove it. `false` renders the control inert, with the reason. */
  readonly mayAdminister: boolean;
}

/**
 * The control, and the dialog while it is open.
 *
 * @param props.source The source.
 * @param props.mayAdminister Whether the reader may remove it.
 * @returns The button and its dialog.
 */
export function RemoveSource({ source, mayAdminister }: RemoveSourceProps) {
  const router = useRouter();
  const [isOpen, setOpen] = useState(false);
  const [drawn, setDrawn] = useState<Drawn>({ kind: "reading" });
  const [removing, setRemoving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /** Open the dialog and read what a removal would take. */
  async function open(): Promise<void> {
    setOpen(true);
    setDrawn({ kind: "reading" });
    setFailure(null);

    const outcome = await readSourceRemoval(source.id);

    setDrawn(
      outcome.ok
        ? { kind: "counted", removal: outcome.removal }
        : { kind: "refused", reason: outcome.reason },
    );
  }

  /** Remove the source; on success the row is gone, so the page reads again. */
  async function remove(): Promise<void> {
    if (removing) return;

    setRemoving(true);
    setFailure(null);

    const outcome = await removeSource(source.id);

    setRemoving(false);

    if (!outcome.ok) {
      setFailure(outcome.reason);
      return;
    }

    setOpen(false);
    router.refresh();
  }

  const busy = removing ? REMOVING : undefined;

  return (
    <>
      <Button
        onClick={() => void open()}
        reason={mayAdminister ? undefined : REMOVE_READ_ONLY}
        size="sm"
        tone="ghost"
        type="button"
      >
        {REMOVE_LABEL}
      </Button>

      <ShellOverlay label={REMOVE_DIALOG_TITLE} onClose={() => setOpen(false)} open={isOpen}>
        <h2 className="shell-overlay__title">
          {REMOVE_DIALOG_TITLE} · {source.displayName}
        </h2>

        <div className="sources-remove">
          {drawn.kind === "reading" && (
            <p aria-busy className="sources-configure__note" role="status">
              {REMOVE_READING}
            </p>
          )}

          {drawn.kind === "refused" && (
            <p className="sources-add__failure" role="alert">
              {drawn.reason}
            </p>
          )}

          {drawn.kind === "counted" && (
            <>
              <p className="sources-remove__intro">{REMOVE_INTRO}</p>
              <ul className="sources-remove__list">
                {removalLines(drawn.removal).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="sources-configure__note">{REMOVE_KEPT}</p>
              {drawn.removal.removable ? (
                <p className="sources-remove__warning">{REMOVE_IRREVERSIBLE}</p>
              ) : (
                <p className="sources-add__failure" role="alert">
                  {REMOVE_BLOCKED}
                </p>
              )}
            </>
          )}

          {failure !== null && (
            <p className="sources-add__failure" role="alert">
              {failure}
            </p>
          )}

          <div className="sources-add__actions">
            {drawn.kind === "counted" && drawn.removal.removable && (
              <Button onClick={() => void remove()} reason={busy} tone="danger" type="button">
                {REMOVE_CONFIRM}
              </Button>
            )}
            <Button onClick={() => setOpen(false)} reason={busy} tone="ghost" type="button">
              {REMOVE_CANCEL}
            </Button>
          </div>
        </div>
      </ShellOverlay>
    </>
  );
}
