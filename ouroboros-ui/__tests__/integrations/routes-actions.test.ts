import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { RECIPIENTS_FIELD, type RoutePatch, TIME_FIELD } from "@/app/integrations/routes";

/**
 * The Notifications card's Server Action (BS.5, #495): one request per changed route, in order;
 * a refusal stops the rest, says what landed, and re-reads the page when anything did.
 */

const updateRoute = vi.fn();
const refresh = vi.fn();

vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("@/app/api/settings-integrations", () => ({
  settingsIntegrations: { updateRoute: (...args: unknown[]) => updateRoute(...args) },
}));

const { saveRoutes } = await import("@/app/integrations/routes-actions");

const DIGEST: RoutePatch = {
  kind: "daily_digest",
  name: "Daily digest → email",
  patch: { config: { time: "07:30" } },
};
const FAILURES: RoutePatch = {
  kind: "loop_failures",
  name: "Loop failures → PagerDuty",
  patch: { enabled: true },
};
const WEEKLY: RoutePatch = {
  kind: "weekly_insights",
  name: "Weekly insights report → email",
  patch: { config: { recipients: ["a@acme.dev"] } },
};

beforeEach(() => {
  updateRoute.mockReset().mockResolvedValue({});
  refresh.mockReset();
});

describe("saveRoutes", () => {
  it("sends each route's patch to its kind, in the order given", async () => {
    expect(await saveRoutes([DIGEST, WEEKLY])).toEqual({ ok: true });

    expect(updateRoute.mock.calls).toEqual([
      ["daily_digest", { config: { time: "07:30" } }],
      ["weekly_insights", { config: { recipients: ["a@acme.dev"] } }],
    ]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sends nothing for nothing", async () => {
    expect(await saveRoutes([])).toEqual({ ok: true });
    expect(updateRoute).not.toHaveBeenCalled();
  });

  it("reports the API's refusal to arm a locked route, with the reason the card prints", async () => {
    updateRoute.mockRejectedValue(
      new ApiError(409, "notification_route_locked", "This route cannot be enabled.", {
        reason: "connect PagerDuty first",
      }),
    );

    expect(await saveRoutes([FAILURES])).toEqual({
      ok: false,
      reason:
        "No notification route was saved. Loop failures → PagerDuty: " +
        "This route is locked and cannot be switched on: connect PagerDuty first.",
      fields: {},
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops at the first refusal, says what landed, and re-reads the page", async () => {
    updateRoute
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        new ApiError(422, "notification_route_config_invalid", "The config is not valid.", {
          fields: { "config.recipients": ["recipients must be email addresses"] },
        }),
      );

    expect(await saveRoutes([DIGEST, WEEKLY, FAILURES])).toEqual({
      ok: false,
      reason:
        "Saved: Daily digest → email. Not saved — Weekly insights report → email: The config is not valid.",
      fields: { [RECIPIENTS_FIELD]: "recipients must be email addresses" },
    });
    expect(updateRoute).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("routes a refused time to the time field", async () => {
    updateRoute.mockRejectedValue(
      new ApiError(422, "notification_route_config_invalid", "Bad.", {
        fields: { "config.time": ["time must be HH:MM"] },
      }),
    );

    const result = await saveRoutes([DIGEST]);

    expect(result).toMatchObject({ ok: false, fields: { [TIME_FIELD]: "time must be HH:MM" } });
  });

  it("lets anything that is not the service refusing keep travelling", async () => {
    updateRoute.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(saveRoutes([DIGEST])).rejects.toThrow("NEXT_REDIRECT");
  });
});
