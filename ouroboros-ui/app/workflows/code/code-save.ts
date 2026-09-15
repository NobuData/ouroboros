/**
 * The code editor's save loop, decided — V.4 ([#172](https://github.com/NobuData/ouroboros/issues/172)).
 *
 * The writing is `use-code-save.ts`'s and the call is `code-actions.ts`'. This module decides what
 * each answer means, what the page says about it, and when a failed write is tried again. Three rules,
 * each a failure mode the ticket names:
 *
 *   * **A typo must not corrupt the draft (decision C4).** The service parses before it writes, and a
 *     file that does not read is a `422 workflow_code_invalid` that changes nothing. The text stays in
 *     the tab, the errors are drawn where they are, and the next edit tries again.
 *   * **A concurrent edit must not silently win or silently lose.** A `409 workflow_draft_conflict`
 *     stops the loop and asks: reload theirs, or keep mine. Nothing is ever sent with `*`.
 *   * **No keystroke is lost across the save.** The loop is serial, and what is typed while a write is
 *     in flight is written after it; a saved answer never replaces the editor's text.
 *
 * A write that failed for any other reason — offline, a service error — keeps the text, says why, and
 * is tried again on its own ({@link retryDelay}), as DASH-I.7's banner
 * ([#86](https://github.com/NobuData/ouroboros/issues/86)) retries a read.
 *
 * **Framework-free and pure**, like `code-view.ts`.
 */

import { relativeAgo } from "@/app/format";

import { type DraftConflict, PENDING_NOTE, SAVED_NOTE, SAVING_NOTE } from "../autosave";
import type { ChordEvent } from "./code-tabs";

/** The code a `422` answers for a file that does not read as its workflow — nothing was written. */
export const WORKFLOW_CODE_INVALID = "workflow_code_invalid";

/**
 * How long typing rests before the file is written, in milliseconds.
 *
 * Shorter than the canvas's `AUTOSAVE_DELAY_MS`: a pause in typing is a shorter thing than a pause in
 * dragging, and the answer to a typo is worth having while the line is still in mind.
 */
export const CODE_SAVE_DELAY_MS = 800;

/**
 * Where the file's save stands.
 *
 * - `idle` — nothing typed since the file was read.
 * - `pending` — an edit is waiting out {@link CODE_SAVE_DELAY_MS}.
 * - `saving` — a write is in flight.
 * - `saved` — the draft holds the text on the screen.
 * - `invalid` — the last write did not parse; the draft is unchanged and the text is kept.
 * - `conflict` — the draft changed elsewhere; the loop has stopped until the person chooses.
 * - `failed` — the last write did not arrive or was refused for another reason; it is tried again.
 */
export type CodeSaveState = "idle" | "pending" | "saving" | "saved" | "invalid" | "conflict" | "failed";

/** The save's state, and — for a failure — why. */
export interface CodeSaveStatus {
  readonly state: CodeSaveState;
  /** Why the last write failed, for `failed` — the real reason, in words; `null` otherwise. */
  readonly reason: string | null;
}

/** A status with nothing to report. */
export const CODE_SAVE_IDLE: CodeSaveStatus = { state: "idle", reason: null };

/* ------------------------------------------------------------------ what the pane says */

/** What the pane says before anything is typed — how saving works here. */
export const CODE_IDLE_NOTE = "Saves as you type.";

/** What the pane says while the file does not parse. */
export const CODE_INVALID_NOTE = "Not saved — this file does not parse yet. The draft is unchanged.";

/** What the pane says once the loop has stopped for a conflict. */
export const CODE_CONFLICT_NOTE = "Autosave paused — the draft changed in another editor.";

/** What the pane says while a kept text waits for the person's choice. */
export const CODE_DIVERGED_NOTE = "Autosave paused — choose between your text and the draft.";

/** What the pane says while a failed write waits to be tried again. */
export const CODE_FAILED_NOTE = "Not saved yet — your text is kept in this tab.";

/**
 * What the pane says about the file's save.
 *
 * @param status Where the save stands.
 * @param diverged Whether the tab holds text typed over a draft that has since moved, which nothing
 *   saves until the person chooses.
 * @returns The sentence.
 */
export function codeSaveNote(status: CodeSaveStatus, diverged: boolean): string {
  if (diverged) return CODE_DIVERGED_NOTE;

  switch (status.state) {
    case "idle":
      return CODE_IDLE_NOTE;
    case "pending":
      return PENDING_NOTE;
    case "saving":
      return SAVING_NOTE;
    case "saved":
      return SAVED_NOTE;
    case "invalid":
      return CODE_INVALID_NOTE;
    case "conflict":
      return CODE_CONFLICT_NOTE;
    case "failed":
      return CODE_FAILED_NOTE;
  }
}

/* ------------------------------------------------------------------ a failed write */

/** The banner's headline over a write that failed. */
export const SAVE_FAILED_HEADLINE = "Your code is not saved yet — it is kept in this tab and tried again.";

/** The reason for a write that could not be sent because the browser is offline. */
export const OFFLINE_REASON = "This browser is offline, so the save could not be sent.";

/** The reason for a write that was sent and never answered. */
export const UNREACHABLE_REASON = "The service could not be reached, so the save did not arrive.";

/**
 * Why a write failed, in words — the banner's reason.
 *
 * @param message The service's own sentence when it answered, or `null` when nothing came back.
 * @param online Whether the browser says it is online (`navigator.onLine`).
 * @returns {@link OFFLINE_REASON} when offline — the one reason the person can act on first — else the
 *   service's sentence, else {@link UNREACHABLE_REASON}.
 */
export function failureReason(message: string | null, online: boolean): string {
  if (!online) return OFFLINE_REASON;
  return message ?? UNREACHABLE_REASON;
}

/**
 * The refusals trying again cannot fix: the reader's role, a workflow that is gone, a file too large to
 * send, a malformed request. Anything else — a service error, an unreadable answer — may pass later.
 */
const FINAL_REFUSALS: ReadonlySet<string> = new Set([
  "forbidden",
  "unauthenticated",
  "organization_required",
  "tenant_not_found",
  "workflow_not_found",
  "payload_too_large",
  "validation_failed",
  "workflow_draft_etag_required",
]);

/**
 * Whether a failed write is worth trying again on its own.
 *
 * @param code The refusal's code, or `null` when nothing came back — the network, or the browser.
 * @returns `true` unless the refusal is one a retry cannot change.
 */
export function isRetryable(code: string | null): boolean {
  return code === null || !FINAL_REFUSALS.has(code);
}

/** The first retry's wait, in milliseconds. */
export const RETRY_BASE_MS = 2000;

/** The longest wait between retries, in milliseconds. */
export const RETRY_MAX_MS = 30_000;

/**
 * How long to wait before trying a failed write again: doubling from {@link RETRY_BASE_MS}, capped at
 * {@link RETRY_MAX_MS}, so an outage costs a request every half minute rather than every keystroke.
 *
 * @param attempt Which retry this is, from 1. Anything lower reads as the first.
 * @returns The wait.
 */
export function retryDelay(attempt: number): number {
  const step = Math.max(1, Math.floor(attempt));
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (step - 1));
}

/* ------------------------------------------------------------------ a conflict */

/** The conflict dialog's title. */
export const CODE_CONFLICT_TITLE = "The draft changed in another editor";

/** The answer that drops the tab's text and opens the draft as it is now. */
export const RELOAD_THEIRS_LABEL = "Reload theirs";

/** The answer that keeps the tab's text, beside what changed. */
export const KEEP_MINE_LABEL = "Keep mine";

/**
 * What the conflict dialog says happened — naming the other editor.
 *
 * @param conflict The conflict, as the `409` described it.
 * @param now The instant to measure *when* from.
 * @returns Who changed the draft, when, that nothing was overwritten, and what each answer does.
 */
export function codeConflictBody(conflict: DraftConflict, now: Date): string {
  const where =
    conflict.editedIn === "visual"
      ? "in the visual editor"
      : conflict.editedIn === "code"
        ? "in the code editor — another tab, or another person"
        : "somewhere else";
  const when = conflict.updatedAt === null ? "" : ` ${relativeAgo(conflict.updatedAt, now)}`;

  return (
    `The draft was changed ${where}${when}, so your last edit was not saved and nothing was overwritten. ` +
    "Reload theirs to open the draft as it is now and drop your text, or keep mine to hold your text in " +
    "this tab beside what changed."
  );
}

/** The title over a tab's text kept over a draft that has since moved. */
export const DIVERGED_TITLE = "Your text and the draft have diverged";

/**
 * What the diverged panel says.
 *
 * @param changed How many lines differ between the draft and the tab's text.
 * @returns The sentence.
 */
export function divergedNote(changed: number): string {
  const lines = changed === 1 ? "1 line differs" : `${changed} lines differ`;
  return `${lines} between the draft as it is now and your text. Nothing is saved until you choose.`;
}

/** The answer that writes the tab's text over the draft as it is now. */
export const SAVE_MINE_LABEL = "Save mine over theirs";

/** The summary that opens the diff. */
export const SHOW_DIFF_LABEL = "Show the difference";

/* ------------------------------------------------------------------ the keyboard */

/**
 * Whether a key press is the explicit save: **⌘S**, or **Ctrl+S** off a Mac.
 *
 * The physical key is read as well as the character, for the reason `isCloseTabKey` gives.
 *
 * @param event The key press.
 * @returns `true` for ⌘S or Ctrl+S with neither Alt nor Shift held.
 */
export function isSaveKey(event: ChordEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false;
  return event.code === "KeyS" || event.key.toLowerCase() === "s";
}
