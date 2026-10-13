import { afterEach, describe, expect, it, vi } from "vitest";

import { createMirrorPoll, requestEarlierMirror, requestMirror } from "@/app/chatops/mirror-poll";
import { UNREACHABLE_MIRROR, UNREADABLE_MIRROR } from "@/app/chatops/view";

import { mirror } from "../helpers/chatops";

/** The channel mirror's poll (#542): this origin's route, keyed by channel, guarded. */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("asking for a mirror", () => {
  it("asks this origin's route for the channel's latest page", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(mirror(), { headers: { "X-Ouro-Poll-After": "15" } }));
    vi.stubGlobal("fetch", fetch);

    expect(await requestMirror("channel-1", null)).toMatchObject({ state: "fresh", payload: mirror(), pollAfterSeconds: 15 });
    expect(String(fetch.mock.calls[0]![0])).toBe("/api/chatops/mirror?channel=channel-1");
  });

  it("sends the validator it holds", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 304, headers: { ETag: '"m1"' } }));
    vi.stubGlobal("fetch", fetch);

    expect(await requestMirror("channel-1", '"m1"')).toMatchObject({ state: "unchanged", etag: '"m1"' });
    expect(fetch.mock.calls[0]![1].headers["If-None-Match"]).toBe('"m1"');
  });

  it("asks for the page before a cursor, with no validator", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(mirror()));
    vi.stubGlobal("fetch", fetch);

    expect(await requestEarlierMirror("channel-1", "cursor 1")).toMatchObject({ state: "fresh" });
    expect(String(fetch.mock.calls[0]![0])).toBe("/api/chatops/mirror?channel=channel-1&before=cursor+1");
    expect(fetch.mock.calls[0]![1].headers["If-None-Match"]).toBeUndefined();
  });

  it("says the payload could not be read when it is not a mirror", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ channel: mirror().channel })));

    expect(await requestMirror("channel-1", null)).toMatchObject({ state: "failed", reason: UNREADABLE_MIRROR });
  });

  it("says it could not be reached when nothing answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    expect(await requestMirror("channel-1", null)).toMatchObject({ state: "failed", reason: UNREACHABLE_MIRROR });
  });
});

describe("the poll", () => {
  it("publishes what its reader answers for its channel", async () => {
    const read = vi.fn().mockResolvedValue({ state: "fresh", payload: mirror(), etag: null, pollAfterSeconds: 15 });
    const poll = createMirrorPoll("channel-1", { read, visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(mirror()));
    stop();

    expect(read).toHaveBeenCalledWith("channel-1", null);
  });
});
