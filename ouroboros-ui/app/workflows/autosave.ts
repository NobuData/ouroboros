/**
 * The draft's autosave, decided — S.6 ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * The canvas and the inspector edit a draft the page holds; this module decides when that draft is
 * worth writing, what the toolbar says about it, whether it diverges from the version in force, and
 * what the reload dialog tells a reader whose draft moved underneath them. The writing itself is
 * `use-autosave.ts`'s, and the call is `draft-actions.ts`'.
 *
 * Three rules, each a criterion the ticket names:
 *
 *   * **Nothing is silently overwritten.** Every save carries the etag of the draft it was edited from,
 *     and a stale one stops autosave and opens the reload dialog. There is no retry that sends `*`.
 *   * **A document equal to the one stored is not written.** Opening a workflow hands the editor's
 *     draft up once, and a move that lands where it started hands up a document that says the same
 *     thing — neither is an edit, and neither costs a request or a new etag.
 *   * **The head says when the draft is not the version in force** — `v14 · draft edits` — because a
 *     reader about to run a dry run or leave the page should know that what runs is not what they see.
 *
 * **Framework-free and pure**, like `view.ts`: no React, no `next/*`, no server-only client.
 */

import type { WorkflowDefinition } from "@/app/api/workflows";
import { relativeAgo } from "@/app/format";

/**
 * The code a `409` answers when the draft changed under this writer — a second tab, the code editor, or
 * a publish racing the draft. **Nothing was overwritten**; `details.current` is the etag the draft has
 * now and `details.editedIn` names the editor that changed it.
 *
 * Named here rather than beside the call in `app/api/workflows.ts`, because that module sits on the
 * server-only client and the Client Components that branch on this code cannot import a value from it.
 */
export const WORKFLOW_DRAFT_CONFLICT = "workflow_draft_conflict";

/**
 * How long the draft rests before it is written, in milliseconds.
 *
 * Long enough that dragging a stage about, or typing through a prompt and pressing Apply twice, is one
 * write rather than many; short enough that closing the tab a moment after an edit loses nothing — the
 * page also writes at once when it is hidden or left (`use-autosave.ts`).
 */
export const AUTOSAVE_DELAY_MS = 1200;

/**
 * Where the draft's save stands.
 *
 * - `idle` — nothing has been edited since the page was read.
 * - `pending` — an edit is waiting out {@link AUTOSAVE_DELAY_MS}.
 * - `saving` — a write is in flight.
 * - `saved` — the stored draft is the one on the screen.
 * - `conflict` — the draft changed elsewhere; autosave has stopped until the reader reloads.
 * - `failed` — the last write was refused for another reason; the next edit tries again.
 */
export type SaveState = "idle" | "pending" | "saving" | "saved" | "conflict" | "failed";

/** The save's state, and — for a failure — the service's reason. */
export interface SaveStatus {
  readonly state: SaveState;
  /** Why the last write failed, for `failed`; `null` otherwise. */
  readonly reason: string | null;
}

/** A status with nothing to report. */
export const IDLE: SaveStatus = { state: "idle", reason: null };

/** What the toolbar says while an edit waits to be written. */
export const PENDING_NOTE = "Edited — saving shortly.";

/** What the toolbar says while a write is in flight. */
export const SAVING_NOTE = "Saving…";

/** What the toolbar says once the stored draft is the one on the screen. */
export const SAVED_NOTE = "All changes saved.";

/** What the toolbar says once autosave has stopped for a conflict. */
export const CONFLICT_NOTE = "Autosave paused — this draft changed elsewhere. Reload to keep editing.";

/**
 * What the canvas's toolbar says about the draft.
 *
 * @param status Where the save stands.
 * @returns The sentence, or `null` when there is nothing to say — a draft nobody has edited.
 */
export function saveNote(status: SaveStatus): string | null {
  switch (status.state) {
    case "idle":
      return null;
    case "pending":
      return PENDING_NOTE;
    case "saving":
      return SAVING_NOTE;
    case "saved":
      return SAVED_NOTE;
    case "conflict":
      return CONFLICT_NOTE;
    case "failed":
      return `Not saved — ${status.reason ?? "the service refused the write"}. The next edit tries again.`;
  }
}

/**
 * A value with its object keys in a stable order, so two documents that say the same thing serialise
 * to the same string whatever order their keys were written in.
 *
 * @param value Anything JSON can hold.
 * @returns The value, with every object's keys sorted, recursively.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
  );
}

/**
 * Whether two documents say the same thing.
 *
 * Structural rather than by identity, because every edit produces a new object and an undo back to
 * the opening document produces one equal to it; key order is ignored, because the service stores
 * `jsonb`, which does not keep it.
 *
 * @param left One document, or `null`.
 * @param right The other, or `null`.
 * @returns `true` when both are `null`, or both are documents with the same content.
 */
export function sameDocument(left: WorkflowDefinition | null, right: WorkflowDefinition | null): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;

  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

/** The head's word for a draft that is not the version in force — the ticket's `v14 · draft edits`. */
export const DRAFT_EDITS = "draft edits";

/**
 * Whether the draft diverges from the version in force.
 *
 * @param draft The draft, as the page holds it.
 * @param published The version in force's document, or `null` for a workflow that has published
 *   nothing — which has no version to diverge from, and whose head already says *not published*.
 * @returns `true` when there is a version and the draft says something else.
 */
export function draftDiverges(draft: WorkflowDefinition, published: WorkflowDefinition | null): boolean {
  return published !== null && !sameDocument(draft, published);
}

/** Which editor last wrote a draft, as a `409`'s `details.editedIn` names it. */
export type DraftEditor = "visual" | "code" | null;

/** What a stale save was told, read out of the `409`'s details. */
export interface DraftConflict {
  /** The etag the draft has now — what a reload reads. `null` when the service did not know it. */
  readonly current: string | null;
  /** Which editor changed it, or `null` when the service could not say. */
  readonly editedIn: DraftEditor;
  /** When it was changed, ISO 8601, or `null`. */
  readonly updatedAt: string | null;
}

/**
 * Read a `workflow_draft_conflict`'s details.
 *
 * Defensive, because `details` is typed as an object and nothing more: a field that is absent or of
 * another type reads as unknown rather than throwing inside a dialog.
 *
 * @param details The refusal's `details`.
 * @returns The conflict.
 */
export function readConflict(details: unknown): DraftConflict {
  const record = typeof details === "object" && details !== null ? (details as Record<string, unknown>) : {};
  const editedIn = record.editedIn === "visual" || record.editedIn === "code" ? record.editedIn : null;

  return {
    current: typeof record.current === "string" ? record.current : null,
    editedIn,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
  };
}

/** The reload dialog's title. */
export const CONFLICT_TITLE = "This draft changed somewhere else";

/** The reload dialog's primary action. */
export const RELOAD_LABEL = "Reload the draft";

/** The reload dialog's other answer — keep looking at this copy, with autosave stopped. */
export const KEEP_LABEL = "Not now";

/**
 * What the reload dialog says happened.
 *
 * @param conflict The conflict, as the `409` described it.
 * @param now The instant to measure *when* from.
 * @returns The sentence: who changed it, when, that nothing was overwritten, and what Reload does.
 */
export function conflictBody(conflict: DraftConflict, now: Date): string {
  const where =
    conflict.editedIn === "code"
      ? "in the code editor"
      : conflict.editedIn === "visual"
        ? "in another visual editor — another tab, or another person"
        : "somewhere else";
  const when = conflict.updatedAt === null ? "" : ` ${relativeAgo(conflict.updatedAt, now)}`;

  return (
    `It was changed ${where}${when}, so your last edit was not saved and nothing was overwritten. ` +
    "Reload to open the draft as it is stored now; your unsaved edit is not kept."
  );
}
