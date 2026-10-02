import { describe, expect, it } from "vitest";

import type { InsightsDigest } from "@/app/api/insights";
import {
  MAIL_UNCONFIGURED,
  SAVING,
  previewSubject,
  scheduleLine,
  toggleReason,
} from "@/app/insights/digest-view";

/** The weekly-digest sheet's decisions (#447). */

/**
 * A digest as the service answers it.
 *
 * @param over What differs.
 * @returns The digest.
 */
function digest(over: Partial<InsightsDigest> = {}): InsightsDigest {
  return {
    subscribed: false,
    recipient: "ada@example.com",
    schedule: { weeklyDay: 1, weeklyTime: "09:00", timezone: "UTC", nextRunAt: "2026-08-10T09:00:00.000Z" },
    mail: { transport: "smtp" },
    ...over,
  };
}

describe("scheduleLine", () => {
  it("says when, in which zone, to whom and when next", () => {
    expect(scheduleLine(digest())).toBe("Sent Mondays at 09:00 UTC to ada@example.com. Next: Aug 10.");
  });

  it("names Sunday as ISO day seven", () => {
    expect(scheduleLine(digest({ schedule: { ...digest().schedule, weeklyDay: 7 } }))).toContain("Sent Sundays");
  });
});

describe("toggleReason", () => {
  it("lets a reader subscribe where mail can be sent", () => {
    expect(toggleReason(digest(), false)).toBeUndefined();
  });

  it("refuses the opt-in where it cannot, and says what an operator sets", () => {
    expect(toggleReason(digest({ mail: { transport: "none" } }), false)).toBe(MAIL_UNCONFIGURED);
  });

  it("always lets a subscribed reader stop — even with no mail server", () => {
    expect(toggleReason(digest({ subscribed: true, mail: { transport: "none" } }), false)).toBeUndefined();
  });

  it("holds the toggle while a change is saving", () => {
    expect(toggleReason(digest(), true)).toBe(SAVING);
  });
});

describe("previewSubject", () => {
  it("is the subject as the inbox shows it", () => {
    expect(
      previewSubject({
        subject: "Insights · 27 PRs merged",
        html: "<html></html>",
        text: "",
        window: { from: "2026-08-02", to: "2026-08-08" },
        contentVersion: 1,
      }),
    ).toBe("Subject: Insights · 27 PRs merged");
  });
});
