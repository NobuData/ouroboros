/**
 * What the first loop records **in this browser only** (BD.1,
 * [#396](https://github.com/NobuData/ouroboros/issues/396)):
 *
 * * **the review** — when the guided review was acknowledged. The merge-policy suggestion waits
 *   for it: it is never offered before the person has seen a loop finish and looked at its work.
 * * **the duration** — the first loop's time from start to its pull request, kept once. Nothing
 *   here is transmitted: opt-in aggregate telemetry (#400) owns consent, and until it exists the
 *   figure stays on this machine.
 *
 * Keyed by run, so each browser profile — each person — keeps its own. Storage that throws
 * (private windows, blocked site data) reads as nothing recorded and writes nothing.
 */

import { useCallback, useSyncExternalStore } from "react";

/** The storage the store reads — `localStorage` unless a test stands one in. */
export type FirstLoopStorage = Pick<Storage, "getItem" | "setItem">;

/** The keys, by run. */
export const reviewedKey = (runId: string): string => `ouro.first-loop.${runId}.reviewed-at`;
export const durationKey = (runId: string): string => `ouro.first-loop.${runId}.duration-seconds`;

/**
 * The browser's storage, or null when it cannot be had.
 *
 * @returns `localStorage`, or null.
 */
function browserStorage(): FirstLoopStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * When the guided review of a run was acknowledged here.
 *
 * @param runId The run.
 * @param storage The storage.
 * @returns The ISO instant, or null when it was not (or storage cannot be read).
 */
export function readReviewedAt(runId: string, storage: FirstLoopStorage | null = browserStorage()): string | null {
  try {
    const value = storage?.getItem(reviewedKey(runId)) ?? null;

    return value !== null && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Record that the guided review of a run was acknowledged.
 *
 * @param runId The run.
 * @param at The ISO instant.
 * @param storage The storage.
 */
export function recordReviewed(runId: string, at: string, storage: FirstLoopStorage | null = browserStorage()): void {
  try {
    storage?.setItem(reviewedKey(runId), at);
  } catch {
    // Nothing recorded: the suggestion simply waits for another acknowledgement.
  }
}

/**
 * Keep the first loop's duration — start to pull request — once. Never transmitted.
 *
 * @param runId The run.
 * @param startedAt The run's start (ISO).
 * @param openedAt The pull request's opening (ISO).
 * @param storage The storage.
 * @returns The seconds kept, or null when nothing was written (already kept, or no storage).
 */
export function recordDuration(
  runId: string,
  startedAt: string,
  openedAt: string,
  storage: FirstLoopStorage | null = browserStorage(),
): number | null {
  try {
    if (storage === null || storage.getItem(durationKey(runId)) !== null) return null;

    const seconds = Math.max(0, Math.round((Date.parse(openedAt) - Date.parse(startedAt)) / 1000));

    storage.setItem(durationKey(runId), String(seconds));

    return seconds;
  } catch {
    return null;
  }
}

/** Same-tab listeners — `storage` events reach only the other tabs. */
const listeners = new Set<() => void>();

/**
 * Listen for a change to what was recorded — here or in another tab.
 *
 * @param listener Called on any change.
 * @returns How to stop listening.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * When this browser acknowledged a run's guided review, as a React value — null on the server
 * and before anything is recorded — and the way to acknowledge it.
 *
 * @param runId The run, or null when there is none.
 * @param now The clock — `Date.now` unless a test binds one.
 * @returns The ISO instant (or null), and the acknowledgement.
 */
export function useReviewedAt(
  runId: string | null,
  now: () => number = Date.now,
): readonly [string | null, () => void] {
  const at = useSyncExternalStore(
    subscribe,
    () => (runId === null ? null : readReviewedAt(runId)),
    () => null,
  );
  const acknowledge = useCallback(() => {
    if (runId === null) return;
    recordReviewed(runId, new Date(now()).toISOString());
    for (const listener of listeners) listener();
  }, [runId, now]);

  return [at, acknowledge] as const;
}
