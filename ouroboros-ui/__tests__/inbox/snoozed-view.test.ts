import { describe, expect, it } from "vitest";

import {
  VIEWER_CANNOT_WAKE,
  WAKE_LABEL,
  WAKING,
  WAKING_NOW,
  wakeLabel,
  wakeReason,
  wakesIn,
} from "@/app/inbox/snoozed-view";
import { VIEWER_CANNOT_SNOOZE } from "@/app/inbox/view";

import { snoozedItem } from "../helpers/inbox";

/** The snoozed section's words (BO.5, #470): the countdown, the wake's name and when it is inert. */

/** 13:20:00 UTC, whole seconds. */
const NOW = Math.floor(Date.parse("2026-10-04T13:20:00.000Z") / 1000);

describe("the countdown", () => {
  it("counts down to the wake time", () => {
    const item = snoozedItem({ snoozedUntil: "2026-10-04T14:02:00.000Z" });

    expect(wakesIn(item, NOW)).toBe("wakes in 42m");
    expect(wakesIn(item, NOW + 41 * 60 + 30)).toBe("wakes in 30s");
  });

  it("says it is waking once the time has come, never a negative", () => {
    const item = snoozedItem({ snoozedUntil: "2026-10-04T13:20:00.000Z" });

    expect(wakesIn(item, NOW)).toBe(WAKING_NOW);
    expect(wakesIn(item, NOW + 600)).toBe(WAKING_NOW);
  });

  it("does not invent a countdown for a wake time it cannot read", () => {
    expect(wakesIn(snoozedItem({ snoozedUntil: "soon" }), NOW)).toBe(WAKING_NOW);
  });
});

describe("Wake now", () => {
  it("names the decision it wakes", () => {
    expect(wakeLabel(snoozedItem())).toBe(`${WAKE_LABEL}: Should the loops trust this fact?`);
  });

  it("is inert for a reader who may not snooze, in the snooze's own words", () => {
    expect(wakeReason(snoozedItem({ snooze: { allowed: false } }), false)).toBe(VIEWER_CANNOT_WAKE);
    expect(VIEWER_CANNOT_WAKE).toBe(VIEWER_CANNOT_SNOOZE);
  });

  it("is inert while a wake is on its way, and pressable otherwise", () => {
    expect(wakeReason(snoozedItem(), true)).toBe(WAKING);
    expect(wakeReason(snoozedItem(), false)).toBeUndefined();
  });
});
