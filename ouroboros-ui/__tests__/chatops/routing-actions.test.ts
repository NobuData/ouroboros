import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { chatRoute, onCall } from "../helpers/chatops";

/**
 * The routing card's three server hops (#543): each answers the resource as it now stands, sends
 * exactly the field that changed to #488's route write — or the member to the on-call route — and
 * a refusal comes back as `{ error }` carrying the service's own sentence.
 */

const updateRoute = vi.fn();
const putOnCall = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/settings-integrations", () => ({
  settingsIntegrations: { updateRoute: (kind: unknown, patch: unknown) => updateRoute(kind, patch) },
}));
vi.mock("@/app/api/chatops", () => ({
  chatops: { setOnCall: (memberId: unknown) => putOnCall(memberId) },
}));

const { setOnCall, setRouteChannel, setRouteEnabled } = await import("@/app/chatops/routing-actions");

const ROUTE = chatRoute("custom:build-failures", { label: "Build failures" });

beforeEach(() => {
  updateRoute.mockReset().mockResolvedValue(ROUTE);
  putOnCall.mockReset().mockResolvedValue(onCall());
});

describe("the routing card's writes", () => {
  it("switch a route through the settings store's PATCH, with enabled alone", async () => {
    expect(await setRouteEnabled("custom:build-failures", false)).toEqual(ROUTE);
    expect(updateRoute).toHaveBeenCalledWith("custom:build-failures", { enabled: false });
  });

  it("repoint a route with chatChannelId alone", async () => {
    expect(await setRouteChannel("custom:build-failures", "channel-9")).toEqual(ROUTE);
    expect(updateRoute).toHaveBeenCalledWith("custom:build-failures", { chatChannelId: "channel-9" });
  });

  it("designate a member, or nobody", async () => {
    expect(await setOnCall("member-ken")).toEqual(onCall());
    await setOnCall(null);

    expect(putOnCall.mock.calls).toEqual([["member-ken"], [null]]);
  });

  it("turn the service's refusal into its sentence", async () => {
    updateRoute.mockRejectedValueOnce(new ApiError(422, "notification_route_no_target", "Choose a channel first."));
    putOnCall.mockRejectedValueOnce(
      new ApiError(422, "chat_on_call_not_linked", "Dana has not linked a Slack identity."),
    );

    expect(await setRouteEnabled("custom:stage-transitions", true)).toEqual({ error: "Choose a channel first." });
    expect(await setOnCall("member-dana")).toEqual({ error: "Dana has not linked a Slack identity." });
  });

  it("let what is not an answer from the service travel", async () => {
    updateRoute.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(setRouteChannel("custom:build-failures", "channel-9")).rejects.toThrow("fetch failed");
  });
});
