import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DRAFT_KEY_PREFIX,
  composerDraftStore,
  createComposerDraftStore,
  resetComposerDrafts,
  useComposerDraft,
} from "@/app/workflows/copilot/composer-draft";

/**
 * The composer's unsent text (CE.2, #566): kept per workflow in session storage, restored on
 * return, and never dependent on storage working.
 */

const KEY = `${DRAFT_KEY_PREFIX}wf-1`;

beforeEach(() => {
  window.sessionStorage.clear();
  resetComposerDrafts();
});

describe("createComposerDraftStore", () => {
  it("starts from what storage holds, and from nothing when it holds nothing", () => {
    window.sessionStorage.setItem(KEY, "half a thought");

    expect(createComposerDraftStore(KEY).get()).toBe("half a thought");
    expect(createComposerDraftStore(`${DRAFT_KEY_PREFIX}other`).get()).toBe("");
  });

  it("writes each change through, tells its subscribers, and forgets the entry when emptied", () => {
    const store = createComposerDraftStore(KEY);
    const listener = vi.fn();
    const stop = store.subscribe(listener);

    store.set("one");
    expect(window.sessionStorage.getItem(KEY)).toBe("one");
    expect(listener).toHaveBeenCalledOnce();

    store.set("one");
    expect(listener).toHaveBeenCalledOnce();

    store.set("");
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    stop();
    store.set("two");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps working in memory when storage refuses to be read or written, or is not there", () => {
    const refusing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;

    for (const storage of [() => refusing, () => null, () => { throw new Error("no access"); }]) {
      const store = createComposerDraftStore(KEY, storage as () => Storage | null);

      expect(store.get()).toBe("");
      store.set("kept in memory");
      expect(store.get()).toBe("kept in memory");
      store.set("");
      expect(store.get()).toBe("");
    }
  });
});

describe("composerDraftStore", () => {
  it("is one store per workflow, the same on every call", () => {
    expect(composerDraftStore("wf-1")).toBe(composerDraftStore("wf-1"));
    expect(composerDraftStore("wf-1")).not.toBe(composerDraftStore("wf-2"));

    composerDraftStore("wf-1").set("mine");

    expect(composerDraftStore("wf-2").get()).toBe("");
    expect(window.sessionStorage.getItem(KEY)).toBe("mine");
  });
});

describe("useComposerDraft", () => {
  it("reads the text and follows its changes", () => {
    const store = composerDraftStore("wf-1");
    store.set("before");

    const { result } = renderHook(() => useComposerDraft(store));

    expect(result.current).toBe("before");
    act(() => store.set("after"));
    expect(result.current).toBe("after");
  });
});
