/**
 * The tab strip and each file's buffer, as decisions (V.3,
 * [#171](https://github.com/NobuData/ouroboros/issues/171)) — `docs/mockups/05-workflow-code.html`'s
 * `.tabs`, with its modified-dot.
 *
 * ### A session is tabs, the open one, and buffers
 *
 * A **tab** is a file's path. The **active** tab is the file in the pane, and is always one of the
 * tabs or nothing. A **buffer** is what a person typed into a file that the service has not yet
 * accepted: the text the editor holds (`text`), the text it was typed over (`base`), and the draft's
 * etag when that base was read or saved (`etag`). Every function here takes a session and returns the
 * next one — **the same object when nothing changed**, so a store that compares identities notifies
 * no one for a no-op.
 *
 * ### The modified-dot is the buffer, and nothing else
 *
 * A file carries the dot exactly while it has a buffer whose text differs from its base. So the
 * dot is set by the first edit that changes the text, and is gone the moment the text is the base
 * again — whether because the person typed it back, because a read of the file caught up with the
 * buffer ({@link adoptRead}), or because a save succeeded ({@link markSaved}, which the save loop
 * of V.4, [#172](https://github.com/NobuData/ouroboros/issues/172), calls).
 *
 * ### A save leaves a clean buffer, until a read catches up
 *
 * A successful save makes the saved text the base, and so clears the dot — but the page's read of
 * the file is still the older text until it reads again. So the buffer is kept **clean** (its text
 * is its base: no dot) to hold what the editor shows, and is retired by the next read. Dropping it
 * at the save would put the pre-save read back into the editor. A clean buffer over the page's own
 * read holds nothing the read does not, and is never kept.
 *
 * ### A buffer knows which draft it was typed over (V.4)
 *
 * The buffer outlives the page, and the draft can move while it is away — the visual editor, another
 * tab. Saving it then with the etag of a fresh read would write the person's text over a change they
 * never saw. So each buffer keeps the etag of its base, and a buffer whose text was typed over a draft
 * that is neither the one read now nor the same text is **diverged** ({@link isDiverged}): nothing saves
 * it until the person has chosen, with the difference in front of them — keep it over the draft as it is
 * now ({@link rebaseBuffer}), or drop it ({@link discardBuffer}).
 *
 * ### Closing a tab discards nothing
 *
 * A closed tab's buffer stays, and its dot comes back with it when the file is opened again. Closing
 * is not the moment to decide to lose text; dropping a buffer is always an explicit answer.
 *
 * **Framework-free and pure**, like `code-view.ts`: the store that holds a session for the length
 * of a browser session is `code-session.ts`.
 */

import { type ShortcutEvent, isDeleteKey } from "../canvas/keys";
import { isRecord } from "./code-view";

/** What a person typed into one file, over what. */
export interface FileBuffer {
  /** The text the edit started from — the file as it was read, or as it was last saved. */
  readonly base: string;
  /**
   * The text the editor holds now. Equal to `base` only for a clean buffer a save left behind (see
   * this module's header); the dot is `text !== base`.
   */
  readonly text: string;
  /**
   * The draft's etag when `base` was read or saved — the `If-Match` a save of `text` sends — or `null`
   * when it is not known, as for a buffer kept by a page from before V.4.
   */
  readonly etag: string | null;
}

/** The code view's tab state for one workspace, in one browser session. */
export interface CodeSession {
  /** The open files' paths, in the order they were opened. No path twice. */
  readonly tabs: readonly string[];
  /** The file in the pane — one of `tabs` — or `null`. */
  readonly active: string | null;
  /** Each file's unsaved text, by path. A file with no entry has nothing unsaved. */
  readonly buffers: Readonly<Record<string, FileBuffer>>;
}

/** No tabs, nothing open, nothing typed. */
export const EMPTY_SESSION: CodeSession = { tabs: [], active: null, buffers: {} };

/* ------------------------------------------------------------------ tabs */

/**
 * Give a file a tab without opening it — for a file about to be opened by a navigation, whose
 * route opens it on arrival.
 *
 * @param session The session.
 * @param path The file.
 * @returns The session with the tab at the end, or the same session when it already has one.
 */
export function addTab(session: CodeSession, path: string): CodeSession {
  return session.tabs.includes(path) ? session : { ...session, tabs: [...session.tabs, path] };
}

/**
 * Open a file: give it a tab when it has none, and put it in the pane.
 *
 * @param session The session.
 * @param path The file.
 * @returns The next session.
 */
export function openTab(session: CodeSession, path: string): CodeSession {
  const added = addTab(session, path);
  return added.active === path ? added : { ...added, active: path };
}

/**
 * What arriving on a code route does: the route's file is opened, because following a link to a
 * file is asking for it — or, for a route whose workflow does not exist, nothing is open.
 *
 * @param session The session.
 * @param path The route's file, or `null` when the rail does not hold the URL's workflow.
 * @returns The next session.
 */
export function arrive(session: CodeSession, path: string | null): CodeSession {
  if (path !== null) return openTab(session, path);
  return session.active === null ? session : { ...session, active: null };
}

/**
 * Close a tab.
 *
 * @param session The session.
 * @param path The file.
 * @returns The session without the tab. When it was the open one, the tab that took its place —
 *   the one to its right, else to its left — is open instead, or nothing when it was the last.
 *   The file's buffer is kept (see this module's header).
 */
export function closeTab(session: CodeSession, path: string): CodeSession {
  const index = session.tabs.indexOf(path);
  if (index < 0) return session;

  const tabs = session.tabs.filter((tab) => tab !== path);
  const active =
    session.active === path ? (tabs[index] ?? tabs[index - 1] ?? null) : session.active;

  return { ...session, tabs, active };
}

/**
 * Forget every file the project no longer has — a workflow archived since the tab was opened.
 *
 * @param session The session, perhaps restored from an earlier page.
 * @param known Every path the explorer serves now.
 * @returns The session with only known tabs and buffers; nothing is open when the open file went.
 */
export function retainPaths(session: CodeSession, known: ReadonlySet<string>): CodeSession {
  const tabs = session.tabs.filter((tab) => known.has(tab));
  const buffers = Object.entries(session.buffers).filter(([path]) => known.has(path));

  if (tabs.length === session.tabs.length && buffers.length === Object.keys(session.buffers).length) {
    return session;
  }

  return {
    tabs,
    active: session.active !== null && known.has(session.active) ? session.active : null,
    buffers: Object.fromEntries(buffers),
  };
}

/**
 * Which tab an arrow key moves the keyboard to, in the WAI-ARIA tabs pattern: Left and Right step
 * and wrap around, Home and End jump to the ends.
 *
 * @param event The key press. A press with a modifier held is not a move.
 * @param tabs The tabs, in order.
 * @param focused The tab the keyboard is on.
 * @returns The tab to move to, or `null` for any other press.
 */
export function tabKeyTarget(
  event: ShortcutEvent,
  tabs: readonly string[],
  focused: string,
): string | null {
  if (event.altKey || event.ctrlKey || event.metaKey || tabs.length === 0) return null;

  const index = Math.max(tabs.indexOf(focused), 0);
  switch (event.key) {
    case "ArrowRight":
      return tabs[(index + 1) % tabs.length] ?? null;
    case "ArrowLeft":
      return tabs[(index - 1 + tabs.length) % tabs.length] ?? null;
    case "Home":
      return tabs[0] ?? null;
    case "End":
      return tabs[tabs.length - 1] ?? null;
    default:
      return null;
  }
}

/**
 * Whether a key press closes the focused tab — Delete, or Backspace, with no modifier held.
 *
 * @param event The key press.
 * @returns `true` for a plain Delete or Backspace.
 */
export function isCloseFocusedTabKey(event: ShortcutEvent): boolean {
  return isDeleteKey(event);
}

/** A key press, with the physical key a layout-independent shortcut is read from. */
export interface ChordEvent extends ShortcutEvent {
  /** Which physical key — `KeyboardEvent.code`. */
  readonly code: string;
}

/**
 * Whether a key press closes the open tab from anywhere in the workbench: **Alt+W** (⌥W).
 *
 * ⌘W and Ctrl+W close the browser's own tab and no page can take them, so the editor's close is
 * one modifier over. The physical key is read as well as the character, because ⌥W on a Mac types
 * `∑` rather than `w`.
 *
 * @param event The key press.
 * @returns `true` for Alt+W with nothing else held.
 */
export function isCloseTabKey(event: ChordEvent): boolean {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  return event.code === "KeyW" || event.key.toLowerCase() === "w";
}

/* ------------------------------------------------------------------ buffers */

/**
 * A file's buffer.
 *
 * @param session The session.
 * @param path The file.
 * @returns The buffer, or `undefined` — read as an own property, so a path such as `constructor`
 *   restored from storage cannot reach the prototype.
 */
export function bufferOf(session: CodeSession, path: string): FileBuffer | undefined {
  return Object.hasOwn(session.buffers, path) ? session.buffers[path] : undefined;
}

/**
 * Set or drop one file's buffer.
 *
 * @param session The session.
 * @param path The file.
 * @param buffer The buffer, or `null` to drop it.
 * @returns The next session, or the same one when the buffer is unchanged.
 */
function withBuffer(session: CodeSession, path: string, buffer: FileBuffer | null): CodeSession {
  const current = bufferOf(session, path);

  if (buffer === null && current === undefined) return session;
  if (
    buffer !== null &&
    current?.base === buffer.base &&
    current.text === buffer.text &&
    current.etag === buffer.etag
  ) {
    return session;
  }

  const others = Object.entries(session.buffers).filter(([key]) => key !== path);
  const buffers = buffer === null ? others : [...others, [path, buffer] as const];

  return { ...session, buffers: Object.fromEntries(buffers) };
}

/**
 * Record an edit.
 *
 * @param session The session.
 * @param path The file.
 * @param read The file as the page read it — the base of a first edit. A later edit keeps the base
 *   its buffer already has, so a read that changed underneath an edit does not move the line the
 *   dot is measured from.
 * @param text The whole text the editor holds after the edit.
 * @param etag The etag a first edit's base was read under — the save loop's current one. A later edit
 *   keeps its buffer's, for the reason `read` gives.
 * @returns The session with the buffer. It carries no dot when the text is back to its base, and
 *   is dropped altogether when that base is the page's own read.
 */
export function editBuffer(
  session: CodeSession,
  path: string,
  read: string,
  text: string,
  etag: string | null,
): CodeSession {
  const current = bufferOf(session, path);
  const base = current?.base ?? read;
  const kept = current === undefined ? etag : current.etag;

  return withBuffer(session, path, text === base && base === read ? null : { base, text, etag: kept });
}

/**
 * Take a read of the file into account: retire a buffer the read has caught up with — its text is
 * what the file now reads as, as after a save made elsewhere — and a clean buffer, whose saved text
 * a fresh read supersedes.
 *
 * A read that differs from a buffer with unsaved text leaves it alone: the person's text is kept,
 * and whether it may be saved over that read is {@link isDiverged}'s question.
 *
 * @param session The session.
 * @param path The file.
 * @param read The file as the page read it.
 * @returns The next session.
 */
export function adoptRead(session: CodeSession, path: string, read: string): CodeSession {
  const buffer = bufferOf(session, path);
  if (buffer === undefined) return session;

  return buffer.text === read || buffer.text === buffer.base ? withBuffer(session, path, null) : session;
}

/**
 * Record a successful save — the call V.4's save loop makes when the service accepts a file.
 *
 * @param session The session.
 * @param path The file.
 * @param saved The text the service accepted — what was sent, not the canonical text it answered with,
 *   because the editor holds what was sent.
 * @param etag The draft's etag after the save — what the next save sends.
 * @returns The session with the buffer measured from the saved text. When the editor still holds
 *   exactly that text the buffer is clean — no dot — and keeps the saved text in the editor until
 *   the next read ({@link adoptRead}); when the person typed on while the save was in flight, the
 *   dot stays, truthfully.
 */
export function markSaved(session: CodeSession, path: string, saved: string, etag: string): CodeSession {
  const buffer = bufferOf(session, path);
  if (buffer === undefined) return session;

  return withBuffer(session, path, { base: saved, text: buffer.text, etag });
}

/**
 * Drop a file's buffer — *Reload theirs*, or a mode switch the person confirmed.
 *
 * @param session The session.
 * @param path The file.
 * @returns The session without the buffer, so the editor opens on the file as it is read.
 */
export function discardBuffer(session: CodeSession, path: string): CodeSession {
  return withBuffer(session, path, null);
}

/**
 * Keep a buffer's text over the draft as it is read now — *Save mine over theirs*.
 *
 * @param session The session.
 * @param path The file.
 * @param read The file as the page reads it now — the new base.
 * @param etag That read's etag — what the save of the kept text sends.
 * @returns The session with the buffer measured from the read, or without it when its text is the read.
 */
export function rebaseBuffer(session: CodeSession, path: string, read: string, etag: string): CodeSession {
  const buffer = bufferOf(session, path);
  if (buffer === undefined) return session;

  return withBuffer(session, path, buffer.text === read ? null : { base: read, text: buffer.text, etag });
}

/**
 * Whether a file's buffer was typed over a draft that has moved since — so that saving it would write
 * over a change the person never saw.
 *
 * Asked when a file is read, not while it is edited: between reads, the save loop's own saves move the
 * buffer's etag ahead of the page's read, which is not a move of the draft.
 *
 * @param session The session.
 * @param path The file.
 * @param read The file as the page read it.
 * @param etag That read's etag.
 * @returns `true` for a buffer with unsaved text whose base is neither the text read nor typed under the
 *   etag read. A base equal to the read is never diverged, whatever its etag: the person typed over
 *   exactly what the draft says now.
 */
export function isDiverged(session: CodeSession, path: string, read: string, etag: string): boolean {
  const buffer = bufferOf(session, path);

  return buffer !== undefined && buffer.text !== buffer.base && buffer.base !== read && buffer.etag !== etag;
}

/**
 * Whether a file carries the modified-dot.
 *
 * @param session The session.
 * @param path The file.
 * @returns `true` while it has a buffer that differs from its base.
 */
export function isModified(session: CodeSession, path: string): boolean {
  const buffer = bufferOf(session, path);
  return buffer !== undefined && buffer.text !== buffer.base;
}

/**
 * The text the editor opens a file on.
 *
 * @param session The session.
 * @param path The file.
 * @param read The file as the page read it.
 * @returns The buffer's text when there is one, so an edit survives a detour; else `read`.
 */
export function bufferText(session: CodeSession, path: string, read: string): string {
  return bufferOf(session, path)?.text ?? read;
}

/* ------------------------------------------------------------------ storage */

/**
 * Read a session back from storage.
 *
 * **Defensive on purpose**: storage is written by an earlier page of this app, but it is still
 * input — another version of the app, a hand edit, a truncated write. Anything that is not a
 * session in every field is dropped rather than half-trusted.
 *
 * @param raw What storage held, or `null`.
 * @returns The session it describes, with a duplicate tab, an active path that is not a tab and
 *   a malformed or unmodified buffer each dropped, and an etag that is not a string read as unknown;
 *   {@link EMPTY_SESSION} for anything unreadable.
 */
export function parseSession(raw: string | null): CodeSession {
  if (raw === null) return EMPTY_SESSION;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY_SESSION;
  }
  if (!isRecord(value)) return EMPTY_SESSION;

  const tabs = Array.isArray(value.tabs)
    ? [...new Set(value.tabs.filter((tab): tab is string => typeof tab === "string"))]
    : [];
  const active = typeof value.active === "string" && tabs.includes(value.active) ? value.active : null;
  const buffers = isRecord(value.buffers)
    ? Object.entries(value.buffers).flatMap(([path, buffer]) =>
        isRecord(buffer) &&
        typeof buffer.base === "string" &&
        typeof buffer.text === "string" &&
        buffer.base !== buffer.text
          ? [
              [
                path,
                {
                  base: buffer.base,
                  text: buffer.text,
                  etag: typeof buffer.etag === "string" ? buffer.etag : null,
                },
              ] as const,
            ]
          : [],
      )
    : [];

  return { tabs, active, buffers: Object.fromEntries(buffers) };
}
