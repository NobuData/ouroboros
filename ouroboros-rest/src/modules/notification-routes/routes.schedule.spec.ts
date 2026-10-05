import { dueRouteSlot, latestRouteSlot } from "./routes.schedule";

/** When a route's mail is due (#488): its own time, a grace after it, and a gap between sends. */

const at = (iso: string): Date => new Date(iso);

describe("the daily digest route's slot", () => {
  it("is the configured time, 09:00 UTC when unset", () => {
    expect(latestRouteSlot("daily_digest", { time: "07:30" }, at("2026-10-05T08:00:00Z"))).toEqual(
      at("2026-10-05T07:30:00Z"),
    );
    expect(latestRouteSlot("daily_digest", {}, at("2026-10-05T08:00:00Z"))).toEqual(
      at("2026-10-04T09:00:00Z"),
    );
  });

  it("is due from its time until the grace runs out, and not before", () => {
    const config = { time: "09:00" };

    expect(dueRouteSlot("daily_digest", config, at("2026-10-05T08:59:00Z"), undefined)).toBe(
      undefined,
    );
    expect(dueRouteSlot("daily_digest", config, at("2026-10-05T09:00:30Z"), undefined)).toEqual(
      at("2026-10-05T09:00:00Z"),
    );
    expect(dueRouteSlot("daily_digest", config, at("2026-10-05T16:00:00Z"), undefined)).toBe(
      undefined,
    );
  });

  it("stays due for the slot that last delivered, so a failed address is retried", () => {
    const slot = at("2026-10-05T09:00:00Z");

    expect(dueRouteSlot("daily_digest", {}, at("2026-10-05T09:05:00Z"), slot)).toEqual(slot);
  });

  it("does not send twice in a day when the time moves later", () => {
    expect(
      dueRouteSlot(
        "daily_digest",
        { time: "15:00" },
        at("2026-10-05T15:00:30Z"),
        at("2026-10-05T09:00:00Z"),
      ),
    ).toBe(undefined);
    expect(
      dueRouteSlot(
        "daily_digest",
        { time: "15:00" },
        at("2026-10-06T15:00:30Z"),
        at("2026-10-05T09:00:00Z"),
      ),
    ).toEqual(at("2026-10-06T15:00:00Z"));
  });
});

describe("the weekly insights route's slot", () => {
  it("is the configured weekday and time, Monday 09:00 UTC when unset", () => {
    // 2026-10-05 is a Monday.
    expect(latestRouteSlot("weekly_insights", {}, at("2026-10-07T12:00:00Z"))).toEqual(
      at("2026-10-05T09:00:00Z"),
    );
    expect(
      latestRouteSlot(
        "weekly_insights",
        { weekday: "friday", time: "17:00" },
        at("2026-10-07T12:00:00Z"),
      ),
    ).toEqual(at("2026-10-02T17:00:00Z"));
  });

  it("is due for a day after its slot, then not until next week", () => {
    const config = { weekday: "monday", time: "09:00" };

    expect(dueRouteSlot("weekly_insights", config, at("2026-10-05T20:00:00Z"), undefined)).toEqual(
      at("2026-10-05T09:00:00Z"),
    );
    expect(dueRouteSlot("weekly_insights", config, at("2026-10-06T10:00:00Z"), undefined)).toBe(
      undefined,
    );
  });

  it("does not send twice in a week when the weekday moves", () => {
    expect(
      dueRouteSlot(
        "weekly_insights",
        { weekday: "wednesday" },
        at("2026-10-07T09:00:30Z"),
        at("2026-10-05T09:00:00Z"),
      ),
    ).toBe(undefined);
  });
});
