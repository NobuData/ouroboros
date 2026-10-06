import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACTOR_GLYPHS,
  BASIS_LINES,
  DEPLOYMENT_NOTES,
  FABRICATED_AGGREGATE,
  MEASURED_GLYPH,
  TIMELINE_TONES,
  basisLine,
  claimNote,
  estimatorAffix,
  isAggregateFree,
  rowAffix,
  rowText,
  timelineRows,
  timelineTime,
} from "@/app/get-started/defaults-view";

import {
  FIRST_ISSUE_READ_AT,
  defaultRow,
  estimatorStatus,
  genericTimeline,
  hostedRunnerRow,
  managedKeysRow,
  mergingDefaults,
  mergingTimeline,
  projectedTimeline,
  reassureClaim,
  saasDefaults,
  selfHostedDefaults,
} from "../helpers/onboarding";

/**
 * The right column's pure rules (#394): the rows' sentences and affixes — the estimator's real
 * last run — the timeline's times, treatments and the live-upgrade slot, the claims' mechanism
 * notes, and the O8 gate over every word this module and its fixtures carry.
 */

const NOW = new Date(FIRST_ISSUE_READ_AT);

describe("the defaults rows", () => {
  it("joins a row to its link — a destination with the arrow, a phrase with the dash", () => {
    expect(rowText(defaultRow({ key: "models" }))).toBe("Models: bring your own keys → Providers");
    expect(rowText(defaultRow({ key: "build" }))).toBe("Build: enroll a runner → Build Farm");
    expect(rowText(managedKeysRow())).toBe("Models: managed keys with $5 trial credit — bring your own keys anytime");
    expect(rowText(hostedRunnerRow())).toBe("Build: hosted runner for your first loops — enroll your own farm later");
    expect(rowText(defaultRow({ key: "estimator" }))).toBe("Estimator pre-sizes your backlog overnight");
  });

  it("affixes the estimator row with the real nightly job's last run and schedule", () => {
    const affix = estimatorAffix(estimatorStatus(), NOW);

    expect(affix).toMatch(/^last run \S+ ago ✓ · nightly at 02:00 UTC$/);
    expect(rowAffix(defaultRow({ key: "estimator" }), NOW)).toBe(affix);
  });

  it("says the job has not run yet rather than inventing a time — the honest empty row", () => {
    expect(estimatorAffix(estimatorStatus({ lastRun: null }), NOW)).toBe("not run yet · nightly at 02:00 UTC");
    expect(estimatorAffix(estimatorStatus({ schedule: { hourUtc: 23, jitterMinutes: 0, batchLimit: 10 } }), NOW)).toMatch(
      /nightly at 23:00 UTC$/,
    );
  });

  it("affixes the Slack row with what it waits for, and nothing to the rest", () => {
    expect(rowAffix(defaultRow({ key: "slack" }), NOW)).toBe("arrives with ChatOps");
    expect(rowAffix(defaultRow({ key: "models" }), NOW)).toBeNull();
    expect(rowAffix(managedKeysRow(), NOW)).toBeNull();
  });

  it("explains the row set by the deployment, without promising a pool", () => {
    expect(DEPLOYMENT_NOTES.self_hosted).toMatch(/self-hosted/);
    expect(DEPLOYMENT_NOTES.saas).toMatch(/declares/);
  });
});

describe("the timeline", () => {
  it("prints the origin, the estimate's minutes, and nothing for a row with no time", () => {
    expect(timelineTime(0)).toBe("0:00");
    expect(timelineTime(4)).toBe("~4 min");
    expect(timelineTime(90)).toBe("~90 min");
    expect(timelineTime(null)).toBeNull();
  });

  it("draws the seeded projection: every row projected, the loop's rows filled, the person's rings, the end in its own treatment", () => {
    const rows = timelineRows(projectedTimeline());

    expect(rows.map((row) => row.time)).toEqual(["0:00", null, "~4 min", null, null]);
    expect(rows.map((row) => row.tone)).toEqual(["loop", "loop", "loop", "you", "end"]);
    expect(rows.map((row) => row.glyph)).toEqual(["●", "●", "●", "○", "○"]);
    expect(rows.every((row) => row.projected)).toBe(true);
    expect(rows[4]!.text).toBe("merge — only when you say so; dry-run never merges");
    expect(TIMELINE_TONES.merge).toBe("end");
    expect(ACTOR_GLYPHS.loop).toBe(MEASURED_GLYPH);
  });

  it("keeps the merge row as the end whoever acts — dry-run off reads as the workflow's decision", () => {
    const rows = timelineRows(mergingTimeline());

    expect(rows[2]!.text).toBe("pull request opens");
    expect(rows[4]).toMatchObject({ tone: "end", glyph: "●", text: "merge — as the workflow's final step decides" });
  });

  it("prints no time beyond the origin when the issue carries no estimate", () => {
    const rows = timelineRows(genericTimeline());

    expect(rows.map((row) => row.time)).toEqual(["0:00", null, null, null, null]);
    expect(rows[0]!.text).toBe("loop starts on your first issue");
    expect(basisLine(genericTimeline(), rows)).toBe(BASIS_LINES.none);
  });

  it("is the live-upgrade slot: a measured row prints its own time, fills its node and drops the label", () => {
    const rows = timelineRows(projectedTimeline(), [
      { key: "loop_starts", at: "0:00" },
      { key: "plan_posted", at: "0:48", text: "plan posted to the issue" },
    ]);

    expect(rows[0]).toMatchObject({ time: "0:00", projected: false, glyph: "●" });
    expect(rows[1]).toMatchObject({ time: "0:48", text: "plan posted to the issue", projected: false, glyph: "●" });
    expect(rows[1]!.tone).toBe("loop");
    expect(rows.slice(2).every((row) => row.projected)).toBe(true);
    expect(basisLine(projectedTimeline(), rows)).toBe(BASIS_LINES.issue_estimate);
  });

  it("drops the basis line once every row is measured — there is no projection left to explain", () => {
    const rows = timelineRows(
      projectedTimeline(),
      projectedTimeline().rows.map((row) => ({ key: row.key, at: "1:00" })),
    );

    expect(rows.some((row) => row.projected)).toBe(false);
    expect(basisLine(projectedTimeline(), rows)).toBeNull();
  });
});

describe("the reassure claims", () => {
  it("names each claim's mechanism and the issue that delivered it", () => {
    expect(claimNote(reassureClaim("draft_only"))).toBe(
      "Because: The dry-run policy is on: loops open draft pull requests, and merging is refused until an owner or admin turns it off. (#382)",
    );
    expect(claimNote(reassureClaim("vault"))).toMatch(/envelope-encrypted .* \(#222\)$/);
  });
});

describe("the O8 gate", () => {
  it("recognises the shape of an aggregate claim and passes an honest sentence", () => {
    expect(isAggregateFree("Average first-loop time across teams: 4m 10s.")).toBe(false);
    expect(isAggregateFree("92% of teams start here")).toBe(false);
    expect(isAggregateFree("Typically done in 4 minutes")).toBe(false);
    expect(isAggregateFree("Times are the picked issue's own estimate. Nothing here has been timed yet.")).toBe(true);
    expect(isAggregateFree("last run 10h ago ✓ · nightly at 02:00 UTC")).toBe(true);
    expect(isAggregateFree("Models: managed keys with $5 trial credit")).toBe(true);
  });

  it("is a review gate: no copy of this module and no word of the fixtures is shaped like an aggregate", () => {
    const source = readFileSync(join(import.meta.dirname, "..", "..", "app", "get-started", "defaults-view.ts"), "utf8");
    const copy = [...source.matchAll(/^export const [A-Z_]+ =\s*"([^"]*)";/gm)].map((match) => match[1]!);
    const notes = [...source.matchAll(/^\s+[a-z_]+:\s*"([^"]*)",?$/gm)].map((match) => match[1]!);

    expect(copy.length).toBeGreaterThan(8);
    for (const line of [...copy, ...notes]) expect(line, line).not.toMatch(FABRICATED_AGGREGATE);

    for (const column of [selfHostedDefaults(), saasDefaults(), mergingDefaults()]) {
      expect(JSON.stringify(column), column.deployment).not.toMatch(FABRICATED_AGGREGATE);
    }
  });
});
