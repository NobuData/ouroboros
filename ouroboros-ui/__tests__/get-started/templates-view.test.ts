import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  FABRICATED_STATISTIC,
  captionOf,
  effortOf,
  findingLine,
  findingsOf,
  invalidLine,
  isLocked,
  isTemplateSlug,
  lockedReason,
  previousWorkflow,
  reselectConfirm,
  reselectKeeps,
  reselectLink,
  reselectTitle,
  stagesSentence,
  stepPill,
  successLine,
  withSelection,
} from "@/app/get-started/templates-view";

import { instantiated, seededTiles, templateSelection, tile } from "../helpers/onboarding";

/**
 * The template tiles' pure rules (#392): the head's pill, the effort chips, the locked tile's
 * spoken reason, the caption gate (O8), the re-selection's words, the designed error's findings,
 * and the grid with a selection applied.
 */

describe("the head's pill", () => {
  it("says you are here while step 3 is active, done once it is, nothing before", () => {
    expect(stepPill("active")).toEqual({ text: "step 3 · you are here", tone: "accent" });
    expect(stepPill("done")).toEqual({ text: "✓ step 3 done", tone: "ok" });
    expect(stepPill("todo")).toBeNull();
    expect(stepPill(null)).toBeNull();
  });
});

describe("the caption gate (O8)", () => {
  it("keeps a qualitative caption and drops one shaped like a statistic", () => {
    expect(captionOf("recommended first workflow")).toBe("recommended first workflow");
    expect(captionOf("recommended first workflow — 92% of teams start here")).toBeNull();
    expect(captionOf("used by 4 teams")).toBeNull();
    expect(captionOf("")).toBeNull();
    expect(captionOf("   ")).toBeNull();
    expect(captionOf(null)).toBeNull();
  });

  it("is a review gate: no caption of the seeded grid, and no copy of this module, carries a percent sign", () => {
    for (const one of seededTiles().tiles) {
      expect(
        one.caption === null || !FABRICATED_STATISTIC.test(one.caption),
        `${one.slug}: ${String(one.caption)}`,
      ).toBe(true);
    }

    const source = readFileSync(
      join(import.meta.dirname, "..", "..", "app", "get-started", "templates-view.ts"),
      "utf8",
    );
    const copy = [...source.matchAll(/^export const [A-Z_]+ = "([^"]*)";/gm)].map(
      (match) => match[1]!,
    );

    expect(copy.length).toBeGreaterThan(10);
    for (const line of copy) expect(line, line).not.toMatch(/%/);
  });
});

describe("a tile", () => {
  it("turns the service's lower-case sizes into chips, and skips what the chip set lacks", () => {
    expect(["xs", "s", "m", "l", "xl"].map(effortOf)).toEqual(["XS", "S", "M", "L", "XL"]);
    expect(effortOf("XL")).toBe("XL");
    expect(effortOf("xxl")).toBeNull();
  });

  it("is locked only while its gate says so", () => {
    expect(isLocked(tile({ slug: "a" }))).toBe(false);
    expect(isLocked(seededTiles().tiles[3]!)).toBe(true);
    expect(
      isLocked({
        ...seededTiles().tiles[3]!,
        unlock: { ...seededTiles().tiles[3]!.unlock!, locked: false },
      }),
    ).toBe(false);
  });

  it("tells a screen reader its state and the computed reason, in the service's words", () => {
    expect(lockedReason(seededTiles().tiles[3]!.unlock!)).toBe(
      "Locked — 3 of 10 merged loops; unlock after 10 merged loops.",
    );
  });

  it("reads its stages as a sentence", () => {
    expect(stagesSentence(["analyze", "plan", "PR"])).toBe("Stages: analyze, plan, PR.");
    expect(stagesSentence([])).toBe("");
  });
});

describe("a selection's words", () => {
  it("names the template slug grammar", () => {
    expect(isTemplateSlug("quick-fixes")).toBe(true);
    expect(isTemplateSlug("Quick Fixes")).toBe(false);
    expect(isTemplateSlug("-x")).toBe(false);
    expect(isTemplateSlug("a".repeat(65))).toBe(false);
    expect(isTemplateSlug(7)).toBe(false);
  });

  it("says created, or that the existing workflow is used", () => {
    expect(successLine(templateSelection())).toBe("Created Quick fixes.");
    expect(successLine(templateSelection({ created: false }))).toBe(
      "Using Quick fixes, the workflow already made from this template.",
    );
  });

  it("names the refused template and lists each finding with where it is", () => {
    expect(invalidLine(seededTiles().tiles[0]!)).toBe(
      "The Quick fixes template could not be turned into a workflow: its definition did not pass validation.",
    );
    expect(
      findingLine({
        source: "dsl",
        code: "unreachable_node",
        message: "Stage review is unreachable.",
        path: "/nodes/3",
      }),
    ).toBe("dsl · unreachable_node — Stage review is unreachable. (at /nodes/3)");
    expect(
      findingLine({
        source: "registry",
        code: "alias_unknown",
        message: "No alias fast-coder.",
        path: null,
      }),
    ).toBe("registry · alias_unknown — No alias fast-coder.");
  });

  it("reads findings out of a refusal defensively", () => {
    expect(
      findingsOf({
        findings: [
          { source: "dsl", code: "unreachable_node", message: "Unreachable.", path: "/nodes/3" },
          { message: "Just a message." },
          { source: "engine", code: "x" },
          "junk",
          null,
        ],
      }),
    ).toEqual([
      { source: "dsl", code: "unreachable_node", message: "Unreachable.", path: "/nodes/3" },
      { source: "gate", code: "refused", message: "Just a message.", path: null },
    ]);
    expect(findingsOf({})).toEqual([]);
    expect(findingsOf(null)).toEqual([]);
    expect(findingsOf({ findings: "none" })).toEqual([]);
  });
});

describe("re-selection", () => {
  const grid = seededTiles({
    tiles: seededTiles().tiles.map((one) =>
      one.slug === "quick-fixes" ? { ...one, workflow: instantiated() } : one,
    ),
  });

  it("has a workflow to keep only when switching away from a tile whose workflow exists", () => {
    expect(previousWorkflow(grid, grid.tiles[1]!)).toEqual(instantiated());
    // Pressing the selected tile itself, or switching away from a choice with nothing created yet.
    expect(previousWorkflow(grid, grid.tiles[0]!)).toBeNull();
    expect(previousWorkflow(seededTiles(), seededTiles().tiles[1]!)).toBeNull();
    expect(
      previousWorkflow(
        seededTiles({
          selectedTemplate: null,
          tiles: seededTiles().tiles.map((one) => ({ ...one, selected: false })),
        }),
        seededTiles().tiles[1]!,
      ),
    ).toBeNull();
  });

  it("asks in the next tile's name and states that the previous workflow stays, linked", () => {
    expect(reselectTitle(grid.tiles[1]!)).toBe("Switch to Feature builder?");
    expect(reselectConfirm(grid.tiles[1]!)).toBe("Switch to Feature builder");
    expect(reselectKeeps(instantiated())).toMatch(/^Quick fixes stays\./);
    expect(reselectKeeps(instantiated())).toMatch(/deletes nothing/);
    expect(reselectLink(instantiated())).toBe("Open Quick fixes in the Workflow Studio →");
  });
});

describe("the grid with a selection applied", () => {
  it("marks the chosen tile, hands it its workflow, and unmarks the rest", () => {
    const applied = withSelection(
      seededTiles(),
      templateSelection({
        workflow: instantiated({
          templateSlug: "feature-builder",
          slug: "feature-builder",
          name: "Feature builder",
        }),
      }),
    );

    expect(applied.selectedTemplate).toBe("feature-builder");
    expect(
      applied.tiles.map((one) => [one.slug, one.selected, one.workflow?.slug ?? null]),
    ).toEqual([
      ["quick-fixes", false, null],
      ["feature-builder", true, "feature-builder"],
      ["docs-chores", false, null],
      ["deep-refactor", false, null],
    ]);
    // The rest of the grid is untouched.
    expect(applied.mergedLoops).toBe(3);
    expect(applied.tiles[3]!.unlock).toEqual(seededTiles().tiles[3]!.unlock);
  });
});
