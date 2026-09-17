import { describe, expect, it } from "vitest";

import {
  DRILL_THROUGH_ISSUE,
  DRILL_THROUGH_NOTE,
  ESTIMATOR_FOOTNOTE,
  healthMeters,
  lastRunNote,
  lastRunPhrase,
  openTag,
  staleLabel,
} from "@/app/planning/health";

import { SEEDED_READ_AT, emptyHealth, seededHealth } from "../helpers/planning";

/**
 * The Backlog Health card's judgements (AM.3, #285) over AL.5's payload (#281).
 *
 * The seed is built so the mockup's figures fall out of the obvious aggregates — `42 open`,
 * `38/42 · 4 · 6` — so these cases are mostly *that the card reports what it was given*, plus the
 * two things it decides for itself: which denominator each bar is a fraction of, and how the
 * nightly footnote's last run is said.
 */

/** The instant the seeded page is read at. */
const NOW = new Date(SEEDED_READ_AT);

/** The meters, by id. */
function metersOf(health = seededHealth()) {
  return new Map(healthMeters(health).map((meter) => [meter.id, meter]));
}

describe("the head tag", () => {
  it("is the mockup's `42 open`", () => {
    expect(openTag(42)).toBe("42 open");
  });

  it("says zero for an empty workspace rather than nothing", () => {
    expect(openTag(0)).toBe("0 open");
  });
});

describe("the meters", () => {
  it("are the mockup's three, in its order", () => {
    expect(healthMeters(seededHealth()).map((meter) => meter.id)).toEqual([
      "sized",
      "blocked",
      "stale",
    ]);
  });

  it("report the seed's own figures", () => {
    const meters = metersOf();

    expect(meters.get("sized")?.value).toBe("38/42");
    expect(meters.get("blocked")?.value).toBe("4");
    expect(meters.get("stale")?.value).toBe("6");
  });

  it("take the mockup's hues — sized is the one where more is better", () => {
    const meters = metersOf();

    expect(meters.get("sized")?.tone).toBe("ok");
    expect(meters.get("blocked")?.tone).toBe("warn");
    expect(meters.get("stale")?.tone).toBe("err");
  });

  // The mockup draws 4 of 42 at 10% and 6 of 42 at 14%, which is what fixes the denominators:
  // sized is out of its own total, the other two are out of the open backlog.
  it("fill sized out of its total and the rest out of the open backlog", () => {
    const meters = metersOf();

    expect(meters.get("sized")?.fill).toBeCloseTo(0.9, 2);
    expect(meters.get("blocked")?.fill).toBeCloseTo(0.1, 2);
    expect(meters.get("stale")?.fill).toBeCloseTo(0.14, 2);
  });

  it("draws an empty bar rather than dividing by zero", () => {
    for (const meter of healthMeters(emptyHealth())) expect(meter.fill).toBe(0);
  });

  it("keeps every zero row, so *none blocked* is visible rather than absent", () => {
    const meters = healthMeters(emptyHealth());

    expect(meters).toHaveLength(3);
    expect(meters.map((meter) => meter.value)).toEqual(["0/0", "0", "0"]);
  });

  it("clamps a figure that would draw past its own track", () => {
    const impossible = seededHealth({
      open: 10,
      blocked: { count: 99, filter: { state: "open", blocked: true } },
    });

    expect(metersOf(impossible).get("blocked")?.fill).toBe(1);
  });

  it("announces each bar in words, since the caption beside it is hidden", () => {
    for (const meter of healthMeters(seededHealth())) {
      expect(meter.valueText).toMatch(/\d/);
      expect(meter.valueText.length).toBeGreaterThan(meter.value.length);
    }
  });
});

describe("the stale threshold", () => {
  it("is the mockup's `Stale > 30d` at the default", () => {
    expect(staleLabel(30)).toBe("Stale > 30d");
    expect(metersOf().get("stale")?.label).toBe("Stale > 30d");
  });

  // `OURO_BACKLOG_STALE_DAYS` is configurable, so the label is the payload's, not the mockup's.
  it("follows a deployment that counts staleness sooner", () => {
    const fortnight = seededHealth({
      stale: { count: 6, thresholdDays: 14, filter: { state: "open", staleDays: 14 } },
    });

    expect(metersOf(fortnight).get("stale")?.label).toBe("Stale > 14d");
    expect(metersOf(fortnight).get("stale")?.valueText).toContain("14 days");
  });
});

describe("the nightly footnote", () => {
  it("is the mockup's sentence, verbatim", () => {
    expect(ESTIMATOR_FOOTNOTE).toBe("Estimator re-runs nightly on unsized issues.");
  });

  it("says when the job last ran, and that it succeeded", () => {
    expect(lastRunPhrase(seededHealth().reestimation.lastRun, NOW)).toBe("last run 9h 46m ago ✓");
  });

  it("marks a failed run and a running one differently", () => {
    const run = seededHealth().reestimation.lastRun!;

    expect(lastRunPhrase({ ...run, status: "failed" }, NOW)).toContain("✗");
    expect(lastRunPhrase({ ...run, status: "running" }, NOW)).toContain("…");
  });

  it("says nothing has run rather than implying a run that never happened", () => {
    expect(lastRunPhrase(null, NOW)).toBe("not run yet");
  });

  // The claim the footnote makes has to be checkable — that is the whole point of the tooltip.
  it("carries the schedule, the outcome and this workspace's counts in its tooltip", () => {
    const note = lastRunNote(seededHealth());

    expect(note).toContain("02:00 UTC");
    expect(note).toContain("within 30 minutes");
    expect(note).toContain("up to 100 tickets");
    expect(note).toContain("succeeded");
    expect(note).toContain("4 unsized tickets found here");
    expect(note).toContain("4 queued");
  });

  it("names the schedule, and the absence of a run, before the first night", () => {
    const note = lastRunNote(emptyHealth());

    expect(note).toContain("02:00 UTC");
    expect(note).toContain("has not run yet");
    expect(note).not.toContain("succeeded");
  });

  it("pads a single-digit hour, so a schedule reads as a clock time", () => {
    const early = seededHealth({
      reestimation: {
        schedule: { hourUtc: 2, jitterMinutes: 30, batchLimit: 100 },
        lastRun: null,
      },
    });

    expect(lastRunNote(early)).toContain("at 02:00 UTC");
  });
});

describe("the drill-through", () => {
  // Deferred rather than linked: these counts are over the canonical tickets and today's intake
  // list is over the GitHub mirror, so a link would land on rows that are not the ones counted.
  it("names the issue that will build the filtered view", () => {
    expect(DRILL_THROUGH_ISSUE).toBe(968);
    expect(DRILL_THROUGH_NOTE).toContain("#968");
  });

  it("says why, rather than only saying *soon*", () => {
    expect(DRILL_THROUGH_NOTE).toContain("canonical tickets");
    expect(DRILL_THROUGH_NOTE).toContain("mirror");
  });
});
