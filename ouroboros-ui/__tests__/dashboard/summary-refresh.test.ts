import { describe, expect, it, vi } from "vitest";

import { onSummaryRefresh, requestSummaryRefresh } from "@/app/dashboard/summary-refresh";

/**
 * *Ask again, now* — the signal between the shell's writes and the polling store
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)).
 *
 * Small enough to read in one screen, and worth its own suite for one reason: it is a
 * **module singleton**, which on the server is shared by every request the process handles.
 * A signal published there would be one reader's workspace switch nudging the next
 * visitor's poll, which is the failure `app/shell/nav-registry.ts` guards its own publishers
 * against — so the guard is asserted here rather than trusted.
 */

describe("the summary refresh signal", () => {
  it("tells everyone listening", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onSummaryRefresh(first);
    const stopSecond = onSummaryRefresh(second);

    requestSummaryRefresh();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();

    stopFirst();
    stopSecond();
  });

  it("stops telling a listener that has left", () => {
    const listener = vi.fn();
    onSummaryRefresh(listener)();

    requestSummaryRefresh();

    expect(listener).not.toHaveBeenCalled();
  });

  it("counts a listener registered twice as one", () => {
    // A re-render that re-subscribes must not double the number of refetches one workspace
    // switch causes.
    const listener = vi.fn();
    const stop = onSummaryRefresh(listener);
    onSummaryRefresh(listener);

    requestSummaryRefresh();

    expect(listener).toHaveBeenCalledOnce();
    stop();
  });

  it("survives a listener that unsubscribes while being told", () => {
    // Which is what a React effect cleanup running mid-notification looks like: the set
    // being walked must not shorten underneath the walk.
    const heard: string[] = [];
    const stopFirst = onSummaryRefresh(() => {
      heard.push("first");
      stopFirst();
    });
    const stopSecond = onSummaryRefresh(() => heard.push("second"));

    requestSummaryRefresh();

    expect(heard).toEqual(["first", "second"]);
    stopSecond();
  });

  it("publishes nothing during a server render", () => {
    // A module singleton on the server is shared by every request the process handles.
    const listener = vi.fn();
    const stop = onSummaryRefresh(listener);

    vi.stubGlobal("window", undefined);
    try {
      requestSummaryRefresh();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});
