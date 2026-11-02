import { afterEach, describe, expect, it, vi } from "vitest";

import { createFirstLoopPoll, requestFirstLoop } from "@/app/get-started/first-loop-poll";
import { UNREADABLE_FIRST_LOOP } from "@/app/get-started/first-loop-view";

import { firstLoop } from "../helpers/first-loop";

/** The first-loop poll (BD.1, #396): this origin, the poll family's shape, the page's guard. */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestFirstLoop", () => {
  it("reads the first loop from this origin, and refuses an answer it cannot draw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(firstLoop()), { status: 200 })));
    expect(await requestFirstLoop("/api/onboarding/first-loop?run=x", null)).toMatchObject({ state: "fresh" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ console: null }), { status: 200 })));
    expect(await requestFirstLoop("/api/onboarding/first-loop?run=x", null)).toMatchObject({
      state: "failed",
      reason: UNREADABLE_FIRST_LOOP,
    });
  });
});

describe("createFirstLoopPoll", () => {
  it("asks its reader for the endpoint it was built for", async () => {
    const read = vi.fn().mockResolvedValue({ state: "fresh", payload: firstLoop(), etag: null, pollAfterSeconds: null });
    const poll = createFirstLoopPoll("/api/onboarding/first-loop?run=x", { read, visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(firstLoop()));
    expect(read).toHaveBeenCalledWith("/api/onboarding/first-loop?run=x", null);
    stop();
  });
});
