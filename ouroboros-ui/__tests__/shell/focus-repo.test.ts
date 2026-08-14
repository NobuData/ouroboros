import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALL_REPOS_LABEL,
  FOCUS_REPO_SERVER_STATE,
  FOCUS_REPO_STORAGE_KEY,
  type FocusRepo,
  focusRepoIn,
  focusRepoState,
  parseFocusRepos,
  readStoredFocusRepos,
  resetFocusRepos,
  setFocusRepo,
  storeFocusRepos,
  subscribeFocusRepo,
} from "@/app/shell/focus-repo";

/**
 * The focus-repo preference ([#77](https://github.com/NobuData/ouroboros/issues/77)) — which
 * repository a workspace is looking at, per workspace, across sessions.
 *
 * The acceptance criterion this suite exists for is *"the focus repo persists per
 * organization across sessions"*, and it is two properties rather than one: a choice made in
 * one workspace does not follow the reader into another, and a choice survives the browser
 * being closed. The second is `localStorage` — so the cases below are about what is written
 * there and what is made of what is read back, including the values nobody meant to write.
 *
 * The store is module state, which is right in a browser and wrong in a suite: Vitest runs a
 * file's cases in one module registry, so `resetFocusRepos()` runs between them.
 */

/** The seeded workspaces' ids, as `helpers/account.ts` reports them. */
const ACME = "5eed0001-0000-4000-8000-000000000001";
const LABS = "5eed0001-0000-4000-8000-000000000002";

/** The seeded repository the mockups draw. */
const HELIOS: FocusRepo = { id: "5eed0006-0000-4000-8000-000000000001", name: "helios-firmware" };

/** Another, under the same organisation. */
const ATLAS: FocusRepo = { id: "5eed0006-0000-4000-8000-000000000004", name: "atlas-scheduler" };

beforeEach(() => {
  window.localStorage.clear();
  resetFocusRepos();
});

afterEach(() => {
  window.localStorage.clear();
  resetFocusRepos();
});

describe("reading what a browser has stored", () => {
  it("takes a map of workspaces to repositories", () => {
    const choices = parseFocusRepos(JSON.stringify({ [ACME]: HELIOS, [LABS]: ATLAS }));

    expect(focusRepoIn(choices, ACME)).toEqual(HELIOS);
    expect(focusRepoIn(choices, LABS)).toEqual(ATLAS);
  });

  it("reads nothing at all as nothing chosen", () => {
    // Which is a browser that has never chosen, and one that has chosen and gone back to
    // all repositories: both are the absence of the key.
    expect(parseFocusRepos(null)).toEqual({});
    expect(parseFocusRepos("")).toEqual({});
  });

  it("reads a value that is not a map as nothing chosen", () => {
    for (const raw of ["not json at all", "[]", '"a string"', "null", "7"]) {
      expect(parseFocusRepos(raw)).toEqual({});
    }
  });

  it("drops the entries that are not repositories and keeps the rest", () => {
    // One bad key must not cost every workspace its choice — this string is whatever is in a
    // browser's storage: written by an older version, edited by hand, truncated by a quota.
    const choices = parseFocusRepos(
      JSON.stringify({
        [ACME]: HELIOS,
        "org-no-name": { id: "x" },
        "org-no-id": { name: "y" },
        "org-not-an-object": "helios-firmware",
        "org-empty-name": { id: "x", name: "" },
        "": HELIOS,
      }),
    );

    expect(Object.keys(choices)).toEqual([ACME]);
  });

  it("answers all repositories for a workspace with no choice", () => {
    // `null` is the default and the unfiltered listing at every read that takes the filter.
    expect(focusRepoIn(parseFocusRepos(null), ACME)).toBeNull();
  });

  it("answers all repositories while the session has not said where it is", () => {
    expect(focusRepoIn(parseFocusRepos(JSON.stringify({ [ACME]: HELIOS })), undefined)).toBeNull();
  });

  it("survives a storage that cannot be reached at all", () => {
    // Safari's private mode and a browser configured to block storage both raise on the
    // property access rather than on the read — `app/browser.ts` is where that is caught, and
    // this is the same posture one layer up.
    const refusing = {
      getItem() {
        throw new Error("blocked");
      },
    } as unknown as Storage;

    expect(readStoredFocusRepos(refusing)).toEqual({});
  });
});

describe("writing a choice down", () => {
  it("stores the map as JSON under one key", () => {
    storeFocusRepos({ [ACME]: HELIOS });

    expect(parseFocusRepos(window.localStorage.getItem(FOCUS_REPO_STORAGE_KEY))).toEqual({
      [ACME]: HELIOS,
    });
  });

  it("stores nothing chosen as the absence of the key", () => {
    // So "nothing chosen" has one spelling in storage, and a browser that has never chosen
    // looks the same as one that has gone back to all repositories.
    window.localStorage.setItem(FOCUS_REPO_STORAGE_KEY, JSON.stringify({ [ACME]: HELIOS }));

    storeFocusRepos({});

    expect(window.localStorage.getItem(FOCUS_REPO_STORAGE_KEY)).toBeNull();
  });

  it("says nothing when the write is refused", () => {
    const refusing = {
      setItem() {
        throw new Error("quota");
      },
      removeItem() {},
    } as unknown as Storage;

    // A preference that cannot be stored is not an error a reader can act on: the choice
    // applies to this session and simply will not be remembered.
    expect(() => storeFocusRepos({ [ACME]: HELIOS }, refusing)).not.toThrow();
  });
});

describe("choosing, in a browser", () => {
  it("holds the choice and persists it in the same call", () => {
    setFocusRepo(ACME, HELIOS);

    expect(focusRepoIn(focusRepoState(), ACME)).toEqual(HELIOS);
    // The key the next load boots from and the value this page is drawing cannot come apart.
    expect(readStoredFocusRepos()).toEqual({ [ACME]: HELIOS });
  });

  it("keeps one workspace's choice out of another's", () => {
    setFocusRepo(ACME, HELIOS);
    setFocusRepo(LABS, ATLAS);

    expect(focusRepoIn(focusRepoState(), ACME)).toEqual(HELIOS);
    expect(focusRepoIn(focusRepoState(), LABS)).toEqual(ATLAS);
  });

  it("goes back to all repositories by removing the entry", () => {
    setFocusRepo(ACME, HELIOS);
    setFocusRepo(ACME, null);

    expect(focusRepoIn(focusRepoState(), ACME)).toBeNull();
    expect(window.localStorage.getItem(FOCUS_REPO_STORAGE_KEY)).toBeNull();
  });

  it("is read back by the next session", () => {
    // The criterion in one case: a choice made, the module re-read from scratch as a fresh
    // page load would, and the choice still there.
    setFocusRepo(ACME, HELIOS);
    resetFocusRepos();

    expect(focusRepoIn(focusRepoState(), ACME)).toEqual(HELIOS);
  });

  it("tells everyone waiting that it moved", () => {
    const listener = vi.fn();
    const stop = subscribeFocusRepo(listener);

    setFocusRepo(ACME, HELIOS);
    expect(listener).toHaveBeenCalledTimes(1);

    stop();
    setFocusRepo(ACME, ATLAS);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the choice is the one already held", () => {
    // `useSyncExternalStore` compares snapshots by identity, so a store that published an
    // unchanged value would re-render every subscriber for nothing.
    setFocusRepo(ACME, HELIOS);
    const before = focusRepoState();

    const listener = vi.fn();
    subscribeFocusRepo(listener);
    setFocusRepo(ACME, { ...HELIOS });

    expect(focusRepoState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("what the server renders", () => {
  it("is no choices at all", () => {
    // The server has no storage to read one from, and guessing is a hydration mismatch.
    expect(FOCUS_REPO_SERVER_STATE).toEqual({});
    expect(Object.isFrozen(FOCUS_REPO_SERVER_STATE)).toBe(true);
  });

  it("names the default in the words the chip draws", () => {
    expect(ALL_REPOS_LABEL).toBe("All repos");
  });
});
