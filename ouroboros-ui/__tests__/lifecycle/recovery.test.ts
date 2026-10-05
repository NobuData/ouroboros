import { describe, expect, it } from "vitest";

import {
  UNDER_A_MINUTE,
  WINDOW_CLOSED,
  WINDOW_UNKNOWN,
  recoveryCountdown,
  recoveryLead,
  recoveryTitle,
  switchLabel,
} from "@/app/lifecycle/recovery";

import { CHANGED_AT, PURGE_AFTER } from "../helpers/lifecycle";

/**
 * The recovery screen's countdown (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)),
 * at each boundary: it rounds down, changes unit under a day and under an hour, and past the
 * close says the window is closed rather than counting below zero.
 */

const CLOSES = Date.parse(PURGE_AFTER);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("recoveryCountdown", () => {
  it("reads 29d 23h a minute after the deletion — the issue's own figure", () => {
    expect(recoveryCountdown(PURGE_AFTER, Date.parse(CHANGED_AT) + MINUTE)).toBe("29d 23h to recover");
  });

  it("reads the whole window at the moment of deletion", () => {
    expect(recoveryCountdown(PURGE_AFTER, Date.parse(CHANGED_AT))).toBe("30d 0h to recover");
  });

  it("rounds down: a countdown never promises time that is not there", () => {
    expect(recoveryCountdown(PURGE_AFTER, CLOSES - (2 * DAY - 1))).toBe("1d 23h to recover");
  });

  it("changes to hours and minutes under a day, exactly at the boundary", () => {
    expect(recoveryCountdown(PURGE_AFTER, CLOSES - DAY)).toBe("1d 0h to recover");
    expect(recoveryCountdown(PURGE_AFTER, CLOSES - (DAY - 1))).toBe("23h 59m to recover");
    expect(recoveryCountdown(PURGE_AFTER, CLOSES - HOUR)).toBe("1h 0m to recover");
  });

  it("changes to minutes under an hour, and says so under a minute", () => {
    expect(recoveryCountdown(PURGE_AFTER, CLOSES - (HOUR - 1))).toBe("59m to recover");
    expect(recoveryCountdown(PURGE_AFTER, CLOSES - MINUTE)).toBe("1m to recover");
    expect(recoveryCountdown(PURGE_AFTER, CLOSES - (MINUTE - 1))).toBe(UNDER_A_MINUTE);
    expect(recoveryCountdown(PURGE_AFTER, CLOSES - 1)).toBe(UNDER_A_MINUTE);
  });

  it("says the window is closed at zero and after, and that a restore may still land", () => {
    expect(recoveryCountdown(PURGE_AFTER, CLOSES)).toBe(WINDOW_CLOSED);
    expect(recoveryCountdown(PURGE_AFTER, CLOSES + DAY)).toBe(WINDOW_CLOSED);
    expect(WINDOW_CLOSED).toBe(
      "recovery window closed — restore is still possible until the purge begins",
    );
  });

  it("claims no figure when the service did not say when the window closes", () => {
    expect(recoveryCountdown(null, CLOSES)).toBe(WINDOW_UNKNOWN);
    expect(recoveryCountdown("soon", CLOSES)).toBe(WINDOW_UNKNOWN);
  });
});

describe("the screen's sentences", () => {
  it("name the workspace and the day the window closes, in UTC", () => {
    expect(recoveryTitle("acme-robotics")).toBe("acme-robotics is scheduled for deletion");
    expect(recoveryLead(PURGE_AFTER)).toBe("Its data is kept until 2026-11-04 (UTC), then destroyed.");
    expect(recoveryLead(null)).toBe("Its data is kept through a 30-day recovery window, then destroyed.");
    expect(switchLabel("ken-personal")).toBe("Open ken-personal");
  });
});
