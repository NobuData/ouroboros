import { describe, expect, it, vi } from "vitest";

import { clientAnswering } from "../helpers/api";
import { integrations, notificationRoutes, route } from "../helpers/integrations";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { ROUTE_LOCKED_CODE, settingsIntegrations } = await import("@/app/api/settings-integrations");

/**
 * The integrations hub's and the org routes' operations (#495 over #488): each reads or writes
 * its own resource under `/api/v1/settings`, sending exactly the body it was given.
 */

/**
 * The method and path of the one request a call made.
 *
 * @param requests The requests the stub saw.
 * @returns `METHOD /path`.
 */
function sent(requests: Request[]): string {
  expect(requests).toHaveLength(1);
  return `${requests[0].method} ${new URL(requests[0].url).pathname}`;
}

describe("settingsIntegrations", () => {
  it("reads the grid", async () => {
    const { client, requests } = clientAnswering(integrations());

    expect(await settingsIntegrations.read(client)).toEqual(integrations());
    expect(sent(requests)).toBe("GET /api/v1/settings/integrations");
  });

  it("reads the org routes", async () => {
    const { client, requests } = clientAnswering(notificationRoutes());

    expect(await settingsIntegrations.routes(client)).toEqual(notificationRoutes());
    expect(sent(requests)).toBe("GET /api/v1/settings/notifications");
  });

  it("patches one route by kind, sending only what it was given", async () => {
    const { client, requests } = clientAnswering(route("daily_digest"));

    await settingsIntegrations.updateRoute("daily_digest", { config: { time: "07:30" } }, client);

    expect(sent(requests)).toBe("PATCH /api/v1/settings/notifications/daily_digest");
    expect(await requests[0].json()).toEqual({ config: { time: "07:30" } });
  });

  it("encodes a custom kind into the path", async () => {
    const { client, requests } = clientAnswering(route("custom:release-notes"));

    await settingsIntegrations.updateRoute("custom:release-notes", { enabled: false }, client);

    expect(decodeURIComponent(new URL(requests[0].url).pathname)).toBe(
      "/api/v1/settings/notifications/custom:release-notes",
    );
  });

  it("rejects with the service's refusal when a save would arm a locked route", async () => {
    const { client } = clientAnswering(
      {
        code: ROUTE_LOCKED_CODE,
        message: "This route cannot be enabled.",
        details: { reason: "connect PagerDuty first" },
      },
      409,
    );

    await expect(
      settingsIntegrations.updateRoute("loop_failures", { enabled: true }, client),
    ).rejects.toMatchObject({
      status: 409,
      code: "notification_route_locked",
      details: { reason: "connect PagerDuty first" },
    });
  });
});
