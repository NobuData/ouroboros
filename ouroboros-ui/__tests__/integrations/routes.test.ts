import { describe, expect, it } from "vitest";

import {
  RECIPIENTS_FIELD,
  ROUTES_NOT_SAVED,
  ROUTE_SAVE_FAILED,
  TIME_FIELD,
  TIME_INVALID,
  enabledField,
  mayToggle,
  parseRecipients,
  recipientsLine,
  routeFieldErrors,
  routeLabels,
  routeName,
  routePatches,
  routeRefusal,
  routeTitle,
  routeWhy,
  routesBaseline,
  routesNotSaved,
  routesUnread,
  unlockLink,
  validateRoutes,
} from "@/app/integrations/routes";

import { notificationRoutes, route } from "../helpers/integrations";

/**
 * The Notifications card's rules (BS.5, #495): the fields it keeps, the locked-row rule, and the
 * patches a save sends.
 */

const ROUTES = notificationRoutes();
const BASELINE = routesBaseline(ROUTES);

describe("the baseline", () => {
  it("holds a switch per route, the digest's time and the weekly recipients", () => {
    expect(BASELINE).toEqual({
      "enabled:needs_you_dm": false,
      "enabled:daily_digest": true,
      "enabled:loop_failures": false,
      "enabled:weekly_insights": true,
      "time:daily_digest": "09:00",
      "recipients:weekly_insights": "eng-leads@acme.dev",
    });
  });

  it("reads the service's defaults for a config that names neither", () => {
    const bare = routesBaseline(
      notificationRoutes({ items: [route("daily_digest"), route("weekly_insights")] }),
    );

    expect(bare[TIME_FIELD]).toBe("09:00");
    expect(bare[RECIPIENTS_FIELD]).toBe("");
  });

  it("has no editor field for a route the service did not list", () => {
    const custom = routesBaseline(notificationRoutes({ items: [route("custom:release-notes")] }));

    expect(custom).toEqual({ "enabled:custom:release-notes": true });
  });

  it("labels every field", () => {
    expect(Object.keys(routeLabels(ROUTES)).sort()).toEqual(Object.keys(BASELINE).sort());
    expect(routeLabels(ROUTES)[enabledField("loop_failures")]).toBe("Loop failures → PagerDuty");
  });
});

describe("the copy", () => {
  it("names the four core routes as the mockup does", () => {
    expect(ROUTES.items.map((one) => routeName(one))).toEqual([
      "Needs-you decisions → Slack DM",
      "Daily digest → email",
      "Loop failures → PagerDuty",
      "Weekly insights report → email",
    ]);
  });

  it("puts the digest's time in its title, in UTC and saying so", () => {
    const digest = ROUTES.items[1];

    expect(routeTitle(digest, "07:30")).toBe("Daily digest 07:30 UTC → email");
    expect(routeTitle(digest)).toBe("Daily digest 09:00 UTC → email");
    expect(routeTitle(ROUTES.items[2], "07:30")).toBe("Loop failures → PagerDuty");
  });

  it("names a custom kind by its kind and channel", () => {
    expect(routeName(route("custom:release-notes"))).toBe("custom:release-notes → email");
    expect(routeWhy(route("custom:release-notes"))).toBeNull();
  });

  it("says what the mockup says under each core route", () => {
    expect(routeWhy(ROUTES.items[0])).toBe("approvals, waivers, allow-once requests");
    expect(routeWhy(ROUTES.items[1])).toBe("merges, spend, interventions since yesterday");
  });

  it("gives the weekly report its day and an email target — never a Slack channel", () => {
    const weekly = ROUTES.items[3];

    expect(routeName(weekly)).not.toMatch(/#|slack/i);
    expect(routeWhy(weekly)).toBe("Mondays, from the Insights screen · to eng-leads@acme.dev");
    expect(routeWhy(route("weekly_insights", { config: { weekday: "friday" } }))).toBe(
      "Fridays, from the Insights screen · to the workspace's owners and admins",
    );
    expect(routeWhy(weekly, ["a@b.dev", "c@d.dev"])).toContain("to a@b.dev, c@d.dev");
  });

  it("says who receives a mail with no list", () => {
    expect(recipientsLine([])).toBe("to the workspace's owners and admins");
  });

  it("says why the routes could not be read", () => {
    expect(routesUnread("Down.")).toBe("The notification routes could not be read. Down.");
  });
});

describe("the locked-row rule", () => {
  it("always offers an unlocked route's switch", () => {
    expect(mayToggle({ locked: false, enabled: false }, false)).toBe(true);
    expect(mayToggle({ locked: false, enabled: true }, false)).toBe(true);
  });

  it("never offers a way to switch a locked, saved-off route on", () => {
    expect(mayToggle({ locked: true, enabled: false }, false)).toBe(false);
  });

  it("keeps the switch of a locked route that is saved on — to switch it off, or back", () => {
    expect(mayToggle({ locked: true, enabled: true }, true)).toBe(true);
    expect(mayToggle({ locked: true, enabled: true }, false)).toBe(true);
  });

  it("links a locked row to the integration that would unlock it", () => {
    expect(unlockLink("pagerduty")).toEqual({
      href: "#integrations",
      text: "See PagerDuty in Integrations",
    });
    expect(unlockLink("slack").text).toBe("See Slack in Integrations");
  });
});

describe("validation", () => {
  it("accepts the baseline", () => {
    expect(validateRoutes(BASELINE)).toEqual({});
  });

  it("refuses a time that is not HH:MM", () => {
    for (const time of ["", "9:00", "24:00", "09:60", "nine"]) {
      expect(validateRoutes({ ...BASELINE, [TIME_FIELD]: time }), time).toEqual({
        [TIME_FIELD]: TIME_INVALID,
      });
    }
    expect(validateRoutes({ ...BASELINE, [TIME_FIELD]: "23:59" })).toEqual({});
  });

  it("names the entries that are not addresses", () => {
    expect(
      validateRoutes({ ...BASELINE, [RECIPIENTS_FIELD]: "ok@acme.dev, #eng-leads" }),
    ).toEqual({ [RECIPIENTS_FIELD]: "#eng-leads is not an email address." });
    expect(
      validateRoutes({ ...BASELINE, [RECIPIENTS_FIELD]: "a, b" })[RECIPIENTS_FIELD],
    ).toBe("a, b are not email addresses.");
  });

  it("accepts an empty list — the owners and admins receive it", () => {
    expect(validateRoutes({ ...BASELINE, [RECIPIENTS_FIELD]: "  " })).toEqual({});
  });

  it("splits recipients on commas, semicolons and new lines, dropping blanks and repeats", () => {
    expect(parseRecipients(" a@b.dev,\nc@d.dev ; a@b.dev,, ")).toEqual(["a@b.dev", "c@d.dev"]);
    expect(parseRecipients("")).toEqual([]);
  });
});

describe("the patches", () => {
  it("are empty when nothing changed", () => {
    expect(routePatches(BASELINE, BASELINE, ROUTES)).toEqual([]);
  });

  it("send only a moved switch", () => {
    const draft = { ...BASELINE, [enabledField("daily_digest")]: false };

    expect(routePatches(draft, BASELINE, ROUTES)).toEqual([
      { kind: "daily_digest", name: "Daily digest → email", patch: { enabled: false } },
    ]);
  });

  it("send the digest's whole config with the new time", () => {
    const routes = notificationRoutes({
      items: [route("daily_digest", { config: { time: "09:00", recipients: ["ops@acme.dev"] } })],
    });
    const baseline = routesBaseline(routes);

    expect(routePatches({ ...baseline, [TIME_FIELD]: "07:30" }, baseline, routes)).toEqual([
      {
        kind: "daily_digest",
        name: "Daily digest → email",
        patch: { config: { time: "07:30", recipients: ["ops@acme.dev"] } },
      },
    ]);
  });

  it("send the weekly route's whole config with the new recipients", () => {
    const draft = { ...BASELINE, [RECIPIENTS_FIELD]: "a@acme.dev, b@acme.dev" };

    expect(routePatches(draft, BASELINE, ROUTES)).toEqual([
      {
        kind: "weekly_insights",
        name: "Weekly insights report → email",
        patch: { config: { weekday: "monday", recipients: ["a@acme.dev", "b@acme.dev"] } },
      },
    ]);
  });

  it("omit the recipients key when the list is emptied", () => {
    const [patch] = routePatches({ ...BASELINE, [RECIPIENTS_FIELD]: "" }, BASELINE, ROUTES);

    expect(patch.patch).toEqual({ config: { weekday: "monday" } });
    expect(patch.patch.config).not.toHaveProperty("recipients");
  });

  it("carry a switch and a config in one patch, in the card's order", () => {
    const draft = {
      ...BASELINE,
      [RECIPIENTS_FIELD]: "",
      [enabledField("weekly_insights")]: false,
      [TIME_FIELD]: "06:00",
    };

    expect(routePatches(draft, BASELINE, ROUTES).map((one) => [one.kind, one.patch])).toEqual([
      ["daily_digest", { config: { time: "06:00" } }],
      ["weekly_insights", { enabled: false, config: { weekday: "monday" } }],
    ]);
  });
});

describe("refusals", () => {
  it("print a locked route's reason from the service's details", () => {
    expect(
      routeRefusal("notification_route_locked", "Locked.", { reason: "connect PagerDuty first" }),
    ).toBe("This route is locked and cannot be switched on: connect PagerDuty first.");
  });

  it("fall back to the service's sentence, then to the card's", () => {
    expect(routeRefusal("notification_route_locked", "Locked.", {})).toBe("Locked.");
    expect(routeRefusal("forbidden_role", "Owners and admins only.", null)).toBe(
      "Owners and admins only.",
    );
    expect(routeRefusal("unknown", "", undefined)).toBe(ROUTE_SAVE_FAILED);
  });

  it("say what landed and what did not", () => {
    expect(routesNotSaved([], "Daily digest → email", "No.")).toBe(
      `${ROUTES_NOT_SAVED} Daily digest → email: No.`,
    );
    expect(routesNotSaved(["Daily digest → email"], "Weekly insights report → email", "No.")).toBe(
      "Saved: Daily digest → email. Not saved — Weekly insights report → email: No.",
    );
  });

  it("route config.time to the digest's time and config.recipients to the weekly recipients", () => {
    expect(
      routeFieldErrors("daily_digest", { fields: { "config.time": ["time must be HH:MM"] } }),
    ).toEqual({ [TIME_FIELD]: "time must be HH:MM" });
    expect(
      routeFieldErrors("weekly_insights", {
        fields: { "config.recipients.1": ["not an address"], "config.recipients": "too many" },
      }),
    ).toEqual({ [RECIPIENTS_FIELD]: "not an address" });
  });

  it("leave a field the card has no control for to the sentence", () => {
    expect(
      routeFieldErrors("weekly_insights", { fields: { "config.time": ["bad"] } }),
    ).toEqual({});
    expect(routeFieldErrors("daily_digest", null)).toEqual({});
    expect(routeFieldErrors("daily_digest", { fields: "nope" })).toEqual({});
    expect(routeFieldErrors("daily_digest", { fields: { "config.time": [] } })).toEqual({});
  });
});
