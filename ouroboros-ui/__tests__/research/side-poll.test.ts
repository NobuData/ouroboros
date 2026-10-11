import { afterEach, describe, expect, it, vi } from "vitest";

import { UNREACHABLE_SIDE, UNREADABLE_SIDE } from "@/app/research/side";
import { createSidePoll, requestSide } from "@/app/research/side-poll";

import { seededCatalog, seededWatch } from "../helpers/research";

/** The Research side column's poll (CN.3, #629): one endpoint for both cards, guarded. */

const SIDE = { tools: seededCatalog(), watch: seededWatch() };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("asking for the side column", () => {
  it("asks this origin's route and reads both cards", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(SIDE, { headers: { "X-Ouro-Poll-After": "30" } }));
    vi.stubGlobal("fetch", fetch);

    expect(await requestSide(null)).toMatchObject({ state: "fresh", payload: SIDE, pollAfterSeconds: 30 });
    expect(String(fetch.mock.calls[0][0])).toBe("/api/research/side");
  });

  it("says the payload could not be read when it is not the side column", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ tools: seededCatalog() })));

    expect(await requestSide(null)).toMatchObject({ state: "failed", reason: UNREADABLE_SIDE });
  });

  it("says it could not be reached when nothing answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    expect(await requestSide(null)).toMatchObject({ state: "failed", reason: UNREACHABLE_SIDE });
  });
});

describe("the poll", () => {
  it("publishes what its reader answers", async () => {
    const read = vi.fn().mockResolvedValue({ state: "fresh", payload: SIDE, etag: null, pollAfterSeconds: 30 });
    const poll = createSidePoll({ read, visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(SIDE));
    stop();

    expect(read).toHaveBeenCalledWith(null);
  });
});
