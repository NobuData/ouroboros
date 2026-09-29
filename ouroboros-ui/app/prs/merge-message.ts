/**
 * The merge commit's message, its unsaved edit, and whether it still closes the ticket
 * ([#369](https://github.com/NobuData/ouroboros/issues/369)).
 *
 * **The message is the mechanism.** A git host closes a ticket on the merge message's closing
 * keyword — `Closes #482.` — and the executor has no other way to close one (#360). The card's
 * *close on merge* toggle only records the intent. So an edit that drops the keyword silently
 * breaks a toggle the reader left switched on, and {@link closeCheck} warns rather than letting
 * the two disagree in silence.
 *
 * The keyword rule is the service's own `CLOSING_KEYWORD`, so the card warns about exactly what the
 * merge would do. It is hedged — the PR's description can carry the keyword too, and this page
 * does not hold it.
 *
 * **An edit is a draft until it is saved** ({@link MessageDraft}). A read never touches it, and
 * nothing is armed or merged while one is open: the saved message is what merges, not the one on
 * screen.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

/** The message's name, while it can be edited. */
export const MESSAGE_LABEL = "Commit message";

/** The message's name, while it cannot — the mockup's. */
export const MESSAGE_PREVIEW_LABEL = "Commit message preview";

/** What the message field says beneath it. */
export const MESSAGE_HINT = "What the merge commit will say. Saved when you press Save message.";

/** The longest message — the service's `MAX_COMMIT_MESSAGE_LENGTH` (V058). */
export const MAX_COMMIT_MESSAGE_LENGTH = 16_384;

/** The draft's two buttons. */
export const SAVE_MESSAGE = "Save message";
export const DISCARD_MESSAGE = "Discard";

/** Why a blank message cannot be saved. */
export const MESSAGE_BLANK = "A merge commit needs a message.";

/** Why a message that is too long cannot be saved. */
export const MESSAGE_TOO_LONG =
  `A commit message is at most ${MAX_COMMIT_MESSAGE_LENGTH} characters.`;

/** What is said when the stored message moved under an unsaved draft. */
export const MESSAGE_MOVED =
  "The saved message changed while you were editing. Saving replaces it with what is here.";

/** Why arming waits while the message has unsaved edits — the stored one is what would merge. */
export const SAVE_FIRST =
  "Save or discard the message edit first — the saved message is what merges.";

/**
 * A closing keyword, then a same-repository or `owner/repo` reference — the service's own
 * `CLOSING_KEYWORD` (`ticket-source.pr.ts`), so the card warns about exactly what the merge
 * would do.
 */
const CLOSING_KEYWORD =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+((?:([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+))?#([1-9]\d{0,9}))\b/gi;

/** A ticket key a closing keyword can name — `#482`. */
const NUMBERED_KEY = /^#[1-9]\d{0,9}$/;

// --- the draft -----------------------------------------------------------------------------

/** An edit of the message that has not been saved. */
export interface MessageDraft {
  /** What is in the field. */
  readonly text: string;
  /** The stored message the edit began from. */
  readonly base: string;
}

/**
 * The draft after a keystroke.
 *
 * @param text What the field now holds.
 * @param stored The stored message.
 * @param current The draft before the keystroke, or `null`.
 * @returns The draft, keeping the message it began from — or `null` once the field says what is
 *   stored again, give or take the padding the service refuses anyway.
 */
export function draftOf(
  text: string,
  stored: string,
  current: MessageDraft | null,
): MessageDraft | null {
  if (text.trim() === stored.trim()) return null;

  return { text, base: current?.base ?? stored };
}

/**
 * Why a draft cannot be saved.
 *
 * @param draft The draft.
 * @returns The reason, or `null` for one that can.
 */
export function unsendable(draft: MessageDraft): string | null {
  const text = draft.text.trim();
  if (text === "") return MESSAGE_BLANK;

  return text.length > MAX_COMMIT_MESSAGE_LENGTH ? MESSAGE_TOO_LONG : null;
}

/** What the keyword check found. */
export type CloseCheck =
  /** Nothing to say: the toggle is off, there is no ticket, or the keyword is there. */
  | { readonly kind: "agrees" }
  /** The toggle is on and the message has no closing keyword for the ticket — the warning. */
  | { readonly kind: "missing"; readonly text: string }
  /** The toggle is on and no keyword could close this ticket on a git host. */
  | { readonly kind: "unclosable"; readonly text: string };

/**
 * Whether a message closes a ticket by keyword.
 *
 * @param message The merge message.
 * @param ticketKey The ticket's key — `#482`.
 * @returns `true` when a closing keyword names that ticket in the PR's own repository. `Closes
 *   #4821` does not close `#482`, and neither does `Closes acme/other#482`.
 */
export function closesTicket(message: string, ticketKey: string): boolean {
  const wanted = ticketKey.toLowerCase();

  for (const match of message.matchAll(CLOSING_KEYWORD)) {
    const [, reference, owner] = match;

    if (owner === undefined && reference.toLowerCase() === wanted) return true;
  }

  return false;
}

/**
 * Whether the close toggle and the message agree.
 *
 * @param message The message on screen — the draft while there is one.
 * @param ticketKey The ticket's key, or `null` for a PR without a ticket.
 * @param closeTicket Whether *close on merge* is on.
 * @returns The warning while the toggle is on and the message would leave the ticket open. It is
 *   hedged — the PR's description can carry the keyword too, and this page does not hold it — and
 *   a key no keyword can name (`PROJ-142`) says so instead, in the executor's own words.
 */
export function closeCheck(
  message: string,
  ticketKey: string | null,
  closeTicket: boolean,
): CloseCheck {
  if (!closeTicket || ticketKey === null) return { kind: "agrees" };

  if (!NUMBERED_KEY.test(ticketKey)) {
    return {
      kind: "unclosable",
      text: `${ticketKey} is not closed by a keyword on this host — close it in its tracker.`,
    };
  }

  if (closesTicket(message, ticketKey)) return { kind: "agrees" };

  return {
    kind: "missing",
    text:
      `This message has no closing keyword for ${ticketKey} — “Closes ${ticketKey}.” — so the ` +
      "merge leaves the issue open unless the PR's description carries one. Close on merge is " +
      "still switched on: the toggle and the message disagree.",
  };
}
