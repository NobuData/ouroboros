import {
  CORE_DATA_CLASSES,
  LOOP_DATA_CLASSES,
  RETENTION_DEFAULT_DAYS,
  boundsFor,
  checkTier,
  cutoffAt,
  isDataClass,
  isLoopDataClass,
  retainedUntil,
  tierDaysOf,
} from "./retention.policy";

/**
 * The tiers' rules (#482): the classes, the defaults the sweeps had before, the bounds, and the
 * one cutoff formula.
 */
describe("the retention policy", () => {
  it("has the four core classes, three of them loop data", () => {
    expect(CORE_DATA_CLASSES).toEqual(["transcripts", "build_logs", "artifacts", "audit"]);
    expect(LOOP_DATA_CLASSES).toEqual(["transcripts", "build_logs", "artifacts"]);
    expect(isLoopDataClass("audit")).toBe(false);
    expect(isLoopDataClass("custom:chat-messages")).toBe(false);
  });

  it("defaults to what the sweeps did before — 30 days of loop data, audit 400", () => {
    expect(RETENTION_DEFAULT_DAYS).toEqual({
      transcripts: 30,
      build_logs: 30,
      artifacts: 30,
      audit: 400,
    });
  });

  it("accepts custom:<slug> in the database's grammar, and nothing else", () => {
    expect(isDataClass("custom:chat-messages")).toBe(true);
    expect(isDataClass("custom:dry_run_artifacts")).toBe(true);
    expect(isDataClass("custom:")).toBe(false);
    expect(isDataClass("custom:Chat")).toBe(false);
    expect(isDataClass(`custom:${"a".repeat(64)}`)).toBe(false);
    expect(isDataClass("everything")).toBe(false);
    expect(isDataClass(7)).toBe(false);
  });

  it("bounds audit at 90–3650 days, loop data at 7–365 and custom classes at 7–3650", () => {
    expect(boundsFor("audit")).toEqual({ floor: 90, ceiling: 3650 });
    for (const dataClass of LOOP_DATA_CLASSES) {
      expect(boundsFor(dataClass)).toEqual({ floor: 7, ceiling: 365 });
    }
    expect(boundsFor("custom:chat-commands")).toEqual({ floor: 7, ceiling: 3650 });
  });

  it("refuses audit below 90 days with a reason the card renders", () => {
    expect(checkTier("audit", 89)).toEqual({
      dataClass: "audit",
      days: 89,
      reason: "below_floor",
      floor: 90,
      ceiling: 3650,
      message: "Retention for audit must be at least 90 days.",
    });
    expect(checkTier("audit", 90)).toBeUndefined();
  });

  it("refuses loop data below 7 days and above a year", () => {
    expect(checkTier("transcripts", 6)?.reason).toBe("below_floor");
    expect(checkTier("build_logs", 7)).toBeUndefined();
    expect(checkTier("artifacts", 365)).toBeUndefined();
    expect(checkTier("artifacts", 366)?.reason).toBe("above_ceiling");
  });

  it("refuses a value that is not whole days", () => {
    expect(checkTier("transcripts", 7.5)?.reason).toBe("not_whole_days");
    expect(checkTier("transcripts", Number.NaN)?.reason).toBe("not_whole_days");
  });

  it("computes the cutoff as now − days and the promise as at + days", () => {
    const now = new Date("2026-10-04T12:00:00.000Z");

    expect(cutoffAt(now, 30)).toEqual(new Date("2026-09-04T12:00:00.000Z"));
    expect(retainedUntil(now, 30)).toEqual(new Date("2026-11-03T12:00:00.000Z"));
  });

  it("reads a cutoff back as the tier it came from (#486)", () => {
    const now = new Date("2026-10-04T12:00:00.000Z");

    expect(tierDaysOf(now, cutoffAt(now, 400))).toBe(400);
    expect(tierDaysOf(now, cutoffAt(now, 89))).toBe(89);
  });
});
