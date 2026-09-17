import { describe, expect, it } from "vitest";

import {
  IMPORT_JIRA_SOON_NOTE,
  NEW_ROADMAP_ROLE_REASON,
  PLANNING_EYEBROW,
  PLANNING_SUBLINE,
  PLANNING_TITLE,
  ROADMAP_GANTT_NOTE,
  ROADMAP_TITLE,
  SIDE_REGIONS,
  laneCount,
  newRoadmapReason,
  roadmapTitle,
} from "@/app/planning/view";
import { GENERATOR_TITLE_ID } from "@/app/planning/generator";

import { EMPTY_ROADMAP, seededRoadmap } from "../helpers/planning";

/**
 * The planning frame's copy and judgements (#283).
 */

describe("the head", () => {
  it("is mockup 09's copy, verbatim", () => {
    expect(PLANNING_EYEBROW).toBe("Planning");
    expect(PLANNING_TITLE).toBe("Describe the work. Ouroboros writes the tickets.");
    expect(PLANNING_SUBLINE).toBe(
      "Draft epics and tickets straight into GitHub Issues, Jira, or Linear — sized by the " +
        "estimator, wired with dependencies, and queued for the loop the moment you approve them.",
    );
  });

  it("names the issue that builds Import from Jira", () => {
    expect(IMPORT_JIRA_SOON_NOTE).toMatch(/arrives with #291/);
  });

  it("makes New roadmap inert for a reader who may not change the roadmap, and only for them", () => {
    expect(newRoadmapReason(true)).toBeUndefined();
    expect(newRoadmapReason(false)).toBe(NEW_ROADMAP_ROLE_REASON);
  });
});

describe("the regions", () => {
  it("name the issues that fill them", () => {
    expect(SIDE_REGIONS.map((region) => region.title)).toEqual(["Tracker sync", "Backlog health"]);
    for (const region of SIDE_REGIONS) expect(region.note).toMatch(/#285/);
    expect(ROADMAP_GANTT_NOTE).toMatch(/#286/);
  });

  it("give every region a distinct heading id", () => {
    const ids = [GENERATOR_TITLE_ID, ...SIDE_REGIONS.map((region) => region.id)];

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("roadmapTitle", () => {
  it("is the mockup's `Roadmap — Helios 2.1` for a named roadmap", () => {
    expect(roadmapTitle({ ok: true, value: seededRoadmap() })).toBe("Roadmap — Helios 2.1");
  });

  it("is plain `Roadmap` when nothing is named, or nothing could be read", () => {
    expect(roadmapTitle({ ok: true, value: EMPTY_ROADMAP })).toBe(ROADMAP_TITLE);
    expect(roadmapTitle({ ok: false, reason: "down" })).toBe(ROADMAP_TITLE);
  });
});

describe("laneCount", () => {
  it("is singular for one epic and plural otherwise", () => {
    expect(laneCount(1)).toBe("1 epic planned.");
    expect(laneCount(5)).toBe("5 epics planned.");
  });
});
