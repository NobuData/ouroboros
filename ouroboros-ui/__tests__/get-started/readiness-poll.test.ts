import { afterEach, describe, expect, it, vi } from "vitest";

import { createReadinessPoll, requestReadiness } from "@/app/get-started/readiness-poll";
import { UNREADABLE_READINESS } from "@/app/get-started/readiness-view";

import { readiness } from "../helpers/readiness";

/** Step 4's readiness poll (DK.2, #1319): this origin, the poll family's shape, the page's guard. */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestReadiness", () => {
  it("reads the preflight from this origin", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(readiness()), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    expect(await requestReadiness("/api/loop/readiness?repository=a/b&workflow=c", null)).toMatchObject({
      state: "fresh",
      payload: readiness(),
    });
    expect(fetch.mock.calls[0]![0]).toBe("/api/loop/readiness?repository=a/b&workflow=c");
  });

  it("refuses an answer the card cannot draw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ready: true }), { status: 200 })));

    expect(await requestReadiness("/api/loop/readiness", null)).toMatchObject({
      state: "failed",
      reason: UNREADABLE_READINESS,
    });
  });
});

describe("createReadinessPoll", () => {
  it("asks its reader for the endpoint it was built for", async () => {
    const read = vi.fn().mockResolvedValue({ state: "fresh", payload: readiness(), etag: null, pollAfterSeconds: null });
    const poll = createReadinessPoll("/api/loop/readiness?x", { read, visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(readiness()));
    expect(read).toHaveBeenCalledWith("/api/loop/readiness?x", null);
    stop();
  });
});
