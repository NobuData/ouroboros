"use client";

import { useRef } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import {
  CLOSE,
  KEEP,
  REMOVE_CONSEQUENCES,
  REMOVE_LEAD,
  lifecycleConfirm,
  lifecycleNote,
  lifecycleTitle,
} from "./lifecycle";
import type { RunnerRow } from "./runners";
import type { LifecyclePhase } from "./use-lifecycle";

/**
 * The confirmation a drain and a remove ask for, and where any refused lifecycle write is said
 * (AI.5, [#260](https://github.com/NobuData/ouroboros/issues/260)).
 *
 * The words are `app/farm/lifecycle.ts`'s and the state is `app/farm/use-lifecycle.ts`'s; this
 * draws them in the shell's one modal (`app/shell/overlay.tsx`).
 *
 * ### It names what will happen
 *
 * A drain's sentence names **the build that continues**. A removal lists its consequences —
 * the machine leaves the fleet and its counts, its certificate is revoked, its history stays,
 * the act is audited — rather than asking *are you sure*, which is a question that tells the
 * reader nothing they can decide on.
 *
 * ### The safe answer takes the focus
 *
 * `initialFocus` is the cancel button: a stray `Enter` on a dialog that has just appeared must
 * not be what retires a machine.
 *
 * ### It follows the live row
 *
 * The dialog is held by a runner's id and drawn from the row the current page has for it, the
 * way `app/farm/job-sheet.tsx` is — so the build a drain names is the one the machine is running
 * *now*, and a dialog about a machine that has left the fleet closes rather than confirming
 * something about nothing.
 *
 * @param props.phase Where the write stands.
 * @param props.row The row the phase's runner has on the current page, or `null`.
 * @param props.onConfirm Make the write.
 * @param props.onClose Dismiss. Ignored by the hook while a write is in flight.
 * @returns The dialog — unmounted while there is nothing to ask or report.
 */
export function LifecycleDialog({
  phase,
  row,
  onConfirm,
  onClose,
}: Readonly<{
  phase: LifecyclePhase;
  row: RunnerRow | null;
  onConfirm: (name: string) => void;
  onClose: () => void;
}>) {
  const keep = useRef<HTMLButtonElement>(null);

  // An undrain asks nothing, so its write has no dialog to be in flight in — only a refusal.
  const shown =
    phase.kind !== "closed" &&
    row !== null &&
    !(phase.kind === "working" && phase.action === "undrain")
      ? { phase, row }
      : null;

  const title = shown === null ? "" : lifecycleTitle(shown.phase.action, shown.row.name);

  return (
    <ShellOverlay initialFocus={keep} label={title} onClose={onClose} open={shown !== null}>
      {shown !== null && (
        <div className="farm-lifecycle">
          <h2 className="shell-overlay__title">{title}</h2>

          {shown.phase.kind === "failed" ? (
            <p className="farm-lifecycle__failure" role="alert">
              {shown.phase.reason}
            </p>
          ) : shown.phase.action === "remove" ? (
            <>
              <p className="shell-overlay__note">{REMOVE_LEAD}</p>
              <ul className="farm-lifecycle__consequences">
                {REMOVE_CONSEQUENCES.map((consequence) => (
                  <li key={consequence}>{consequence}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="shell-overlay__note">
              {lifecycleNote(shown.phase.action, {
                name: shown.row.name,
                job:
                  shown.row.jobNumber !== null && shown.row.jobNote !== null
                    ? `${shown.row.jobNumber} ${shown.row.jobNote}`
                    : null,
              })}
            </p>
          )}

          <div className="farm-lifecycle__actions">
            {/* A plain button rather than `Button`, which forwards no ref for `initialFocus`. */}
            <button className="shell-overlay__close" onClick={onClose} ref={keep} type="button">
              {shown.phase.kind === "failed" ? CLOSE : KEEP}
            </button>
            {shown.phase.kind !== "failed" && (
              <Button
                aria-busy={shown.phase.kind === "working" || undefined}
                onClick={() => onConfirm(shown.row.name)}
                tone={shown.phase.action === "remove" ? "danger" : "primary"}
              >
                {lifecycleConfirm(
                  shown.phase.action,
                  shown.row.name,
                  shown.phase.kind === "working",
                )}
              </Button>
            )}
          </div>
        </div>
      )}
    </ShellOverlay>
  );
}
