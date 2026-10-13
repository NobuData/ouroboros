import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { NOT_JOINED_MESSAGE, boundChannelList, channels, connection } from "../helpers/chatops";

/**
 * The Chat Ops page's four server hops (#541): each answers the fresh payload, and a refusal
 * comes back as `{ error }` carrying the service's own sentence.
 */

const verify = vi.fn();
const refresh = vi.fn();
const bind = vi.fn();
const unbind = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/chatops", () => ({
  chatops: {
    verify: () => verify(),
    refresh: () => refresh(),
    bind: (id: unknown, purpose: unknown) => bind(id, purpose),
    unbind: (id: unknown) => unbind(id),
  },
}));

const { bindChannel, refreshChannels, unbindChannel, verifyConnection } = await import(
  "@/app/chatops/chatops-actions"
);

beforeEach(() => {
  for (const mock of [verify, refresh, bind, unbind]) mock.mockReset();
});

describe("the page's writes", () => {
  it("answer the payload the service returned", async () => {
    const verification = { result: "verified", connection: connection() };

    verify.mockResolvedValueOnce(verification);
    refresh.mockResolvedValueOnce(channels());
    bind.mockResolvedValueOnce(channels(boundChannelList()));
    unbind.mockResolvedValueOnce(channels());

    expect(await verifyConnection()).toEqual(verification);
    expect(await refreshChannels()).toEqual(channels());
    expect(await bindChannel("channel-1", "loops")).toEqual(channels(boundChannelList()));
    expect(await unbindChannel("channel-1")).toEqual(channels());
    expect(bind).toHaveBeenCalledWith("channel-1", "loops");
    expect(unbind).toHaveBeenCalledWith("channel-1");
  });

  it("turn the service's refusal into its sentence", async () => {
    bind.mockRejectedValueOnce(new ApiError(409, "slack_channel_not_joined", NOT_JOINED_MESSAGE));
    refresh.mockRejectedValueOnce(new ApiError(502, "slack_unavailable", "Slack refused to list the channels."));
    unbind.mockRejectedValueOnce(new ApiError(403, "forbidden", "Only an owner or an admin may unbind a channel."));
    verify.mockRejectedValueOnce(new ApiError(403, "forbidden", "Only an owner or an admin may verify."));

    expect(await bindChannel("channel-1", "alerts")).toEqual({ error: NOT_JOINED_MESSAGE });
    expect(await refreshChannels()).toEqual({ error: "Slack refused to list the channels." });
    expect(await unbindChannel("channel-1")).toEqual({ error: "Only an owner or an admin may unbind a channel." });
    expect(await verifyConnection()).toEqual({ error: "Only an owner or an admin may verify." });
  });

  it("let what is not an answer from the service travel — the redirect signal, a dropped connection", async () => {
    bind.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(bindChannel("channel-1", "loops")).rejects.toThrow("fetch failed");
  });
});
