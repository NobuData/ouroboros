import { describe, expect, it } from "vitest";

import {
  MEDIAN_LEAD,
  STATS_NONE,
  WAIT_LEAD,
  decisionsSuffix,
  statsMethod,
  statsSentence,
} from "@/app/inbox/stats-view";

import { coldStats, inboxStats } from "../helpers/inbox";

/**
 * The week's stat card's words (BO.5, #470): the service's printing verbatim, the noun after the
 * figure, and a methodology that names answer latency and loop wait apart.
 */

describe("the line under the figure", () => {
  it("is the mockup's sentence from the seeded week", () => {
    expect(statsSentence(inboxStats().display)).toBe("median answer time 41s · loops never waited longer than 6m");
  });

  it("follows the service's printing — the numbers change when the seeds do", () => {
    expect(statsSentence({ decisions: "4", medianAnswer: "2m", maxLoopWait: "1h" })).toBe(
      "median answer time 2m · loops never waited longer than 1h",
    );
  });

  it("is em dashes on a cold workspace, never zeros", () => {
    const sentence = statsSentence(coldStats().display);

    expect(sentence).toBe(`${MEDIAN_LEAD} — · ${WAIT_LEAD} —`);
    expect(sentence).not.toMatch(/\d/);
    expect(STATS_NONE).toBe("—");
  });
});

describe("the noun after the figure", () => {
  it("is plural for the seeded eleven and for a cold week's em dash", () => {
    expect(decisionsSuffix(inboxStats())).toBe(" decisions");
    expect(decisionsSuffix(coldStats())).toBe(" decisions");
  });

  it("is singular for exactly one, by the count rather than the printing", () => {
    expect(decisionsSuffix(inboxStats({ decisions: 1 }))).toBe(" decision");
  });
});

describe("the methodology", () => {
  const method = statsMethod("2026-W40").join(" ");

  it("names the week, in UTC", () => {
    expect(method).toContain("Week 2026-W40, in UTC.");
  });

  it("says answer latency is the median time from asked to answered", () => {
    expect(method).toMatch(/Median answer time is answer latency/);
    expect(method).toMatch(/from when it was asked to when it was answered/);
    expect(method).toMatch(/the middle one/);
  });

  it("says loop wait is the longest span a run sat blocked — and that it is a different measure", () => {
    expect(method).toMatch(/Loop wait is a different measure/);
    expect(method).toMatch(/the longest span any run sat blocked on a decision this week/);
  });

  it("says a snooze stops neither clock", () => {
    expect(method).toMatch(/Snoozed time counts toward both/);
  });
});
