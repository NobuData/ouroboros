/**
 * The canvas's keyboard shortcuts, as decisions (S.5,
 * [#151](https://github.com/NobuData/ouroboros/issues/151)).
 *
 * Three questions a key press on the canvas is asked: is it **Undo** or **Redo**, is it **Delete**,
 * and is the reader typing — in which case it is none of them, because a Backspace in a field is a
 * deleted character and never a deleted stage, and a ⌘Z there is the field's own undo.
 *
 * **Framework-free**, in `app/shell/menu.ts`'s way: an event is read as the few fields the decision
 * needs, which a DOM `KeyboardEvent` and a React synthetic one both satisfy.
 */

/** The part of a key press these decisions read. */
export interface ShortcutEvent {
  /** Which key — `KeyboardEvent.key`. */
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** What a history shortcut asks for. */
export type HistoryAction = "undo" | "redo";

/**
 * Whether a key press is Undo or Redo.
 *
 * ⌘Z or Ctrl+Z undoes; ⇧⌘Z, Ctrl+Shift+Z and Ctrl+Y redo — the macOS pair and the Windows pair, both
 * accepted everywhere, because a reader's hands do not know which platform the server guessed. The
 * Option/Alt key takes the press out of the pattern, as it does in every editor.
 *
 * @param event The key press.
 * @returns `"undo"`, `"redo"`, or `null` for anything else.
 */
export function historyKey(event: ShortcutEvent): HistoryAction | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;

  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey) return "redo";

  return null;
}

/**
 * Whether a key press asks to delete the selection — Delete, or Backspace (which is the key a Mac
 * laptop labels *delete*), with no modifier held.
 *
 * @param event The key press.
 * @returns `true` for a plain Delete or Backspace.
 */
export function isDeleteKey(event: ShortcutEvent): boolean {
  return (event.key === "Delete" || event.key === "Backspace") && !event.metaKey && !event.ctrlKey && !event.altKey;
}

/**
 * Whether a key press lands where the reader is typing.
 *
 * @param target The event's target.
 * @returns `true` for a text input, a textarea, a select or an editable element.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target.isContentEditable === true ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}
