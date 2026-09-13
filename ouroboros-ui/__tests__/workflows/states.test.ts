import { describe, expect, it } from "vitest";

import {
  CANVAS_SOON_NOTE,
  CANVAS_SOON_TITLE,
  DEFINITION_UNREAD,
  EMPTY_SUBLINE,
  EMPTY_TITLE,
  FAILED_SUBLINE,
  FAILED_TITLE,
  MISSING_TITLE,
  READ_ONLY_BODY,
  SEAT_EMPTY_TITLE,
  SEAT_FAILED_NOTE,
  SEAT_MISSING_TITLE,
  SEAT_UNREAD_TITLE,
  missingSubline,
  readOnlyNote,
  seatCopy,
  selectedEntry,
  studioHead,
  studioState,
  unreadSubline,
} from "@/app/workflows/states";

import { READ_AT, railEntry, readings, seededRail, selected } from "../helpers/workflows";

/**
 * The studio's states (#147): which of the five the two reads put the page in, and what the
 * head and the seat say in each.
 *
 * Every case is a judgement about readings, not about rendered text — the screen's suite
 * proves the drawing, this proves the decision.
 */

const NOW = new Date(READ_AT);

describe("deciding the state", () => {
  it("is populated when both reads answered", () => {
    expect(studioState(readings())).toMatchObject({ kind: "populated", entry: railEntry() });
  });

  it("is failed when the rail was refused, whatever else was asked for", () => {
    // A refused rail has no answer to *which workflows exist*, so nothing could be selected.
    expect(
      studioState(readings({ rail: { ok: false, reason: "Down." }, selected: null })),
    ).toEqual({ kind: "failed", reason: "Down." });
  });

  it("is empty when the rail answered with nothing", () => {
    expect(studioState(readings({ rail: { ok: true, value: [] }, selected: null }))).toEqual({
      kind: "empty",
    });
  });

  it("is missing when the URL named a workflow the rail does not hold", () => {
    expect(studioState(readings({ requested: "gone", selected: null }))).toEqual({
      kind: "missing",
      slug: "gone",
    });
  });

  it("is unread when the rail has the workflow and the workflow's own read was refused", () => {
    expect(
      studioState(
        readings({ selected: { entry: railEntry(), detail: { ok: false, reason: "Refused." } } }),
      ),
    ).toEqual({ kind: "unread", entry: railEntry(), reason: "Refused." });
  });

  it("knows which workflow the page is about, in the two states that have one", () => {
    expect(selectedEntry(studioState(readings()))).toEqual(railEntry());
    expect(
      selectedEntry(
        studioState(
          readings({ selected: { entry: railEntry(), detail: { ok: false, reason: "r" } } }),
        ),
      ),
    ).toEqual(railEntry());
    expect(selectedEntry({ kind: "empty" })).toBeNull();
    expect(selectedEntry({ kind: "failed", reason: "r" })).toBeNull();
    expect(selectedEntry({ kind: "missing", slug: "x" })).toBeNull();
  });
});

describe("the head", () => {
  it("prints the workflow's name and the composed subline when populated", () => {
    expect(studioHead(studioState(readings()), NOW)).toEqual({
      title: "standard-fix",
      subline:
        "Runs when a sized issue with effort ≤ M is queued. Last edited 2h ago · v14 · used by 42% of runs.",
    });
  });

  it("names the failure, and points at the banner, for a refused rail", () => {
    expect(studioHead({ kind: "failed", reason: "Down." }, NOW)).toEqual({
      title: FAILED_TITLE,
      subline: FAILED_SUBLINE,
    });
  });

  it("says there are no workflows yet, and where one begins", () => {
    expect(studioHead({ kind: "empty" }, NOW)).toEqual({ title: EMPTY_TITLE, subline: EMPTY_SUBLINE });
    expect(EMPTY_SUBLINE).toMatch(/#159/);
  });

  it("names the slug it was asked for and could not find", () => {
    expect(studioHead({ kind: "missing", slug: "gone" }, NOW)).toEqual({
      title: MISSING_TITLE,
      subline: missingSubline("gone"),
    });
    expect(missingSubline("gone")).toContain('"gone"');
  });

  it("has a sentence for the missing state even when nothing was asked for", () => {
    // Total rather than trusted: the landing always selects, but the type carries the null.
    expect(missingSubline(null)).toBe("Nothing is selected. Pick a workflow from the rail.");
  });

  it("prints the rail's facts and no guess for a workflow whose own read was refused", () => {
    // The name, the version and the usage are the rail's and are still true; the trigger and
    // the draft's stamp are the refused read's and are not invented.
    const entry = railEntry();

    expect(studioHead({ kind: "unread", entry, reason: "Refused." }, NOW)).toEqual({
      title: "standard-fix",
      subline: unreadSubline(entry),
    });
    expect(unreadSubline(entry)).toBe(`${DEFINITION_UNREAD} v14 · used by 42% of runs.`);
    expect(unreadSubline(railEntry({ currentVersion: null }))).toBe(
      `${DEFINITION_UNREAD} not published · used by 42% of runs.`,
    );
  });
});

describe("the seat", () => {
  it("says the canvas is coming, and which issues bring it, on a populated page", () => {
    expect(seatCopy(studioState(readings()))).toEqual({
      title: CANVAS_SOON_TITLE,
      note: CANVAS_SOON_NOTE,
    });
    expect(CANVAS_SOON_NOTE).toMatch(/#148/);
    expect(CANVAS_SOON_NOTE).toMatch(/#150/);
  });

  it("points up at the banner rather than repeating the reason, for a refused rail", () => {
    // DASH-I.7's rule: the banner says why, once; the seat says what is missing.
    const copy = seatCopy({ kind: "failed", reason: "Down." });

    expect(copy.note).toBe(SEAT_FAILED_NOTE);
    expect(copy.note).not.toContain("Down.");
  });

  it("wears different copy for empty, missing and unread, because they are different facts", () => {
    const titles = [
      seatCopy({ kind: "empty" }).title,
      seatCopy({ kind: "missing", slug: "gone" }).title,
      seatCopy({ kind: "unread", entry: railEntry(), reason: "r" }).title,
    ];

    expect(titles).toEqual([SEAT_EMPTY_TITLE, SEAT_MISSING_TITLE, SEAT_UNREAD_TITLE]);
    expect(new Set(titles).size).toBe(3);
  });
});

describe("the read-only note", () => {
  it("names the role with the article it takes", () => {
    expect(readOnlyNote("member").head).toBe("Viewing the studio as a member.");
    expect(readOnlyNote("viewer").head).toBe("Viewing the studio as a viewer.");
    expect(readOnlyNote("admin").head).toBe("Viewing the studio as an admin.");
    expect(readOnlyNote("owner").head).toBe("Viewing the studio as an owner.");
  });

  it("says what the role means here, the same for every role", () => {
    for (const role of ["owner", "admin", "member", "viewer"] as const) {
      expect(readOnlyNote(role).body).toBe(READ_ONLY_BODY);
    }
  });
});

describe("the fixtures these decisions are made over", () => {
  it("are the seeded rail's five, in the mockup's order, with the paused one last", () => {
    // What the screen's parity assertion rests on.
    const rail = seededRail();

    expect(rail.map((entry) => entry.slug)).toEqual([
      "standard-fix",
      "feature-loop",
      "deps-refresh",
      "docs-loop",
      "hotfix-p0",
    ]);
    expect(rail.map((entry) => entry.status)).toEqual([
      "active",
      "active",
      "active",
      "active",
      "paused",
    ]);
    expect(selected().entry.slug).toBe("standard-fix");
  });
});
