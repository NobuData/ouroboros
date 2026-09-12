import type { WorkflowRegistryRow } from "./stats.repository";
import { workflowStats } from "./stats.resources";

/**
 * The shape the studio reads — facts and captions together
 * ([#135](https://github.com/NobuData/ouroboros/issues/135)).
 *
 * The rail draws the caption and the page head draws the subline, and this is the one object
 * both are drawn from: there is no second mapping for them to disagree through.
 */

/**
 * One registry row.
 *
 * @param overrides - What this case is about.
 * @returns The row, with the mockup's `standard-fix` as the default.
 */
function row(overrides: Partial<WorkflowRegistryRow> = {}): WorkflowRegistryRow {
  return {
    id: "workflow-1",
    slug: "standard-fix",
    name: "standard-fix",
    status: "active",
    current_version: 14,
    stage_count: 6,
    terminal_actions: ["back_to_queue", "open_pr_automerge"],
    ...overrides,
  };
}

describe("one workflow's statistics", () => {
  it("carries the mockup's rail caption and its head subline together", () => {
    const stats = workflowStats(row(), 47, 77);

    expect(stats.caption).toBe("6 stages · auto-merge");
    expect(stats.usageCaption).toBe("used by 61% of runs");
  });

  it("publishes the facts beside the strings, so nothing has to parse a caption", () => {
    // #147's rail needs `status` to draw the err-dot and `stageCount` to know whether an entry
    // has anything to say. A surface that read either out of `5 stages · paused` would be a
    // surface that breaks when the wording does.
    const stats = workflowStats(row({ status: "paused", stage_count: 5 }), 0, 12);

    expect(stats).toMatchObject({
      id: "workflow-1",
      slug: "standard-fix",
      name: "standard-fix",
      status: "paused",
      currentVersion: 14,
      stageCount: 5,
      terminal: "open_pr_automerge",
      runs: 0,
      usagePercent: 0,
    });
  });

  it("names the terminal even while the caption says `paused`", () => {
    // The rail hides the behaviour behind `paused`; the field does not, because *what would
    // this do if it were running* is a question the inspector answers.
    const stats = workflowStats(row({ status: "paused" }), 1, 10);

    expect(stats.caption).toBe("6 stages · paused");
    expect(stats.terminal).toBe("open_pr_automerge");
  });

  it("reports no share at all for a workspace with no runs in the window", () => {
    // The ticket's second criterion, at the seam a client reads: the null is what stops a
    // caller composing its own subline out of the number.
    const stats = workflowStats(row(), 0, 0);

    expect(stats.usagePercent).toBeNull();
    expect(stats.usageCaption).toBe("no runs yet");
  });

  it("says nothing is published for a workflow with only a draft", () => {
    const stats = workflowStats(
      row({ current_version: null, stage_count: null, terminal_actions: [] }),
      0,
      12,
    );

    expect(stats).toMatchObject({
      currentVersion: null,
      stageCount: null,
      terminal: null,
      caption: "not published",
    });
  });

  it("counts a workflow's own runs, and shares against every run in the window", () => {
    // The denominator includes runs under other workflows — and under tags that resolve to no
    // workflow at all — because they are still runs this workspace performed.
    const stats = workflowStats(row(), 3, 12);

    expect(stats.runs).toBe(3);
    expect(stats.usagePercent).toBe(25);
  });
});
