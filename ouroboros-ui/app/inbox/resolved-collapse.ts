"use client";

import { useSyncExternalStore } from "react";

import { safeStorage } from "@/app/browser";

/**
 * Whether each reader keeps the resolved list folded (BO.3,
 * [#468](https://github.com/NobuData/ouroboros/issues/468)).
 *
 * The list is history: some readers want it open under the queue, some want the queue alone, and
 * neither wants to say so again on every visit. The choice is kept in `localStorage`, **keyed by
 * the person** — two people sharing a browser each keep their own — and read through
 * `useSyncExternalStore`, the same shape as the tenant chip's store (`app/shell/focus-repo.ts`).
 *
 * Per browser rather than per account, for the sidebar's reason (`app/shell/sidebar-state.ts`):
 * the account preference API holds the font scale and nothing else today, and when it grows this
 * becomes its mirror without changing what a reload shows.
 *
 * *Open* is stored as the **absence** of the reader's entry, so "nothing stored" and "chose
 * open" cannot drift apart, and the server render — which has no storage — is always open.
 */

/** The people who folded the list, by `user.id`. */
export type ResolvedCollapsed = Readonly<Record<string, true>>;

/** `localStorage` key holding the choices. Absent means nobody folded it. */
export const RESOLVED_COLLAPSE_STORAGE_KEY = "ouro-inbox-resolved-collapsed";

/** What the server renders, and so what the browser hydrates against: open for everyone. */
export const RESOLVED_COLLAPSE_SERVER_STATE: ResolvedCollapsed = Object.freeze({});

/** The state in the browser, read from storage the first time it is asked for. */
let state: ResolvedCollapsed | null = null;

/** Everyone waiting to hear that it moved. */
const listeners = new Set<() => void>();

/**
 * Narrow an untrusted string to the stored choices.
 *
 * @param raw Straight out of `localStorage`.
 * @returns The people who folded the list; nobody for a value that is absent, not JSON, or not
 *   an object of `true`s.
 */
export function parseResolvedCollapsed(raw: string | null | undefined): ResolvedCollapsed {
  if (raw == null || raw === "") return RESOLVED_COLLAPSE_SERVER_STATE;

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return RESOLVED_COLLAPSE_SERVER_STATE;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return RESOLVED_COLLAPSE_SERVER_STATE;
  }

  const folded: Record<string, true> = {};

  for (const [userId, value] of Object.entries(parsed)) {
    if (userId !== "" && value === true) folded[userId] = true;
  }

  return Object.freeze(folded);
}

/**
 * Read the persisted choices.
 *
 * @param storage Where to read from. Defaults to `window.localStorage`.
 * @returns The stored choices, or nobody when there are none or storage cannot be reached.
 */
export function readStoredResolvedCollapsed(storage: Storage | undefined = safeStorage()): ResolvedCollapsed {
  try {
    return parseResolvedCollapsed(storage?.getItem(RESOLVED_COLLAPSE_STORAGE_KEY));
  } catch {
    return RESOLVED_COLLAPSE_SERVER_STATE;
  }
}

/**
 * Persist the choices.
 *
 * @param folded The people who folded the list.
 * @param storage Where to write. Defaults to `window.localStorage`.
 * @returns Nothing. A storage that refuses the write is not an error a reader can act on: the
 *   choice applies to this visit and simply will not be remembered.
 */
export function storeResolvedCollapsed(folded: ResolvedCollapsed, storage: Storage | undefined = safeStorage()): void {
  try {
    if (Object.keys(folded).length === 0) storage?.removeItem(RESOLVED_COLLAPSE_STORAGE_KEY);
    else storage?.setItem(RESOLVED_COLLAPSE_STORAGE_KEY, JSON.stringify(folded));
  } catch {
    /* private mode, or a full quota — the choice just will not be remembered. */
  }
}

/**
 * The current choices, read from storage on first use.
 *
 * @returns The people who folded the list.
 */
export function resolvedCollapsedState(): ResolvedCollapsed {
  state ??= readStoredResolvedCollapsed();

  return state;
}

/**
 * Fold or open the list for one person, and remember it.
 *
 * @param userId The reader. An empty id — a reader the page could not name — changes nothing.
 * @param collapsed Whether the list is folded.
 */
export function setResolvedCollapsed(userId: string, collapsed: boolean): void {
  const current = resolvedCollapsedState();

  if (userId === "" || (current[userId] === true) === collapsed) return;

  const next: Record<string, true> = { ...current };

  if (collapsed) next[userId] = true;
  else delete next[userId];

  state = Object.freeze(next);
  storeResolvedCollapsed(state);

  for (const listener of [...listeners]) listener();
}

/**
 * Hear every change to the choices.
 *
 * @param listener Called after each change.
 * @returns How to stop listening.
 */
export function subscribeResolvedCollapsed(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether this reader keeps the list folded.
 *
 * @param userId The reader's `user.id`.
 * @returns `true` when they folded it. Always `false` on the server and on the hydration pass.
 */
export function useResolvedCollapsed(userId: string): boolean {
  const folded = useSyncExternalStore(
    subscribeResolvedCollapsed,
    resolvedCollapsedState,
    () => RESOLVED_COLLAPSE_SERVER_STATE,
  );

  return folded[userId] === true;
}

/** Forget what was read from storage — a test seam, so each case starts from its own storage. */
export function resetResolvedCollapsed(): void {
  state = null;
}
