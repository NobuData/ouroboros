import type { ConsoleCommandRecord } from "@/app/api/console";

import {
  COMMAND_GONE_CODE,
  type ConsoleAnswer,
  type ConsoleToast,
  isConsoleRefusal,
  settledToast,
} from "./console";
import { readConsoleCommand } from "./console-actions";

/**
 * The commands whose results have not arrived yet, and the toasts they turn into (BZ.5,
 * [#539](https://github.com/NobuData/ouroboros/issues/539)).
 *
 * A command the dispatcher acknowledges with `async_pending` — a dry run, a slow queue —
 * answers at once and settles later. The palette that ran it is mounted only while it is open
 * (`app/shell/search-pill.tsx`), so the wait cannot be the palette's: it would end the moment
 * the reader pressed Escape, which is exactly when somebody who has just started a dry run
 * presses it. The wait is therefore held **here, at module scope**, and drawn by
 * `app/shell/console-toasts.tsx`, which the shell mounts once and whose unmount is what stops
 * every wait.
 *
 * The shape is the command registry's (`app/shell/command-registry.ts`): an external store
 * with a cached snapshot, subscribed to with `useSyncExternalStore`.
 *
 * ### Reader state, and why it may live at module scope here
 *
 * That file refuses to hold anything about the reader, because a module singleton on the
 * server is shared by every request. This one holds nothing *but* reader state, and is safe for
 * the opposite reason: it is written only from a key press in a browser. The server renders the
 * frozen empty list ({@link NO_TOASTS}) and never starts a wait.
 */

/** How long between one read of a pending command and the next. */
export const CONSOLE_WATCH_INTERVAL_MS = 3_000;

/** How long a command is waited for before the wait is given up, quietly. */
export const CONSOLE_WATCH_LIMIT_MS = 10 * 60 * 1_000;

/** How a pending command is read. The Server Action by default; a seam for the suite. */
export type ConsoleCommandReader = (id: string) => Promise<ConsoleAnswer<ConsoleCommandRecord>>;

/** No toasts, as one frozen array — what the server renders and the browser hydrates against. */
export const NO_TOASTS: readonly ConsoleToast[] = Object.freeze([]);

/** The toasts on screen, oldest first. */
let toasts: readonly ConsoleToast[] = NO_TOASTS;

/** Everyone waiting to hear that the toasts moved. */
const listeners = new Set<() => void>();

/** The waits in progress, by command id — each one's way of being stopped. */
const waits = new Map<string, () => void>();

/**
 * Replace the toasts and tell everyone waiting.
 *
 * @param next The toasts.
 * @returns Nothing.
 */
function publish(next: readonly ConsoleToast[]): void {
  toasts = next.length === 0 ? NO_TOASTS : Object.freeze([...next]);
  for (const listener of [...listeners]) listener();
}

/**
 * Wait for a command to settle, and raise a toast when it does.
 *
 * It is read every {@link CONSOLE_WATCH_INTERVAL_MS} until it is no longer `async_pending`. A
 * read that fails is not the command failing — the next one is tried — except for the one
 * refusal that will never change, a command that is not the caller's to read. After
 * {@link CONSOLE_WATCH_LIMIT_MS} the wait ends **without a toast**: the command is still
 * recorded and may yet finish, and a notice claiming it failed would be a guess.
 *
 * @param id The command, as the dispatcher named it.
 * @param read How to read it. Defaults to the Server Action.
 * @returns How to stop waiting. Watching a command that is already being watched changes
 *   nothing and answers the existing wait's.
 */
export function watchConsoleCommand(
  id: string,
  read: ConsoleCommandReader = readConsoleCommand,
): () => void {
  const waiting = waits.get(id);
  if (waiting !== undefined) return waiting;

  const deadline = Date.now() + CONSOLE_WATCH_LIMIT_MS;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const stop = (): void => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    // Identity, not id: a stale handle must not end a wait that was started again since.
    if (waits.get(id) === stop) waits.delete(id);
  };

  const schedule = (): void => {
    if (Date.now() + CONSOLE_WATCH_INTERVAL_MS > deadline) {
      stop();
      return;
    }

    timer = setTimeout(() => void ask(), CONSOLE_WATCH_INTERVAL_MS);
  };

  const ask = async (): Promise<void> => {
    let answer: ConsoleAnswer<ConsoleCommandRecord> | null;

    try {
      answer = await read(id);
    } catch {
      // The request itself did not arrive. Nothing was learned about the command.
      answer = null;
    }

    if (stopped) return;

    if (answer === null) {
      schedule();
      return;
    }

    if (isConsoleRefusal(answer)) {
      if (answer.code === COMMAND_GONE_CODE) stop();
      else schedule();
      return;
    }

    if (answer.outcome === "async_pending") {
      schedule();
      return;
    }

    stop();
    publish([...toasts.filter((toast) => toast.id !== answer.id), settledToast(answer)]);
  };

  waits.set(id, stop);
  schedule();

  return stop;
}

/**
 * Take a toast down.
 *
 * @param id The command it was about.
 * @returns Nothing. An id nothing is showing changes nothing.
 */
export function dismissConsoleToast(id: string): void {
  if (!toasts.some((toast) => toast.id === id)) return;

  publish(toasts.filter((toast) => toast.id !== id));
}

/**
 * Stop every wait — what the shell does when it unmounts.
 *
 * The toasts already raised are left: they are answers that arrived, and a shell that mounts
 * again (a route group changing under it) should still be showing them.
 *
 * @returns Nothing.
 */
export function stopConsoleWatches(): void {
  for (const stop of [...waits.values()]) stop();
}

/**
 * How many commands are being waited for.
 *
 * @returns The count — a test's way of seeing that a wait ended without a toast.
 */
export function consoleWatchCount(): number {
  return waits.size;
}

/**
 * The toasts on screen.
 *
 * @returns A frozen snapshot, oldest first, whose identity is stable until something changes —
 *   what `useSyncExternalStore` requires of it.
 */
export function consoleToasts(): readonly ConsoleToast[] {
  return toasts;
}

/**
 * Hear about changes to the toasts.
 *
 * @param listener Called after each change.
 * @returns The way to stop listening.
 */
export function subscribeConsoleToasts(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** Stop every wait and take every toast down — a test seam, so each case starts from nothing. */
export function resetConsoleWatch(): void {
  stopConsoleWatches();
  toasts = NO_TOASTS;
}
