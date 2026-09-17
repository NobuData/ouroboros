import { describe, expect, it } from "vitest";

import {
  IMPORT_JIRA_SOON_NOTE,
  NEW_ROADMAP_ROLE_REASON,
  PLANNING_EYEBROW,
  PLANNING_SUBLINE,
  PLANNING_TITLE,
  ROADMAP_REGION_ID,
  ROADMAP_TITLE,
  newRoadmapReason,
  roadmapTitle,
} from "@/app/planning/view";
import { GENERATOR_TITLE_ID } from "@/app/planning/generator";
import { HEALTH_TITLE_ID } from "@/app/planning/health";
import { SYNC_TITLE_ID } from "@/app/planning/sync";

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
  // AM.3 (#285) built the side column, so the placeholder `SIDE_REGIONS` retired with it. What
  // is left to hold is that the four cards still take four distinct heading ids.
  it("give every region a distinct heading id", () => {
    const ids = [GENERATOR_TITLE_ID, SYNC_TITLE_ID, HEALTH_TITLE_ID, ROADMAP_REGION_ID];

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
