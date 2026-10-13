import { afterEach, describe, expect, it, vi } from "vitest";

import { createChatOpsPoll, requestChatOps } from "@/app/chatops/chatops-poll";
import { UNREACHABLE_CHATOPS, UNREADABLE_CHATOPS } from "@/app/chatops/view";

import { chatOpsPage, connection } from "../helpers/chatops";

/** The Chat Ops page's poll (#541): one endpoint for the connection and the channels, guarded. */

const PAGE = chatOpsPage();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("asking for the page", () => {
  it("asks this origin's route and reads the connection and the channels", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(PAGE, { headers: { "X-Ouro-Poll-After": "15" } }));
    vi.stubGlobal("fetch", fetch);

    expect(await requestChatOps(null)).toMatchObject({ state: "fresh", payload: PAGE, pollAfterSeconds: 15 });
    expect(String(fetch.mock.calls[0][0])).toBe("/api/chatops");
  });

  it("says the payload could not be read when it is not the page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ connection: connection() })));

    expect(await requestChatOps(null)).toMatchObject({ state: "failed", reason: UNREADABLE_CHATOPS });
  });

  it("says it could not be reached when nothing answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    expect(await requestChatOps(null)).toMatchObject({ state: "failed", reason: UNREACHABLE_CHATOPS });
  });
});

describe("the poll", () => {
  it("publishes what its reader answers", async () => {
    const read = vi.fn().mockResolvedValue({ state: "fresh", payload: PAGE, etag: null, pollAfterSeconds: 15 });
    const poll = createChatOpsPoll({ read, visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(PAGE));
    stop();

    expect(read).toHaveBeenCalledWith(null);
  });
});
