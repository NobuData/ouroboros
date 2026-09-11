import { describe, expect, it, vi } from "vitest";

import { onClearFilters, requestClearFilters } from "@/app/issues/clear-filters";

/**
 * *Back to the default view* — the signal between the table's empty state and the filter bar
 * ([#120](https://github.com/NobuData/ouroboros/issues/120)).
 *
 * The shape `summary-refresh.test.ts` holds, for the reason it gives: a module singleton on the
 * server is shared by every request the process handles, so the guard against publishing there
 * is asserted rather than trusted.
 */

describe("the clear-filters signal", () => {
  it("tells everyone listening", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onClearFilters(first);
    const stopSecond = onClearFilters(second);

    requestClearFilters();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();

    stopFirst();
    stopSecond();
  });

  it("stops telling a listener that has left", () => {
    const listener = vi.fn();
    onClearFilters(listener)();

    requestClearFilters();

    expect(listener).not.toHaveBeenCalled();
  });

  it("counts a listener registered twice as one", () => {
    // A re-render that re-subscribes must not clear twice for one press.
    const listener = vi.fn();
    const stop = onClearFilters(listener);
    onClearFilters(listener);

    requestClearFilters();

    expect(listener).toHaveBeenCalledOnce();
    stop();
  });

  it("survives a listener that unsubscribes while being told", () => {
    const heard: string[] = [];
    const stopFirst = onClearFilters(() => {
      heard.push("first");
      stopFirst();
    });
    const stopSecond = onClearFilters(() => heard.push("second"));

    requestClearFilters();

    expect(heard).toEqual(["first", "second"]);
    stopSecond();
  });

  it("publishes nothing on the server", () => {
    const listener = vi.fn();
    const stop = onClearFilters(listener);
    const held = globalThis.window;

    // What a Server Component render sees: no `window` at all.
    Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
    try {
      requestClearFilters();
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: held });
    }

    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});
