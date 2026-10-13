import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "@/app/api/client";

import { channels, connection, onCall } from "../helpers/chatops";

/**
 * The Slack plane's calls (#541): each names the route the contract does, and the four channel
 * routes carry the channel in the path and the purpose in the body.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/server", () => ({ api: () => ({}) }));

const { chatops } = await import("@/app/api/chatops");

/**
 * A client whose every verb answers one body and records how it was called.
 *
 * @param data What every call answers.
 * @returns The client and its four verbs.
 */
function client(data: unknown) {
  const call = () => vi.fn().mockResolvedValue({ data, response: new Response() });
  const verbs = { GET: call(), POST: call(), PUT: call(), DELETE: call() };

  return { verbs, client: verbs as unknown as ApiClient };
}

describe("the connection", () => {
  it("is read from, and verified at, BZ.1's routes", async () => {
    const one = client(connection());

    expect(await chatops.connection(one.client)).toEqual(connection());
    expect(one.verbs.GET.mock.calls[0]![0]).toBe("/api/v1/slack/connection");

    await chatops.verify(one.client);
    expect(one.verbs.POST.mock.calls[0]![0]).toBe("/api/v1/slack/connection/verify");
  });

  it("has its dead letters queued again at #545's route, which answers the connection", async () => {
    const one = client(connection());

    expect(await chatops.retryDelivery(one.client)).toEqual(connection());
    expect(one.verbs.POST.mock.calls[0]![0]).toBe("/api/v1/slack/connection/delivery/retry");
  });
});

describe("the channels", () => {
  it("are listed and re-listed", async () => {
    const one = client(channels());

    expect(await chatops.channels(one.client)).toEqual(channels());
    expect(one.verbs.GET.mock.calls[0]![0]).toBe("/api/v1/slack/channels");

    await chatops.refresh(one.client);
    expect(one.verbs.POST.mock.calls[0]![0]).toBe("/api/v1/slack/channels/refresh");
  });

  it("are bound with a purpose and unbound, by id", async () => {
    const one = client(channels());

    await chatops.bind("channel-1", "alerts", one.client);
    expect(one.verbs.PUT.mock.calls[0]).toEqual([
      "/api/v1/slack/channels/{id}/binding",
      { params: { path: { id: "channel-1" } }, body: { purpose: "alerts" } },
    ]);

    await chatops.unbind("channel-1", one.client);
    expect(one.verbs.DELETE.mock.calls[0]).toEqual([
      "/api/v1/slack/channels/{id}/binding",
      { params: { path: { id: "channel-1" } } },
    ]);
  });
});

describe("the on-call designee (#543)", () => {
  it("is read from, and written to, the chat plane's on-call route", async () => {
    const one = client(onCall());
    const signal = new AbortController().signal;

    expect(await chatops.onCall(one.client, signal)).toEqual(onCall());
    expect(one.verbs.GET.mock.calls[0]).toEqual(["/api/v1/chat/on-call", { signal }]);

    expect(await chatops.setOnCall("member-ken", one.client)).toEqual(onCall());
    expect(one.verbs.PUT.mock.calls[0]).toEqual(["/api/v1/chat/on-call", { body: { memberId: "member-ken" } }]);

    await chatops.setOnCall(null, one.client);
    expect(one.verbs.PUT.mock.calls[1]).toEqual(["/api/v1/chat/on-call", { body: { memberId: null } }]);
  });
});
