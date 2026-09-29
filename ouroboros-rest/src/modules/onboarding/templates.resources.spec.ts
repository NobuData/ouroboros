/**
 * Step 3's contract ([#386](https://github.com/NobuData/ouroboros/issues/386), BB.3) — above
 * all, the two honesty properties: the lock is a computed progress pair, and no tile carries a
 * fabricated statistic (decision O8).
 */

import type { InstantiatedWorkflowRow, TemplateTileRow } from "./templates.repository";
import {
  FABRICATED_STATISTIC,
  qualitativeCaption,
  studioPath,
  tileResource,
  unlockResource,
} from "./templates.resources";

/** A tile row, with whatever a test changes. */
function row(overrides: Partial<TemplateTileRow> = {}): TemplateTileRow {
  return {
    slug: "quick-fixes",
    version: 1,
    organization_id: null,
    name: "Quick fixes",
    description: "Small bugs and cleanups, fully hands-off.",
    stage_dots: ["analyze", "plan", "code", "build", "test", "PR"],
    effort_range: ["xs", "s", "m"],
    caption: "recommended first workflow",
    tier: "starter",
    definition: {},
    threshold: null,
    unlocked: true,
    ...overrides,
  };
}

const DEEP_REFACTOR = row({
  slug: "deep-refactor",
  name: "Deep refactor",
  caption: null,
  tier: "advanced",
  effort_range: ["l", "xl"],
  threshold: 10,
  unlocked: false,
});

const QUICK_FIXES_WORKFLOW: InstantiatedWorkflowRow = {
  id: "w1",
  slug: "quick-fixes",
  name: "Quick fixes",
  current_version: 1,
  template_slug: "quick-fixes",
  template_version: 1,
};

const CONTEXT = { mergedLoops: 3, selectedTemplate: null, workflows: [] };

describe("the unlock gate", () => {
  it("is null for a starter tile", () => {
    expect(unlockResource(row(), 3)).toBeNull();
  });

  it("carries the computed progress on a locked tier — 3 of 10 merged loops", () => {
    expect(unlockResource(DEEP_REFACTOR, 3)).toEqual({
      locked: true,
      mergedLoops: 3,
      threshold: 10,
      rule: "unlock after 10 merged loops",
      progress: "3 of 10 merged loops",
    });
  });

  it("opens on its own once the evaluation says so, capping the progress at the threshold", () => {
    expect(unlockResource({ ...DEEP_REFACTOR, unlocked: true }, 12)).toMatchObject({
      locked: false,
      mergedLoops: 12,
      progress: "10 of 10 merged loops",
    });
  });

  it("uses the threshold in force — an operator's override replaces the rule's", () => {
    expect(unlockResource({ ...DEEP_REFACTOR, threshold: 1 }, 0)).toMatchObject({
      threshold: 1,
      rule: "unlock after 1 merged loop",
      progress: "0 of 1 merged loop",
    });
  });
});

describe("captions (decision O8)", () => {
  it.each(["92% of teams start here", "used by 4 teams", "top 10"])(
    "refuses %j — the shape of a statistic",
    (caption) => {
      expect(qualitativeCaption(caption)).toBeNull();
    },
  );

  it("keeps a qualitative caption", () => {
    expect(qualitativeCaption("recommended first workflow")).toBe("recommended first workflow");
  });

  it("no tile payload carries a fabricated statistic, whatever the row held", () => {
    const captions = [
      "recommended first workflow",
      "92% of teams start here",
      null,
      "asks before merging",
    ];
    const tiles = captions.map((caption) => tileResource(row({ caption }), CONTEXT));

    for (const tile of tiles) {
      expect(tile.caption ?? "").not.toMatch(FABRICATED_STATISTIC);
    }
    expect(tiles.map((tile) => tile.caption)).toEqual([
      "recommended first workflow",
      null,
      null,
      "asks before merging",
    ]);
  });
});

describe("a tile", () => {
  it("carries the display data, the tier and the scope", () => {
    expect(tileResource(row({ organization_id: "org-1" }), CONTEXT)).toEqual({
      slug: "quick-fixes",
      version: 1,
      scope: "organization",
      name: "Quick fixes",
      description: "Small bugs and cleanups, fully hands-off.",
      stageDots: ["analyze", "plan", "code", "build", "test", "PR"],
      effortRange: ["xs", "s", "m"],
      caption: "recommended first workflow",
      tier: "starter",
      selected: false,
      unlock: null,
      workflow: null,
    });
  });

  it("marks the repository's active choice", () => {
    expect(tileResource(row(), { ...CONTEXT, selectedTemplate: "quick-fixes" }).selected).toBe(
      true,
    );
  });

  it("links its live workflow into the studio", () => {
    const tile = tileResource(row(), { ...CONTEXT, workflows: [QUICK_FIXES_WORKFLOW] });

    expect(tile.workflow).toEqual({
      id: "w1",
      slug: "quick-fixes",
      name: "Quick fixes",
      currentVersion: 1,
      templateSlug: "quick-fixes",
      templateVersion: 1,
      studioPath: "/workflows/quick-fixes",
    });
  });

  it("does not claim another template's workflow", () => {
    expect(
      tileResource(DEEP_REFACTOR, { ...CONTEXT, workflows: [QUICK_FIXES_WORKFLOW] }).workflow,
    ).toBeNull();
  });

  it("reads malformed stage dots as none rather than crashing", () => {
    expect(tileResource(row({ stage_dots: "analyze" }), CONTEXT).stageDots).toEqual([]);
  });
});

describe("the studio path", () => {
  it("is the UI's workflowPath", () => {
    expect(studioPath("quick-fixes-2")).toBe("/workflows/quick-fixes-2");
  });
});
