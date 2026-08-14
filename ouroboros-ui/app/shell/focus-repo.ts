"use client";

import { useSyncExternalStore } from "react";

import { safeStorage } from "@/app/browser";

/**
 * The focus repository: which one of the workspace's repositories the product is currently
 * looking at ([#77](https://github.com/NobuData/ouroboros/issues/77)).
 *
 * It is **a filter preference, not authorization**. Nothing is hidden by choosing one — the
 * workspace scope is the session's active organization and the service enforces it
 * (`app/api/access.ts`) — so this narrows what a screen *asks for*, and the honest place for
 * a value like that is the browser it was chosen in. That is what the issue means by "a
 * client-side filter preference persisted per organization".
 *
 * ### Per organization, because a repository belongs to one
 *
 * The store is a map keyed by the BetterAuth organization id, so moving between workspaces
 * moves between focus repositories rather than carrying one into a workspace it does not
 * exist in — and coming back finds the one that was left there. Absence is the default and
 * the default is *all repositories*: {@link focusRepoIn} answers `null`, and a `null` filter
 * is the unfiltered listing at every read that takes one.
 *
 * ### The name is stored beside the id, and both are needed
 *
 * The **id** is `github_repos.id`, which is what `GET /api/v1/runs` and `GET /api/v1/queue`
 * take as their `repo` parameter — the contract says so and names this issue while saying it
 * ("the id rather than the name, because a name is unique only within its GitHub
 * organisation"). The **name** is what the chip paints. Storing only the id would mean the
 * header could not draw itself without first listing every repository in the workspace, on
 * every page load, to turn one uuid into one word; storing only the name would mean the
 * preference could not be sent anywhere. So both travel, and the listing — read when the
 * menu is opened — is what corrects a stored pair that no longer describes anything
 * (`app/shell/tenant-chip.tsx`).
 *
 * ### Why `localStorage` rather than the preferences API
 *
 * `app/api/preferences.ts` is the account's durable surface and it is the right home for
 * something like the font scale, which follows a person between devices. A focus repository
 * does not: it is where *this* browser is looking, it changes several times an hour, and
 * writing it through would be a round trip per press for a value the server does not read.
 * `app/shell/sidebar-state.ts` settles the same question the same way for the sidebar's
 * width, and § 4 of `docs/DESIGN_SYSTEM_APP_SHELL.md` is the rule both follow.
 *
 * Unlike that module this one holds its React hook, because there is nothing to hold React
 * out for: the sidebar's width is stamped by an inline `<head>` script, which cannot import
 * a module that imports React, and there is no such script here — the chip paints in the
 * first render like everything else in the header.
 */

/** The one repository a workspace is focused on. */
export interface FocusRepo {
  /**
   * `github_repos.id`. The `repo` query parameter G.2 and G.4 accept, and the only part of
   * this that is ever sent anywhere.
   */
  readonly id: string;
  /** Its name within its GitHub organisation — what the chip draws. */
  readonly name: string;
}

/** Every workspace's choice, by BetterAuth organization id. */
export type FocusRepoChoices = Readonly<Record<string, FocusRepo>>;

/** `localStorage` key holding the map. Absent means *no workspace has a choice*. */
export const FOCUS_REPO_STORAGE_KEY = "ouro-focus-repo";

/** What the chip and the menu call the absence of a choice. */
export const ALL_REPOS_LABEL = "All repos";

/**
 * What the server renders, and therefore what the browser hydrates against.
 *
 * No choices at all: the server has no storage to read one from, and guessing is a hydration
 * mismatch. The correction lands in the same pass — `app/shell/client-value.ts` sets out why
 * that is `useSyncExternalStore` rather than an effect that calls `setState`.
 */
export const FOCUS_REPO_SERVER_STATE: FocusRepoChoices = Object.freeze({});

/** The choices in this browser, read from storage the first time they are asked for. */
let state: FocusRepoChoices | null = null;

/** Everyone waiting to hear that a choice moved. */
const listeners = new Set<() => void>();

/**
 * Read an untrusted string as a map of choices.
 *
 * Every entry is checked rather than the whole value cast, because this string is whatever
 * is in a browser's storage: written by an older version of this application, edited by
 * hand, or truncated by a quota. An entry that is not a repository is dropped and the rest
 * are kept — the alternative is one bad key costing every workspace its choice.
 *
 * @param raw The stored JSON, or `null` when there is none.
 * @returns The choices it names, frozen. `{}` for anything unreadable.
 */
export function parseFocusRepos(raw: string | null | undefined): FocusRepoChoices {
  if (raw == null || raw === "") return FOCUS_REPO_SERVER_STATE;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return FOCUS_REPO_SERVER_STATE;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return FOCUS_REPO_SERVER_STATE;
  }

  const choices: Record<string, FocusRepo> = {};

  for (const [organizationId, value] of Object.entries(parsed)) {
    if (organizationId === "") continue;
    if (typeof value !== "object" || value === null) continue;

    const { id, name } = value as Partial<FocusRepo>;
    if (typeof id !== "string" || id === "") continue;
    if (typeof name !== "string" || name === "") continue;

    choices[organizationId] = Object.freeze({ id, name });
  }

  return Object.freeze(choices);
}

/**
 * Read the persisted choices.
 *
 * @param storage Where to read from. Defaults to `window.localStorage`.
 * @returns The stored choices, or none when there are none or storage cannot be reached.
 */
export function readStoredFocusRepos(
  storage: Storage | undefined = safeStorage(),
): FocusRepoChoices {
  try {
    return parseFocusRepos(storage?.getItem(FOCUS_REPO_STORAGE_KEY));
  } catch {
    return FOCUS_REPO_SERVER_STATE;
  }
}

/**
 * Persist the choices, so they survive the session.
 *
 * An empty map is stored as the **absence** of the key rather than as `{}`, so "nothing
 * chosen" has one spelling in storage and a browser that has never chosen looks the same as
 * one that has chosen and gone back to all repositories.
 *
 * @param choices What to store.
 * @param storage Where to write. Defaults to `window.localStorage`.
 * @returns Nothing. A storage that refuses the write is not an error a reader can act on —
 *   the choice applies to this session and simply will not be remembered, which is
 *   `storeSidebarChoice`'s posture and `saveFontScale`'s.
 */
export function storeFocusRepos(
  choices: FocusRepoChoices,
  storage: Storage | undefined = safeStorage(),
): void {
  try {
    if (Object.keys(choices).length === 0) storage?.removeItem(FOCUS_REPO_STORAGE_KEY);
    else storage?.setItem(FOCUS_REPO_STORAGE_KEY, JSON.stringify(choices));
  } catch {
    /* private mode, or a full quota — the choice just will not be remembered. */
  }
}

/**
 * The choices as they stand.
 *
 * @returns A frozen snapshot whose identity is **stable until something changes**, which is
 *   what `useSyncExternalStore` requires of a client snapshot. The first call in the browser
 *   reads storage; the server never reaches this, because {@link FOCUS_REPO_SERVER_STATE} is
 *   what it renders from.
 */
export function focusRepoState(): FocusRepoChoices {
  state ??= readStoredFocusRepos();

  return state;
}

/**
 * One workspace's choice.
 *
 * @param choices The map — {@link focusRepoState}'s snapshot.
 * @param organizationId The workspace, or `undefined` while the session has not said which
 *   one it is acting in.
 * @returns The repository it is focused on, or `null` for *all repositories* — which is the
 *   answer for a workspace that has never chosen and for a session that names none.
 */
export function focusRepoIn(
  choices: FocusRepoChoices,
  organizationId: string | undefined,
): FocusRepo | null {
  if (organizationId === undefined) return null;

  return choices[organizationId] ?? null;
}

/**
 * Focus one repository in a workspace, or go back to all of them.
 *
 * @param organizationId The workspace the choice belongs to.
 * @param repo The repository to focus, or `null` for all of them — which **removes** the
 *   entry rather than storing a marker, so the default has one representation.
 * @returns Nothing. Persisted and published in the same call, so the key the next load boots
 *   from and the value this page is drawing cannot come apart.
 */
export function setFocusRepo(organizationId: string, repo: FocusRepo | null): void {
  const current = focusRepoState();
  const held = current[organizationId] ?? null;

  if (held?.id === (repo?.id ?? null)) return;

  const next: Record<string, FocusRepo> = { ...current };
  if (repo === null) delete next[organizationId];
  else next[organizationId] = Object.freeze({ id: repo.id, name: repo.name });

  state = Object.freeze(next);
  storeFocusRepos(state);
  for (const listener of [...listeners]) listener();
}

/**
 * Hear about changes to the choices.
 *
 * @param listener Called after each change, with no argument — the listener re-reads
 *   {@link focusRepoState}, which is the contract `useSyncExternalStore` expects.
 * @returns The way to stop listening.
 */
export function subscribeFocusRepo(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * A workspace's focus repository, kept in step with the store.
 *
 * The subscription is to the whole map rather than to one entry, and the entry is picked out
 * afterwards: the map's identity is what changes when anything is chosen, and picking after
 * the hook keeps the snapshot React compares by identity a value this module owns rather
 * than an object rebuilt on every render.
 *
 * @param organizationId The workspace the chip is drawing — `undefined` while the session
 *   has not answered, which reads as *all repositories* rather than as an error.
 * @returns The repository in focus, or `null` for all of them.
 */
export function useFocusRepo(organizationId: string | undefined): FocusRepo | null {
  const choices = useSyncExternalStore(
    subscribeFocusRepo,
    focusRepoState,
    () => FOCUS_REPO_SERVER_STATE,
  );

  return focusRepoIn(choices, organizationId);
}

/**
 * Reset the store — **for tests only.**
 *
 * The module holds one snapshot per browser, which is right in a browser and wrong in a
 * suite: Vitest runs a file's cases in one module registry, so without this the second case
 * reads the first case's choice. `resetApiClient` in `app/api/server.ts` exists for the same
 * reason and says the same thing.
 *
 * @returns Nothing.
 */
export function resetFocusRepos(): void {
  state = null;
}
