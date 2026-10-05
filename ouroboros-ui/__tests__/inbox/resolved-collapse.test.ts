import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RESOLVED_COLLAPSE_STORAGE_KEY,
  parseResolvedCollapsed,
  readStoredResolvedCollapsed,
  resetResolvedCollapsed,
  resolvedCollapsedState,
  setResolvedCollapsed,
  storeResolvedCollapsed,
  subscribeResolvedCollapsed,
} from "@/app/inbox/resolved-collapse";

/**
 * Whether each reader keeps the resolved list folded (#468): kept per person in `localStorage`,
 * open by default, and never able to break the page when storage misbehaves.
 */

beforeEach(() => {
  window.localStorage.clear();
  resetResolvedCollapsed();
});

describe("reading what was stored", () => {
  it("is nobody for a value that is absent, not JSON, or not an object", () => {
    for (const raw of [null, undefined, "", "{", "[]", '"yes"', "7"]) {
      expect(parseResolvedCollapsed(raw)).toEqual({});
    }
  });

  it("keeps only real entries — a person, folded", () => {
    expect(parseResolvedCollapsed(JSON.stringify({ ken: true, maya: false, "": true, joe: "yes" }))).toEqual({
      ken: true,
    });
  });

  it("is nobody when storage cannot be reached", () => {
    const broken = { getItem: () => { throw new Error("denied"); } } as unknown as Storage;

    expect(readStoredResolvedCollapsed(broken)).toEqual({});
  });
});

describe("folding and opening", () => {
  it("remembers a fold per person, and forgets it when they open the list again", () => {
    setResolvedCollapsed("ken", true);
    setResolvedCollapsed("maya", true);

    expect(JSON.parse(window.localStorage.getItem(RESOLVED_COLLAPSE_STORAGE_KEY)!)).toEqual({ ken: true, maya: true });

    setResolvedCollapsed("ken", false);

    expect(resolvedCollapsedState()).toEqual({ maya: true });
    expect(JSON.parse(window.localStorage.getItem(RESOLVED_COLLAPSE_STORAGE_KEY)!)).toEqual({ maya: true });
  });

  it("stores open as the absence of the key, so nothing stored and chose-open cannot drift", () => {
    setResolvedCollapsed("ken", true);
    setResolvedCollapsed("ken", false);

    expect(window.localStorage.getItem(RESOLVED_COLLAPSE_STORAGE_KEY)).toBeNull();
  });

  it("survives a reload: a fresh read of storage finds the fold", () => {
    setResolvedCollapsed("ken", true);
    resetResolvedCollapsed();

    expect(resolvedCollapsedState()).toEqual({ ken: true });
  });

  it("tells its listeners once per real change, and not for a no-op or a nameless reader", () => {
    const heard = vi.fn();
    const stop = subscribeResolvedCollapsed(heard);

    setResolvedCollapsed("ken", true);
    setResolvedCollapsed("ken", true);
    setResolvedCollapsed("", true);
    stop();
    setResolvedCollapsed("ken", false);

    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("does not throw when storage refuses the write", () => {
    const full = {
      setItem: () => { throw new Error("quota"); },
      removeItem: () => { throw new Error("quota"); },
    } as unknown as Storage;

    expect(() => storeResolvedCollapsed({ ken: true }, full)).not.toThrow();
    expect(() => storeResolvedCollapsed({}, full)).not.toThrow();
  });
});
