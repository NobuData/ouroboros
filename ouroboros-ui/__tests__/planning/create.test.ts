import { describe, expect, it } from "vitest";

import {
  CREATE_FAILED,
  CREATE_INVALID,
  CREATE_RANGE_INVALID,
  CREATE_READ_ONLY,
  MAX_NAME_LENGTH,
  MAX_WINDOW_LENGTH,
  NAME_TOO_LONG,
  NEEDS_EPIC_NAME,
  NEEDS_RANGE,
  NEEDS_ROADMAP_NAME,
  NEEDS_SHORT_WINDOW,
  RANGE_BACKWARDS,
  RANGE_HALF,
  type RoadmapDraft,
  createBody,
  createFailure,
  draftProblems,
  nameError,
  nameProblem,
  openingDraft,
  rangeError,
  rangeProblem,
  submitReason,
  windowProblem,
} from "@/app/planning/create";

import { EMPTY_ROADMAP, seededRoadmap } from "../helpers/planning";

/**
 * The **New roadmap** dialog's judgements (#283): a roadmap is named on its first epic, the months
 * are a forwards pair or nothing, and a refusal says nothing was created.
 */

/** A ready draft. */
const READY: RoadmapDraft = {
  roadmapName: "Helios 3.0",
  roadmapWindow: "Q1 2027",
  epicName: "Secure boot",
  startMonth: "2027-01",
  endMonth: "2027-03",
};

describe("openingDraft", () => {
  it("opens empty for a workspace with no roadmap, or none that could be read", () => {
    const empty = { roadmapName: "", roadmapWindow: "", epicName: "", startMonth: "", endMonth: "" };

    expect(openingDraft(EMPTY_ROADMAP)).toEqual(empty);
    expect(openingDraft(null)).toEqual(empty);
  });

  it("fills in an existing head's name and window, so the new epic joins the roadmap in force", () => {
    expect(openingDraft(seededRoadmap())).toMatchObject({
      roadmapName: "Helios 2.1",
      roadmapWindow: "Q3–Q4 2026",
      epicName: "",
    });
  });
});

describe("the boxes", () => {
  it("require a name, trimmed, within the contract's ceiling", () => {
    expect(nameProblem("")).toBe("empty");
    expect(nameProblem("   ")).toBe("empty");
    expect(nameProblem("x".repeat(MAX_NAME_LENGTH))).toBeNull();
    expect(nameProblem("x".repeat(MAX_NAME_LENGTH + 1))).toBe("long");
  });

  it("say nothing under an empty name, and the ceiling under a long one", () => {
    expect(nameError("empty")).toBeUndefined();
    expect(nameError(null)).toBeUndefined();
    expect(nameError("long")).toBe(NAME_TOO_LONG);
  });

  it("allow an empty window, and refuse one past its ceiling", () => {
    expect(windowProblem("")).toBeNull();
    expect(windowProblem("x".repeat(MAX_WINDOW_LENGTH))).toBeNull();
    expect(windowProblem("x".repeat(MAX_WINDOW_LENGTH + 1))).toBe("long");
  });

  it("take both months or neither, forwards, in YYYY-MM", () => {
    expect(rangeProblem("", "")).toBeNull();
    expect(rangeProblem("2026-07", "")).toBe("half");
    expect(rangeProblem("", "2026-07")).toBe("half");
    expect(rangeProblem("2026-7", "2026-09")).toBe("shape");
    expect(rangeProblem("2026-13", "2026-12")).toBe("shape");
    expect(rangeProblem("2026-09", "2026-07")).toBe("backwards");
    expect(rangeProblem("2026-07", "2026-07")).toBeNull();
    expect(rangeProblem("2026-12", "2027-01")).toBeNull();
  });

  it("draw a range's problem under the months", () => {
    expect(rangeError(null)).toBeUndefined();
    expect(rangeError("half")).toBe(RANGE_HALF);
    expect(rangeError("shape")).toBe(RANGE_HALF);
    expect(rangeError("backwards")).toBe(RANGE_BACKWARDS);
  });
});

describe("submitReason", () => {
  it("is undefined for a ready draft, with or without a range", () => {
    expect(submitReason(draftProblems(READY))).toBeUndefined();
    expect(submitReason(draftProblems({ ...READY, startMonth: "", endMonth: "" }))).toBeUndefined();
  });

  it("names the first thing missing, top of the form first", () => {
    const blank = { roadmapName: "", roadmapWindow: "x".repeat(99), epicName: "", startMonth: "2026-07", endMonth: "" };

    expect(submitReason(draftProblems(blank))).toBe(NEEDS_ROADMAP_NAME);
    expect(submitReason(draftProblems({ ...blank, roadmapName: "R" }))).toBe(NEEDS_SHORT_WINDOW);
    expect(submitReason(draftProblems({ ...blank, roadmapName: "R", roadmapWindow: "" }))).toBe(
      NEEDS_EPIC_NAME,
    );
    expect(
      submitReason(draftProblems({ ...blank, roadmapName: "R", roadmapWindow: "", epicName: "E" })),
    ).toBe(NEEDS_RANGE);
  });
});

describe("createBody", () => {
  it("sends a scoped epic with its months and the roadmap's name and window, trimmed", () => {
    expect(createBody({ ...READY, roadmapName: " Helios 3.0 ", epicName: " Secure boot " })).toEqual({
      name: "Secure boot",
      roadmapName: "Helios 3.0",
      roadmapWindow: "Q1 2027",
      startMonth: "2027-01",
      endMonth: "2027-03",
    });
  });

  it("sends an epic with no months as the unscoped lane", () => {
    expect(createBody({ ...READY, startMonth: "", endMonth: "" })).toEqual({
      name: "Secure boot",
      roadmapName: "Helios 3.0",
      roadmapWindow: "Q1 2027",
      startMonth: null,
      endMonth: null,
      status: "unscoped",
    });
  });

  it("leaves an empty window out rather than sending the empty string the contract refuses", () => {
    expect(createBody({ ...READY, roadmapWindow: "  " })).not.toHaveProperty("roadmapWindow");
  });
});

describe("createFailure", () => {
  it("tells a member the roadmap is not theirs to change", () => {
    expect(createFailure({ code: "forbidden", message: "no", details: {} })).toEqual({
      message: CREATE_READ_ONLY,
    });
  });

  it("puts a range refusal under the months", () => {
    expect(
      createFailure({ code: "epic_month_range_invalid", message: "backwards", details: {} }),
    ).toEqual({ message: CREATE_RANGE_INVALID, range: RANGE_BACKWARDS });
  });

  it("says a malformed body could not be saved", () => {
    expect(createFailure({ code: "validation_failed", message: "bad", details: {} })).toEqual({
      message: CREATE_INVALID,
    });
  });

  it("keeps the service's own sentence after the product's for anything else", () => {
    expect(
      createFailure({ code: "internal_error", message: "The service failed.", details: {} }),
    ).toEqual({ message: `${CREATE_FAILED} The service failed.` });
  });

  it("ends every refusal on nothing having been created", () => {
    for (const message of [CREATE_READ_ONLY, CREATE_RANGE_INVALID, CREATE_INVALID, CREATE_FAILED]) {
      expect(message).toMatch(/Nothing was created\.$/);
    }
  });
});
