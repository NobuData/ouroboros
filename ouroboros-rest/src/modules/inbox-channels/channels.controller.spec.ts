import { runWithTenantContext, setTenantContext } from "../tenancy/tenant.context";
import { ChannelsController } from "./channels.controller";
import type { ChannelsService } from "./channels.service";
import type { NotificationPreferencesService } from "./notifications/preferences.service";

describe("ChannelsController (#463)", () => {
  const calls: unknown[][] = [];
  const channels = {
    truth: (org: string) => {
      calls.push(["truth", org]);

      return Promise.resolve({ channels: [] });
    },
  } as unknown as ChannelsService;
  const preferences = {
    read: (...args: unknown[]) => {
      calls.push(["read", ...args]);

      return Promise.resolve({});
    },
    update: (...args: unknown[]) => {
      calls.push(["update", ...args]);

      return Promise.resolve({});
    },
  } as unknown as NotificationPreferencesService;
  const controller = new ChannelsController(channels, preferences);
  const member = { tenant: { id: "org-1" }, roles: ["member"] } as never;

  beforeEach(() => {
    calls.length = 0;
  });

  it("answers the workspace's channel truth", async () => {
    await controller.channelRows(member);

    expect(calls).toEqual([["truth", "org-1"]]);
  });

  it("reads and writes the caller's own preferences", async () => {
    await runWithTenantContext(async () => {
      setTenantContext({ user: { id: "user-a" } as never });
      await controller.readPreferences(member);
      await controller.updatePreferences(member, { digestEnabled: true, digestTime: "08:00" });
    });

    expect(calls).toEqual([
      ["read", "org-1", "user-a"],
      [
        "update",
        "org-1",
        "user-a",
        {
          digestEnabled: true,
          digestTime: "08:00",
          instantSeverity: undefined,
          mutedKinds: undefined,
        },
      ],
    ]);
  });

  it("refuses a caller with no person", () => {
    expect(() => controller.readPreferences(member)).toThrow(
      expect.objectContaining({ code: "notification_preferences_need_person" }) as Error,
    );
  });
});
