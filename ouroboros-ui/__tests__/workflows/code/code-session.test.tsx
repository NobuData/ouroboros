import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_KEY_PREFIX,
  browserSessionStorage,
  codeSessionStore,
  createCodeSessionStore,
  useCodeSession,
} from "@/app/workflows/code/code-session";
import { EMPTY_SESSION, openTab } from "@/app/workflows/code/code-tabs";

/**
 * The store that keeps the code view's tabs and buffers for a browser session (V.3, #171) — what
 * makes **tab state per session** true, and makes an edit survive a navigation to another
 * workflow and back. Storage that refuses is a convenience lost, never a page broken.
 */

const PATH = "workflows/standard-fix.loop.ts";

/**
 * A `Storage` over a map, with every call counted.
 *
 * @param initial What it holds to begin with.
 * @returns The storage.
 */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(initial));

  return {
    get length() {
      return entries.size;
    },
    clear: vi.fn(() => entries.clear()),
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    key: vi.fn((index: number) => [...entries.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => void entries.delete(key)),
    setItem: vi.fn((key: string, value: string) => void entries.set(key, value)),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("a store", () => {
  it("starts from what storage holds, and hands back the same object until it changes", () => {
    const stored = openTab(EMPTY_SESSION, PATH);
    const storage = memoryStorage({ key: JSON.stringify(stored) });
    const store = createCodeSessionStore("key", () => storage);

    expect(store.get()).toEqual(stored);
    expect(store.get()).toBe(store.get());
    expect(storage.getItem).toHaveBeenCalledOnce();
  });

  it("writes each change through to storage and tells its listeners", () => {
    const storage = memoryStorage();
    const store = createCodeSessionStore("key", () => storage);
    const listener = vi.fn();
    store.subscribe(listener);

    store.update((current) => openTab(current, PATH));

    expect(store.get()).toEqual(openTab(EMPTY_SESSION, PATH));
    expect(JSON.parse(storage.getItem("key") ?? "null")).toEqual(openTab(EMPTY_SESSION, PATH));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("writes nothing and tells no one about a change that changes nothing", () => {
    const storage = memoryStorage();
    const store = createCodeSessionStore("key", () => storage);
    const listener = vi.fn();
    store.subscribe(listener);

    store.update((current) => current);

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops telling a listener that unsubscribed", () => {
    const store = createCodeSessionStore("key", () => memoryStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.update((current) => openTab(current, PATH));

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("storage that refuses", () => {
  it("starts empty when storage cannot be read, and keeps working in memory", () => {
    const store = createCodeSessionStore("key", () => {
      throw new Error("SecurityError");
    });

    expect(store.get()).toBe(EMPTY_SESSION);

    store.update((current) => openTab(current, PATH));
    expect(store.get()).toEqual(openTab(EMPTY_SESSION, PATH));
  });

  it("keeps a change, and tells its listeners, when storage cannot be written", () => {
    const storage = memoryStorage();
    vi.mocked(storage.setItem).mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const store = createCodeSessionStore("key", () => storage);
    const listener = vi.fn();
    store.subscribe(listener);

    store.update((current) => openTab(current, PATH));

    expect(store.get()).toEqual(openTab(EMPTY_SESSION, PATH));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("works in memory where there is no storage at all", () => {
    const store = createCodeSessionStore("key", () => null);

    store.update((current) => openTab(current, PATH));

    expect(store.get().active).toBe(PATH);
  });

  it("finds the browser's session storage, and none when reaching it throws", () => {
    expect(browserSessionStorage()).toBe(window.sessionStorage);

    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(browserSessionStorage()).toBeNull();
  });

  it("reads storage that holds something that is not a session as the empty session", () => {
    const store = createCodeSessionStore("key", () => memoryStorage({ key: "{not json" }));

    expect(store.get()).toBe(EMPTY_SESSION);
  });
});

describe("the browser's stores", () => {
  it("are one per workspace, kept, and persisted under the workspace's key", () => {
    const store = codeSessionStore("workspace-a");

    expect(codeSessionStore("workspace-a")).toBe(store);
    expect(codeSessionStore("workspace-b")).not.toBe(store);

    store.update((current) => openTab(current, PATH));

    expect(JSON.parse(window.sessionStorage.getItem(`${SESSION_KEY_PREFIX}workspace-a`) ?? "null")).toEqual(
      openTab(EMPTY_SESSION, PATH),
    );
    expect(window.sessionStorage.getItem(`${SESSION_KEY_PREFIX}workspace-b`)).toBeNull();
    expect(codeSessionStore("workspace-b").get()).toBe(EMPTY_SESSION);
  });
});

describe("reading a store in a component", () => {
  it("renders the session and re-renders on each change", () => {
    const store = createCodeSessionStore("key", () => memoryStorage());
    const { result } = renderHook(() => useCodeSession(store, EMPTY_SESSION));

    expect(result.current).toBe(EMPTY_SESSION);

    act(() => store.update((current) => openTab(current, PATH)));

    expect(result.current).toEqual(openTab(EMPTY_SESSION, PATH));
  });
});
