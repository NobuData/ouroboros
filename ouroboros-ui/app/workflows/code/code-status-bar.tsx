import {
  type CodeSync,
  type CursorPosition,
  STATUS_BAR_LABEL,
  SYNC_GLYPH,
  SYNC_WORDS,
  statusRight,
} from "./code-status";

import "./code-status-bar.css";

/**
 * Mockup 05's `.statusbar` — V.6 ([#174](https://github.com/NobuData/ouroboros/issues/174)): the strip under
 * the editor. Every word is `code-status.ts`' decision; this draws them.
 *
 * The sync word is a polite live region, so a screen reader hears *parse error* or *conflict* when the save
 * loop reaches it without being interrupted mid-line. The cursor is not: announcing every keystroke's column
 * would drown everything else out, and the editor already says where the caret is.
 */

/** What the strip takes. */
export interface CodeStatusBarProps {
  /** Where the file stands against the visual editor's draft. */
  readonly sync: CodeSync;
  /** `v15 draft`, or `v14 in force`. */
  readonly draft: string;
  /** The editor's cursor. */
  readonly cursor: CursorPosition;
}

/** Each sync state's modifier: the accent for synced, the status hues for the rest. */
const SYNC_CLASS: Readonly<Record<CodeSync, string>> = {
  synced: "code-status__sync code-status__sync--synced",
  saving: "code-status__sync",
  "parse-error": "code-status__sync code-status__sync--err",
  conflict: "code-status__sync code-status__sync--warn",
  unsaved: "code-status__sync code-status__sync--warn",
};

/**
 * The strip.
 *
 * @param props See {@link CodeStatusBarProps}.
 * @returns The strip.
 */
export function CodeStatusBar({ sync, draft, cursor }: CodeStatusBarProps) {
  return (
    <div aria-label={STATUS_BAR_LABEL} className="code-status" role="group">
      <span aria-live="polite" className={SYNC_CLASS[sync]}>
        {sync === "synced" && <span aria-hidden>{`${SYNC_GLYPH} `}</span>}
        {SYNC_WORDS[sync]}
      </span>
      <span className="code-status__draft">{draft}</span>
      <span className="code-status__right">{statusRight(cursor)}</span>
    </div>
  );
}
