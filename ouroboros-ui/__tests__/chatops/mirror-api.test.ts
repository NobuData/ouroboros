import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "@/app/api/client";
import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_MIRROR } from "@/app/chatops/view";

import { mirror } from "../helpers/chatops";
import { result } from "../helpers/console";

/**
 * The channel mirror's calls (#542): the route the contract names, the cursor and the limit in
 * the query, this origin's route in the poll family's shape — and the one field the composer adds
 * to the console's dispatch.
 */

vi.mock("server-only", () => ({}));

const anonymous = { GET: vi.fn() };

vi.mock("@/app/api/server", () => ({ api: () => ({}), anonymousApi: () => anonymous }));

const { MIRROR_CHANNEL_MISSING, MIRROR_ROUTE, MIRROR_UNAVAILABLE_CODE, chatopsMirror, readChatOpsMirror } = await import(
  "@/app/api/chatops-mirror"
);
const { consoleApi } = await import("@/app/api/console");
const { GET } = await import("@/app/api/chatops/mirror/route");

/**
 * A client whose every verb answers one body and records how it was called.
 *
 * @param data What every call answers.
 * @returns The client and its verbs.
 */
function client(data: unknown) {
  const call = () => vi.fn().mockResolvedValue({ data, response: new Response() });
  const verbs = { GET: call(), POST: call() };

  return { verbs, client: verbs as unknown as ApiClient };
}

beforeEach(() => {
  anonymous.GET.mockReset().mockResolvedValue({ data: mirror(), response: new Response() });
});

describe("reading a mirror", () => {
  it("asks the contract's route for the latest page, by channel", async () => {
    const one = client(mirror());

    expect(await chatopsMirror.read("channel-1", {}, one.client)).toEqual(mirror());
    expect(MIRROR_ROUTE).toBe("/api/v1/chat/channels/{id}/mirror");
    expect(one.verbs.GET.mock.calls[0]).toEqual([
      MIRROR_ROUTE,
      { params: { path: { id: "channel-1" }, query: {} }, signal: undefined },
    ]);
  });

  it("carries the cursor and the limit, and can be aborted", async () => {
    const one = client(mirror());
    const { signal } = new AbortController();

    await chatopsMirror.read("channel-1", { before: "cursor-1", limit: 20 }, one.client, signal);

    expect(one.verbs.GET.mock.calls[0]![1]).toEqual({
      params: { path: { id: "channel-1" }, query: { before: "cursor-1", limit: 20 } },
      signal,
    });
  });

  it("sends no empty cursor", async () => {
    const one = client(mirror());

    await chatopsMirror.read("channel-1", { before: "" }, one.client);

    expect(one.verbs.GET.mock.calls[0]![1].params.query).toEqual({});
  });
});

describe("the poll's read", () => {
  it("answers the latest page through the anonymous client, asking to be asked again in 15 s", async () => {
    const answer = await readChatOpsMirror("channel-1", null);

    expect(answer).toMatchObject({ state: "fresh", payload: mirror(), pollAfterSeconds: 15 });
    expect(anonymous.GET.mock.calls[0]![1].params).toEqual({ path: { id: "channel-1" }, query: {} });
    expect(anonymous.GET.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });

  it("passes a cursor on", async () => {
    await readChatOpsMirror("channel-1", "cursor-1");

    expect(anonymous.GET.mock.calls[0]![1].params.query).toEqual({ before: "cursor-1" });
  });

  it("asks nothing when no channel is named", async () => {
    expect(await readChatOpsMirror(null, null)).toMatchObject({ state: "failed", reason: MIRROR_CHANNEL_MISSING });
    expect(await readChatOpsMirror("  ", null)).toMatchObject({ state: "failed", reason: MIRROR_CHANNEL_MISSING });
    expect(anonymous.GET).not.toHaveBeenCalled();
  });

  it("reports a session that ended as gone, a refusal in the service's words, and silence as unreachable", async () => {
    anonymous.GET.mockRejectedValueOnce(new ApiError(401, "unauthenticated", "Sign in."));
    expect(await readChatOpsMirror("channel-1", null)).toEqual({ state: "gone" });

    anonymous.GET.mockRejectedValueOnce(new ApiError(404, "chat_channel_not_found", "That channel was not found."));
    expect(await readChatOpsMirror("channel-1", null)).toMatchObject({
      state: "failed",
      reason: "That channel was not found.",
      pollAfterSeconds: 15,
    });

    anonymous.GET.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await readChatOpsMirror("channel-1", null)).toMatchObject({ state: "failed", reason: UNREACHABLE_MIRROR });
  });
});

describe("GET /api/chatops/mirror", () => {
  it("serves the channel the address names, with the cadence in the header", async () => {
    const response = await GET(new Request("http://localhost/api/chatops/mirror?channel=channel-1"));

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Ouro-Poll-After")).toBe("15");
    expect(await response.json()).toEqual(mirror());
    expect(anonymous.GET.mock.calls[0]![1].params).toEqual({ path: { id: "channel-1" }, query: {} });
  });

  it("serves the page before a cursor", async () => {
    await GET(new Request("http://localhost/api/chatops/mirror?channel=channel-1&before=cursor-1"));

    expect(anonymous.GET.mock.calls[0]![1].params.query).toEqual({ before: "cursor-1" });
  });

  it("answers a failure under this hop's code", async () => {
    const response = await GET(new Request("http://localhost/api/chatops/mirror"));

    expect(response.ok).toBe(false);
    expect(await response.json()).toEqual({ code: MIRROR_UNAVAILABLE_CODE, message: MIRROR_CHANNEL_MISSING });
  });

  it("answers 401 when the session has ended", async () => {
    anonymous.GET.mockRejectedValueOnce(new ApiError(401, "unauthenticated", "Sign in."));

    expect((await GET(new Request("http://localhost/api/chatops/mirror?channel=channel-1"))).status).toBe(401);
  });
});

describe("running a line from the composer", () => {
  it("posts the text and the channel it was typed under", async () => {
    const one = client(result());

    expect(await consoleApi.run("status", { channelId: "channel-1" }, one.client)).toEqual(result());
    expect(one.verbs.POST.mock.calls[0]).toEqual([
      "/api/v1/chat/commands",
      { body: { text: "status", channelId: "channel-1" } },
    ]);
  });

  it("names no channel for the palette", async () => {
    const one = client(result());

    await consoleApi.run("status", {}, one.client);

    expect(one.verbs.POST.mock.calls[0]![1]).toEqual({ body: { text: "status" } });
  });
});
