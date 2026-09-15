"use client";

import { useMemo } from "react";

import type { CodeDiagnostic } from "@/app/api/workflows";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, RetryBanner } from "@/app/ui";

import type { DraftConflict } from "../autosave";
import { DIAGNOSTICS_LABEL, JUMP_TITLE, diagnosticPlace, diagnosticsSummary } from "./code-diagnostics";
import { type DiffKind, changedLines, diffMarker, lineDiff } from "./code-diff";
import {
  CODE_CONFLICT_TITLE,
  DIVERGED_TITLE,
  KEEP_MINE_LABEL,
  RELOAD_THEIRS_LABEL,
  SAVE_FAILED_HEADLINE,
  SAVE_MINE_LABEL,
  SHOW_DIFF_LABEL,
  codeConflictBody,
  divergedNote,
} from "./code-save";

import "../workflows.css";
import "./code-save.css";

/**
 * What the code editor's save loop draws — V.4 ([#172](https://github.com/NobuData/ouroboros/issues/172)).
 * The decisions are `code-save.ts`', `code-diagnostics.ts`' and `code-diff.ts`'; the workbench places these.
 *
 * - {@link DiagnosticsStrip} — under a file that did not parse: the count, the first message, and the jump.
 * - {@link SaveFailedBanner} — over a write that did not arrive: DASH-I.7's retry banner
 *   ([#86](https://github.com/NobuData/ouroboros/issues/86)), with the real reason.
 * - {@link ConflictDialog} — a `409`: reload theirs, or keep mine, naming the editor that changed the draft.
 * - {@link DivergedPanel} — a kept text over a draft that moved: what differs, and the two ways on.
 */

/**
 * The diagnostics strip.
 *
 * A polite status region, so a screen reader hears that the file stopped saving without being interrupted
 * mid-line; the squiggles themselves are CodeMirror's, and hue is never the only signal — the count and
 * the message are words.
 *
 * @param props.items The diagnostics, in the service's order. The first is the one offered.
 * @param props.onReveal Jump to a diagnostic.
 * @returns The strip.
 */
export function DiagnosticsStrip({
  items,
  onReveal,
}: Readonly<{ items: readonly CodeDiagnostic[]; onReveal: (item: CodeDiagnostic) => void }>) {
  const first = items[0];

  return (
    <div aria-label={DIAGNOSTICS_LABEL} className="code-save__strip" role="status">
      <span className="code-save__count">{diagnosticsSummary(items)}</span>
      {first !== undefined && (
        <button className="code-save__jump" onClick={() => onReveal(first)} title={JUMP_TITLE} type="button">
          {diagnosticPlace(first.range)}: {first.message}
        </button>
      )}
    </div>
  );
}

/**
 * The banner over a write that failed.
 *
 * @param props.reason Why, in words.
 * @param props.retrying Whether a write is in flight — the control's label says so.
 * @param props.onRetry Try again now.
 * @returns The banner.
 */
export function SaveFailedBanner({
  reason,
  retrying,
  onRetry,
}: Readonly<{ reason: string; retrying: boolean; onRetry: () => void }>) {
  return <RetryBanner headline={SAVE_FAILED_HEADLINE} onRetry={onRetry} reason={reason} retrying={retrying} />;
}

/**
 * The conflict dialog.
 *
 * Escape and the backdrop keep mine: dismissing a question must never be the answer that drops text.
 *
 * @param props.conflict What the `409` said, or `null` for no dialog.
 * @param props.at When the conflict was found — what *when* is measured from.
 * @param props.onReloadTheirs Drop the tab's text and read the draft as it is now.
 * @param props.onKeepMine Keep the tab's text, and read the draft beside it.
 * @returns The dialog while a conflict waits; nothing otherwise.
 */
export function ConflictDialog({
  conflict,
  at,
  onReloadTheirs,
  onKeepMine,
}: Readonly<{
  conflict: DraftConflict | null;
  at: Date;
  onReloadTheirs: () => void;
  onKeepMine: () => void;
}>) {
  return (
    <ShellOverlay label={CODE_CONFLICT_TITLE} onClose={onKeepMine} open={conflict !== null}>
      {conflict !== null && (
        <>
          <h2 className="shell-overlay__title">{CODE_CONFLICT_TITLE}</h2>
          <p className="shell-overlay__note">{codeConflictBody(conflict, at)}</p>

          <div className="studio-confirm__actions">
            <Button onClick={onKeepMine} tone="primary" type="button">
              {KEEP_MINE_LABEL}
            </Button>
            <Button onClick={onReloadTheirs} tone="ghost" type="button">
              {RELOAD_THEIRS_LABEL}
            </Button>
          </div>
        </>
      )}
    </ShellOverlay>
  );
}

/** Each diff line's classes, by kind — spelled out, so the sheet's test can find every one. */
const LINE_CLASSES: Readonly<Record<DiffKind, string>> = {
  same: "code-save__line",
  removed: "code-save__line code-save__line--removed",
  added: "code-save__line code-save__line--added",
};

/**
 * The panel over a text kept beside a draft that moved.
 *
 * @param props.theirs The draft's file as it is read now.
 * @param props.mine The tab's text.
 * @param props.onSaveMine Write the tab's text over the draft as it is now.
 * @param props.onReloadTheirs Drop the tab's text.
 * @returns The panel.
 */
export function DivergedPanel({
  theirs,
  mine,
  onSaveMine,
  onReloadTheirs,
}: Readonly<{ theirs: string; mine: string; onSaveMine: () => void; onReloadTheirs: () => void }>) {
  const diff = useMemo(() => lineDiff(theirs, mine), [theirs, mine]);

  return (
    <section aria-label={DIVERGED_TITLE} className="code-save__diverged">
      <p className="code-save__title">{DIVERGED_TITLE}</p>
      <p className="code-save__note">{divergedNote(changedLines(diff))}</p>

      <details className="code-save__details">
        <summary className="code-save__summary">{SHOW_DIFF_LABEL}</summary>
        <pre className="code-save__diff">
          {diff.map((entry, index) => (
            // Position is identity here: the diff is recomputed whole, and two lines may say the same.
            <span className={LINE_CLASSES[entry.kind]} key={index}>
              {diffMarker(entry.kind)}
              {entry.text}
            </span>
          ))}
        </pre>
      </details>

      <div className="code-save__actions">
        <Button onClick={onSaveMine} size="sm" tone="primary" type="button">
          {SAVE_MINE_LABEL}
        </Button>
        <Button onClick={onReloadTheirs} size="sm" tone="ghost" type="button">
          {RELOAD_THEIRS_LABEL}
        </Button>
      </div>
    </section>
  );
}
