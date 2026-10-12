import { useSyncExternalStore } from "react";

import { browserSessionStorage } from "../code/code-session";

/**
 * Where the conversation's composer keeps what has been typed and not sent (CE.2,
 * [#566](https://github.com/NobuData/ouroboros/issues/566)) — **per workflow, per browser
 * session**.
 *
 * Switching to the canvas to look at a stage and coming back is a navigation: the page mounts
 * afresh, and React state would take the half-written message with it. So the text lives in a
 * module-level store that outlives any one page and is written through to `sessionStorage`, so a
 * reload keeps it too — session storage for `app/workflows/code/code-session.ts`' reason: an
 * unsent message is not something a browser should hold for days.
 *
 * **Storage is a convenience, never a dependency.** Every call is guarded: a private window or a
 * full quota leaves the composer working in memory, and forgetting on reload.
 *
 * **The server renders an empty box.** There is no session there, so `useComposerDraft` hydrates
 * from `""` and the stored text follows immediately after — the first paint matches the server's
 * markup instead of mismatching it.
 */

/** The storage key's prefix; the workflow's id follows it. */
export const DRAFT_KEY_PREFIX = "ouroboros:copilot-draft:";

/** One workflow's unsent text. */
export interface ComposerDraftStore {
  /** The text now. */
  get(): string;
  /** Replace it. An empty string forgets the entry. */
  set(text: string): void;
  /** Be told after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/**
 * Make a store.
 *
 * @param key The storage key.
 * @param storage Where to persist — called on each use, because access itself can throw.
 * @returns A store that reads storage the first time it is asked for the text.
 */
export function createComposerDraftStore(
  key: string,
  storage: () => Storage | null = browserSessionStorage,
): ComposerDraftStore {
  let current: string | null = null;
  const listeners = new Set<() => void>();

  /** The text storage holds, or none when it cannot be read. */
  function load(): string {
    try {
      return storage()?.getItem(key) ?? "";
    } catch {
      return "";
    }
  }

  return {
    get() {
      current ??= load();
      return current;
    },

    set(text) {
      if (text === (current ?? load())) return;
      current = text;

      try {
        if (text === "") storage()?.removeItem(key);
        else storage()?.setItem(key, text);
      } catch {
        // Full or refused: the text still holds in memory for this page's lifetime.
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

/** The browser's stores, by workflow — kept so a remounted page finds the text it left. */
const stores = new Map<string, ComposerDraftStore>();

/**
 * The store for one workflow.
 *
 * @param workflowId The workflow's id.
 * @returns The same store on every call in the browser; a fresh one on the server, where nothing
 *   may outlive a request.
 */
export function composerDraftStore(workflowId: string): ComposerDraftStore {
  const key = `${DRAFT_KEY_PREFIX}${workflowId}`;
  if (typeof window === "undefined") return createComposerDraftStore(key);

  let store = stores.get(key);
  if (store === undefined) {
    store = createComposerDraftStore(key);
    stores.set(key, store);
  }
  return store;
}

/**
 * Forget every store — a test's reset, so one case's text is not the next one's.
 */
export function resetComposerDrafts(): void {
  stores.clear();
}

/** What the server renders, and what hydration starts from. */
const serverText = (): string => "";

/**
 * Read a store's text in a component, re-rendering when it changes.
 *
 * @param store The store.
 * @returns The text — empty for the server's render and the hydrating one.
 */
export function useComposerDraft(store: ComposerDraftStore): string {
  return useSyncExternalStore(store.subscribe, store.get, serverText);
}
