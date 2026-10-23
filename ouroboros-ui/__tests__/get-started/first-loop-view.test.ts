import { describe, expect, it } from "vitest";

import {
  REVIEW_DRAFT_BECAUSE,
  REVIEW_DRAFT_OTHER,
  REVIEW_NOT_DRAFT,
  STALL_MINUTES,
  draftLine,
  elapsed,
  failureReason,
  firstLoopEndpoint,
  firstLoopState,
  isFirstLoop,
  lastTransition,
  liveTimelineRows,
  planPostedAt,
  stateLinks,
} from "@/app/get-started/first-loop-view";

import {
  DRY_RUN_ON,
  FIRST_RUN_ID,
  PLAN_STAGE,
  after,
  firstConsole,
  firstLoop,
  firstPullRequest,
} from "../helpers/first-loop";
import { timelineStage } from "../helpers/runs";

/** The first loop, live (BD.1, #396): the measured rows, the states, the words. */

describe("elapsed", () => {
  it("prints the timeline's times", () => {
    expect(elapsed(after(0), after(0))).toBe("0:00");
    expect(elapsed(after(0), after(64))).toBe("1:04");
    expect(elapsed(after(0), after(3729))).toBe("1:02:09");
    expect(elapsed(after(10), after(0))).toBe("0:00");
  });
});

describe("the live timeline rows", () => {
  it("marks the start and the plan once the first model stage's first attempt succeeded", () => {
    expect(liveTimelineRows(firstLoop(), PLAN_STAGE, null)).toEqual([
      { key: "loop_starts", at: "0:00" },
      { key: "plan_posted", at: "1:04" },
    ]);
  });

  it("leaves the plan projected while its first attempt has not succeeded, or no stage is the plan", () => {
    const failing = firstConsole({}, [
      timelineStage(PLAN_STAGE, "Plan", 1, {
        status: "active",
        attempts: [{ attempt: 1, status: "failed", startedAt: after(2), finishedAt: after(30), durationSeconds: 28, note: null }],
      }),
    ]);

    expect(planPostedAt(failing, PLAN_STAGE)).toBeNull();
    expect(liveTimelineRows(firstLoop(), null, null).map((row) => row.key)).toEqual(["loop_starts"]);
  });

  it("adds the draft PR, the review and the merge as each happens", () => {
    const open = firstLoop({ pullRequest: firstPullRequest() });

    expect(liveTimelineRows(open, PLAN_STAGE, null).map((row) => [row.key, row.at])).toEqual([
      ["loop_starts", "0:00"],
      ["plan_posted", "1:04"],
      ["draft_pr_opens", "3:11"],
    ]);

    const merged = firstLoop({ pullRequest: firstPullRequest({ state: "merged", mergedAt: after(900) }) });

    expect(liveTimelineRows(merged, PLAN_STAGE, after(600)).map((row) => [row.key, row.at])).toEqual([
      ["loop_starts", "0:00"],
      ["plan_posted", "1:04"],
      ["draft_pr_opens", "3:11"],
      ["you_review", "10:00"],
      ["merge", "15:00"],
    ]);
  });
});

describe("the state", () => {
  const now = (seconds: number) => Date.parse(after(seconds));

  it("is running while stages move", () => {
    expect(firstLoopState(firstLoop(), now(120))).toEqual({ kind: "running", stage: "Implement" });
  });

  it(`is stalled once nothing has moved for ${String(STALL_MINUTES)} minutes`, () => {
    expect(lastTransition(firstConsole())).toBe(now(65));
    expect(firstLoopState(firstLoop(), now(65 + 14 * 60)).kind).toBe("running");
    expect(firstLoopState(firstLoop(), now(65 + 15 * 60))).toEqual({ kind: "stalled", minutes: 15 });
  });

  it("is waiting on a person, not stalled, when the run needs one", () => {
    const loop = firstLoop({ console: firstConsole({ status: "needs_human" }) });

    expect(firstLoopState(loop, now(65 + 60 * 60))).toEqual({ kind: "waiting" });
  });

  it("is failed with the failing attempt's note, or the stage it failed in", () => {
    const noted = firstConsole({ status: "failed", finishedAt: after(300) }, [
      timelineStage("build", "Build", 1, {
        status: "failed",
        attempts: [{ attempt: 1, status: "failed", startedAt: after(100), finishedAt: after(300), durationSeconds: 200, note: "make test exited 2." }],
      }),
    ]);
    const bare = firstConsole({ status: "failed", finishedAt: after(300), stageLabel: "Build" }, []);

    expect(firstLoopState(firstLoop({ console: noted }), now(400))).toEqual({ kind: "failed", reason: "make test exited 2." });
    expect(failureReason(bare)).toBe("Build failed.");
  });

  it("is budget-stopped when a budget abort cancelled it, and cancelled otherwise", () => {
    const canceled = firstConsole({ status: "canceled", finishedAt: after(300) });

    expect(firstLoopState(firstLoop({ console: canceled, budget: "cost_cap" }), now(400))).toEqual({
      kind: "budget",
      limit: "cost_cap",
    });
    expect(firstLoopState(firstLoop({ console: canceled }), now(400))).toEqual({ kind: "canceled" });
  });

  it("is the review once the PR opened, and merged once it merged", () => {
    const pr = firstPullRequest();

    expect(firstLoopState(firstLoop({ console: firstConsole({ status: "review" }), pullRequest: pr }), now(400))).toEqual({
      kind: "review",
      pullRequest: pr,
    });
    expect(firstLoopState(firstLoop({ pullRequest: { ...pr, state: "merged" } }), now(400)).kind).toBe("merged");
    expect(firstLoopState(firstLoop({ pullRequest: { ...pr, state: "closed" } }), now(400)).kind).toBe("closed");
  });

  it("links the console always, the PR page for a review, and Needs you while waiting", () => {
    const pr = firstPullRequest();

    expect(stateLinks(FIRST_RUN_ID, { kind: "running", stage: "x" })).toEqual({
      console: `/runs/${FIRST_RUN_ID}`,
      review: null,
      waiting: null,
    });
    expect(stateLinks(FIRST_RUN_ID, { kind: "review", pullRequest: pr }).review).toBe(`/prs/${pr.id}`);
    expect(stateLinks(FIRST_RUN_ID, { kind: "waiting" }).waiting).toBe("/inbox");
  });
});

describe("the draft line", () => {
  it("names dry-run as the reason only when it is the reason", () => {
    expect(draftLine({ draft: true }, DRY_RUN_ON)).toBe(REVIEW_DRAFT_BECAUSE);
    expect(draftLine({ draft: true }, { dryRun: false })).toBe(REVIEW_DRAFT_OTHER);
    expect(draftLine({ draft: true }, null)).toBe(REVIEW_DRAFT_OTHER);
    expect(draftLine({ draft: false }, DRY_RUN_ON)).toBe(REVIEW_NOT_DRAFT);
  });
});

describe("the endpoint and the guard", () => {
  it("names the run", () => {
    expect(firstLoopEndpoint(FIRST_RUN_ID)).toBe(`/api/onboarding/first-loop?run=${FIRST_RUN_ID}`);
  });

  it("accepts the first loop and refuses what is not", () => {
    expect(isFirstLoop(firstLoop())).toBe(true);
    expect(isFirstLoop({ ...firstLoop(), budget: "money" })).toBe(false);
    expect(isFirstLoop({ console: {} })).toBe(false);
    expect(isFirstLoop(null)).toBe(false);
  });
});
