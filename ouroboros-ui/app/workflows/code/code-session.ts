import { useSyncExternalStore } from "react";

import { type CodeSession, EMPTY_SESSION, parseSession } from "./code-tabs";

/**
 * Where the code view keeps its tabs and buffers (V.3,
 * [#171](https://github.com/NobuData/ouroboros/issues/171)) — **per workspace, per browser
 * session**.
 *
 * ### Why a store above the page, and why session storage
 *
 * Opening another workflow's file is a navigation: its route reads that file, and the `[slug]`
 * layout and everything under it mount afresh. React state would not survive that, and the ticket's
 * promise is that *an in-progress edit survives a detour to another workflow*. So a session lives
 * in a module-level store that outlives any one page, and is written through to `sessionStorage`,
 * so a reload keeps it too. Session storage rather than local storage, because the ticket scopes
 * tab state to the session, and because unsaved text is not something a browser should hold for
 * days.
 *
 * ### Storage is a convenience, never a dependency
 *
 * A private window, blocked site data or a full quota makes the storage calls throw. Every one is
 * guarded: the store starts empty when storage cannot be read, and keeps working in memory when it
 * cannot be written — the page is the same page, it just forgets on reload.
 *
 * ### One store per workspace
 *
 * The key carries the workspace's id, so switching workspace in the same tab never shows one
 * workspace's files in another's strip. On the server there is no session, so every call gets a
 * fresh store and nothing is cached across requests.
 */

/** The storage key's prefix; the workspace's id follows it. */
export const SESSION_KEY_PREFIX = "ouroboros:code-session:";

/** A session, and the three things a component needs of it. */
export interface CodeSessionStore {
  /** The session now. The same object until it changes. */
  get(): CodeSession;
  /** Replace the session with what `change` makes of it. A change returning its input is a no-op. */
  update(change: (current: CodeSession) => CodeSession): void;
  /** Be told after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/**
 * The browser's session storage, or `null` where there is none or it is refused.
 *
 * @returns The storage, or `null`.
 */
export function browserSessionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Make a store.
 *
 * @param key The storage key.
 * @param storage Where to persist — called on each use, because access itself can throw.
 *   Defaults to {@link browserSessionStorage}.
 * @returns A store that reads storage the first time it is asked for the session.
 */
export function createCodeSessionStore(
  key: string,
  storage: () => Storage | null = browserSessionStorage,
): CodeSessionStore {
  let current: CodeSession | null = null;
  const listeners = new Set<() => void>();

  /** The session storage holds, or an empty one when it cannot be read. */
  function load(): CodeSession {
    try {
      return parseSession(storage()?.getItem(key) ?? null);
    } catch {
      return EMPTY_SESSION;
    }
  }

  return {
    get() {
      current ??= load();
      return current;
    },

    update(change) {
      const before = current ?? load();
      const next = change(before);
      current = next;
      if (next === before) return;

      try {
        storage()?.setItem(key, JSON.stringify(next));
      } catch {
        // Full or refused: the session still holds in memory for this page's lifetime.
      }
      for (const listener of listeners) listener();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The browser's stores, by workspace — kept so a remounted page finds the session it left. */
const stores = new Map<string, CodeSessionStore>();

/**
 * The store for one workspace.
 *
 * @param scope The workspace's id.
 * @returns The same store on every call in the browser; a fresh, unpersisted-to-memory one on the
 *   server, where nothing may outlive a request.
 */
export function codeSessionStore(scope: string): CodeSessionStore {
  const key = `${SESSION_KEY_PREFIX}${scope}`;
  if (typeof window === "undefined") return createCodeSessionStore(key);

  let store = stores.get(key);
  if (store === undefined) {
    store = createCodeSessionStore(key);
    stores.set(key, store);
  }
  return store;
}

/**
 * Read a store's session in a component, re-rendering when it changes.
 *
 * @param store The store.
 * @param serverSession What the server renders, and what hydration starts from — so the first
 *   paint matches the server's markup, and the stored session follows immediately after.
 *   Must be the same object across renders.
 * @returns The session.
 */
export function useCodeSession(store: CodeSessionStore, serverSession: CodeSession): CodeSession {
  return useSyncExternalStore(store.subscribe, store.get, () => serverSession);
}
