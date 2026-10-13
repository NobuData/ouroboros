import { safeStorage } from "@/app/browser";

/**
 * The lines each person ran from the in-app console, for ↑ and ↓ to recall (BZ.5,
 * [#539](https://github.com/NobuData/ouroboros/issues/539)).
 *
 * Kept in `localStorage`, **keyed by the person and the workspace together** — the issue's
 * "scoped to the session's member and org". Two people sharing a browser each recall their
 * own, and a line run in one workspace is not offered in another, where the loop it names does
 * not exist. The shape is the inbox's fold store's (`app/inbox/resolved-collapse.ts`): one
 * storage key, an object by owner, narrowed on the way in so a damaged value reads as nothing.
 *
 * Per browser rather than per account, for the reason that file gives. Nothing here is drawn —
 * the history is read by a key press and written by a command having run — so there is no
 * snapshot to hydrate against and no hook: the two functions the palette calls read storage
 * each time, which is also what makes a line run in another tab recallable in this one.
 *
 * **Framework-free**: no React, no `next/*`.
 */

/** Each owner's lines, newest first. */
export type ConsoleHistories = Readonly<Record<string, readonly string[]>>;

/** `localStorage` key holding the histories. Absent means nobody has run anything. */
export const CONSOLE_HISTORY_STORAGE_KEY = "ouro-console-history";

/** How many lines one owner keeps. */
export const CONSOLE_HISTORY_LIMIT = 50;

/** Nobody's history: what a storage with nothing usable in it reads as. */
const NO_HISTORIES: ConsoleHistories = Object.freeze({});

/** No lines, as one frozen array rather than a fresh one per read. */
const NO_LINES: readonly string[] = Object.freeze([]);

/**
 * Whose history a line belongs to.
 *
 * @param userId The person's `user.id`.
 * @param workspaceId The workspace the session acts in.
 * @returns The owner's key, or `null` when either is unknown — a session still loading, or one
 *   with no workspace — in which case nothing is recalled and nothing is kept.
 */
export function consoleHistoryKey(userId: string, workspaceId: string): string | null {
  return userId === "" || workspaceId === "" ? null : `${userId}/${workspaceId}`;
}

/**
 * Narrow an untrusted string to the stored histories.
 *
 * @param raw Straight out of `localStorage`.
 * @returns The histories; nobody's for a value that is absent, not JSON, or not an object. An
 *   owner whose value is not a list is dropped, and so is anything in a list that is not a
 *   non-empty string.
 */
export function parseConsoleHistories(raw: string | null | undefined): ConsoleHistories {
  if (raw == null || raw === "") return NO_HISTORIES;

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return NO_HISTORIES;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return NO_HISTORIES;

  const histories: Record<string, readonly string[]> = {};

  for (const [owner, lines] of Object.entries(parsed)) {
    if (owner === "" || !Array.isArray(lines)) continue;

    const kept = lines
      .filter((line): line is string => typeof line === "string" && line.trim() !== "")
      .slice(0, CONSOLE_HISTORY_LIMIT);

    if (kept.length > 0) histories[owner] = kept;
  }

  return histories;
}

/**
 * A history with one more line run.
 *
 * Newest first. **A line that repeats the one before it is not added again**, so running the
 * same command five times is one step back rather than five; an earlier occurrence further
 * down is left where it is, because the order things were run in is what the history is.
 *
 * @param lines The history, newest first.
 * @param line The line that ran, without the prefix.
 * @returns The new history, capped at {@link CONSOLE_HISTORY_LIMIT}. The same array when the
 *   line is empty or repeats the newest.
 */
export function pushConsoleLine(lines: readonly string[], line: string): readonly string[] {
  const ran = line.trim();

  if (ran === "" || lines[0] === ran) return lines;

  return [ran, ...lines].slice(0, CONSOLE_HISTORY_LIMIT);
}

/**
 * Read every owner's history.
 *
 * @param storage Where to read from.
 * @returns The histories, or nobody's when storage cannot be reached.
 */
function readConsoleHistories(storage: Storage | undefined): ConsoleHistories {
  try {
    return parseConsoleHistories(storage?.getItem(CONSOLE_HISTORY_STORAGE_KEY));
  } catch {
    return NO_HISTORIES;
  }
}

/**
 * One owner's history.
 *
 * @param userId The person's `user.id`.
 * @param workspaceId The workspace the session acts in.
 * @param storage Where to read from. Defaults to `window.localStorage`.
 * @returns Their lines, newest first — none for an unknown owner, a storage that cannot be
 *   reached, or a value that is not what this module wrote.
 */
export function readConsoleHistory(
  userId: string,
  workspaceId: string,
  storage: Storage | undefined = safeStorage(),
): readonly string[] {
  const key = consoleHistoryKey(userId, workspaceId);
  if (key === null) return NO_LINES;

  return readConsoleHistories(storage)[key] ?? NO_LINES;
}

/**
 * Remember a line that ran.
 *
 * @param userId The person's `user.id`.
 * @param workspaceId The workspace the session acts in.
 * @param line The line, without the prefix.
 * @param storage Where to write. Defaults to `window.localStorage`.
 * @returns Nothing. With no storage, an unknown owner, or a storage that refuses the write,
 *   nothing is kept — the line ran, and simply will not be recalled.
 */
export function recordConsoleLine(
  userId: string,
  workspaceId: string,
  line: string,
  storage: Storage | undefined = safeStorage(),
): void {
  const key = consoleHistoryKey(userId, workspaceId);
  if (key === null || storage === undefined) return;

  const histories = readConsoleHistories(storage);
  const before = histories[key] ?? NO_LINES;
  const after = pushConsoleLine(before, line);

  if (after === before) return;

  try {
    storage.setItem(CONSOLE_HISTORY_STORAGE_KEY, JSON.stringify({ ...histories, [key]: after }));
  } catch {
    /* private mode, or a full quota — the line just will not be recalled. */
  }
}

/**
 * Where ↑ and ↓ leave a walk through the history.
 *
 * `null` is *not walking*: the box holds what the reader typed. ↑ steps towards older lines and
 * stops at the oldest; ↓ steps towards newer ones and, past the newest, leaves the history
 * altogether.
 *
 * @param at Where the walk is — an index into the lines, newest first — or `null`.
 * @param step Which way the key pointed.
 * @param count How many lines there are.
 * @returns Where the walk is afterwards.
 */
export function historyStep(
  at: number | null,
  step: "older" | "newer",
  count: number,
): number | null {
  if (count === 0) return null;

  if (step === "older") return at === null ? 0 : Math.min(at + 1, count - 1);

  return at === null || at === 0 ? null : at - 1;
}
