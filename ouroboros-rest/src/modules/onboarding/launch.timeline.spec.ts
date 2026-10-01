/**
 * The *What Happens Next* projection ([#388](https://github.com/NobuData/ouroboros/issues/388),
 * BB.5, decisions O7 and O8).
 */

import { PROJECTED, projectTimeline } from "./launch.timeline";

describe("the projected timeline", () => {
  const timeline = projectTimeline({ issueKey: "#488", cycle: { min: 3, max: 6 }, dryRun: true });

  it("is labelled as a projection — the card, and every row", () => {
    expect(PROJECTED).toBe("projected");
    expect(timeline.kind).toBe("projected");
    expect(timeline.rows.map((row) => row.kind)).toEqual(Array(5).fill("projected"));
  });

  it("reads as mockup 13's five rows, in order", () => {
    expect(timeline.rows.map((row) => [row.key, row.actor, row.text])).toEqual([
      ["loop_starts", "loop", "loop starts on #488"],
      ["plan_posted", "loop", "draft plan posted to the issue"],
      ["draft_pr_opens", "loop", "draft PR opens"],
      ["you_review", "you", "you review"],
      ["merge", "you", "merge — only when you say so; dry-run never merges"],
    ]);
  });

  it("times only the origin and the draft PR, from the issue's own estimate", () => {
    expect(timeline.basis).toBe("issue_estimate");
    expect(timeline.rows.map((row) => row.atMinutes)).toEqual([0, null, 4, null, null]);
  });

  it.each([
    [{ min: 3, max: 6 }, 4],
    [{ min: 8, max: 14 }, 11],
    [{ min: 12, max: 18 }, 15],
    [{ min: 1, max: 2 }, 1],
  ])("prints the cycle %j as its midpoint, rounded down: %i min", (cycle, minutes) => {
    expect(projectTimeline({ issueKey: "#1", cycle, dryRun: true }).rows[2].atMinutes).toBe(
      minutes,
    );
  });

  it("claims no time for an issue with no estimate", () => {
    const untimed = projectTimeline({ issueKey: "#488", cycle: null, dryRun: true });

    expect(untimed.basis).toBe("none");
    expect(untimed.rows.map((row) => row.atMinutes)).toEqual([0, null, null, null, null]);
  });

  it("names no issue before one is picked", () => {
    const generic = projectTimeline({ issueKey: null, cycle: null, dryRun: true });

    expect(generic.rows[0].text).toBe("loop starts on your first issue");
  });

  it("does not promise a draft or a held merge when dry-run is off", () => {
    const live = projectTimeline({ issueKey: "#488", cycle: { min: 3, max: 6 }, dryRun: false });

    expect(live.dryRun).toBe(false);
    expect(live.rows[2].text).toBe("pull request opens");
    expect(live.rows[4]).toMatchObject({
      actor: "loop",
      text: "merge — as the workflow's final step decides",
    });
    expect(JSON.stringify(live)).not.toMatch(/draft PR|never merges/);
  });

  it("carries no measured claim and no cross-team figure (O8)", () => {
    const text = JSON.stringify(timeline);

    expect(text).not.toMatch(/\d\s*%/);
    expect(text).not.toMatch(/4m 10s/);
    expect(text).not.toMatch(/measured|average|across teams|passing checks/i);
  });
});
