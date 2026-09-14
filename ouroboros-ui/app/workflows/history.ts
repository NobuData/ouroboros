/**
 * Undo and redo over the draft (S.5, [#151](https://github.com/NobuData/ouroboros/issues/151)) —
 * a bounded history of the documents the studio's edits produced.
 *
 * The draft is an immutable value: every edit (a move, an added stage, a connection, an Apply, a
 * delete, an auto-layout) hands back a new document and leaves the old one untouched, so the
 * history is a list of those values rather than a list of inverse operations. Undoing is showing
 * the previous value again; nothing has to know how to reverse an edit, and an edit added later
 * is undoable with no code of its own.
 *
 * **Bounded**, because a reader dragging a stage about for an hour would otherwise hold every
 * intermediate document in memory: {@link HISTORY_LIMIT} steps back, and the oldest is dropped
 * when a new one is recorded. **A new edit clears the redo list**, as every editor does — redoing
 * onto a document that has since changed would replay an edit onto a state it was not made in.
 *
 * **React-free** and generic: a history of anything, which is what makes it a unit test over
 * values.
 */

/** How many edits back the studio can undo. */
export const HISTORY_LIMIT = 50;

/** The present value, what came before it, and what an undo put aside. */
export interface History<T> {
  /** Older values, oldest first. */
  readonly past: readonly T[];
  /** The value in force. */
  readonly present: T;
  /** Values undone, the next redo first. */
  readonly future: readonly T[];
}

/**
 * A history holding one value and nothing to undo.
 *
 * @param present The starting value.
 * @returns The history.
 */
export function startHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/**
 * Record a new value.
 *
 * @param history The history.
 * @param next The new value. **The same value as the present records nothing**, so a callback that
 *   hands back the document unchanged (a move that landed where it started) does not add a step an
 *   undo would then appear to do nothing for.
 * @param limit How many past values to keep. Defaults to {@link HISTORY_LIMIT}.
 * @returns The history with `next` in force, the old present at the end of `past`, and no future.
 */
export function record<T>(history: History<T>, next: T, limit: number = HISTORY_LIMIT): History<T> {
  if (Object.is(next, history.present)) return history;

  const past = [...history.past, history.present];
  return { past: past.slice(Math.max(0, past.length - limit)), present: next, future: [] };
}

/**
 * Step back one value.
 *
 * @param history The history.
 * @returns The history with the previous value in force, or `history` itself when there is none.
 */
export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;

  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
  };
}

/**
 * Step forward one undone value.
 *
 * @param history The history.
 * @returns The history with the next value in force, or `history` itself when nothing was undone.
 */
export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;

  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
  };
}

/**
 * Whether there is anything to undo.
 *
 * @param history The history.
 * @returns `true` when a past value exists.
 */
export function canUndo(history: History<unknown>): boolean {
  return history.past.length > 0;
}

/**
 * Whether there is anything to redo.
 *
 * @param history The history.
 * @returns `true` when an undone value exists.
 */
export function canRedo(history: History<unknown>): boolean {
  return history.future.length > 0;
}
