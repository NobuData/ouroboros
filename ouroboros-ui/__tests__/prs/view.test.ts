import { describe, expect, it } from "vitest";

import type { PullRequestState } from "@/app/api/pull-requests";
import { runPath } from "@/app/paths";
import {
  ALREADY_ARMED,
  MERGE_LABEL,
  NOT_VERIFYING,
  NO_EVIDENCE,
  NO_LOOP,
  NO_REVISION,
  RECEIPT_LINK,
  RETURN_LABEL,
  RETURN_REJECTED,
  REVIEW_ALREADY_OPEN,
  REVIEW_LABEL,
  REVIEW_OPENED,
  REVIEW_REQUESTED_LABEL,
  REVIEW_SENDING,
  REVIEW_SENDING_LABEL,
  type ActionsInput,
  actionsView,
  aggregatePill,
  branchLine,
  countsLine,
  currentReview,
  hasActions,
  hostOwnedReason,
  httpUrl,
  issueLink,
  latestRevision,
  loopLink,
  mergeAction,
  notArmable,
  prEyebrow,
  prHead,
  redGates,
  returnAction,
  returnConfirmLabel,
  returnCosts,
  returnReceipt,
  returnTitle,
  reviewAction,
  reviewOutcome,
  reviewWaiting,
} from "@/app/prs/view";

import {
  HIL_RED,
  HOST_URL,
  TESTS_RED,
  TICKET_URL,
  blockedPage,
  gateRows,
  prHeadOf,
  prPage,
  returned,
  review,
} from "../helpers/pull-requests";
import { SEEDED_RUN_ID } from "../helpers/runs";

/**
 * The PR verification frame as data (#363): each rule on its own, then the seed through `prHead`
 * against mockup 12's own strings.
 */

/** Every state a PR may be in. */
const STATES: readonly PullRequestState[] = [
  "open",
  "verifying",
  "blocked",
  "armed",
  "merged",
  "closed",
];

/** The aggregate at `5 of 7`. */
const FIVE_OF_SEVEN = {
  requiredCount: 7,
  greenCount: 5,
  redCount: 0,
  satisfiedCount: 6,
  mergeReady: false,
};

/**
 * What the actions are decided from, for an owner.
 *
 * @param over What to change.
 * @returns The input.
 */
function input(over: Partial<ActionsInput> = {}): ActionsInput {
  return {
    page: prPage(),
    answeredReview: null,
    mayContribute: true,
    mayArm: true,
    requestingReview: false,
    ...over,
  };
}

describe("the head (mockup 12)", () => {
  it("composes the seeded head: eyebrow, headline, tag, pill, branches and counts", () => {
    expect(prHead(prPage(), "dashboard")).toEqual({
      eyebrow: "PR Verification · PR #514 · Revision 2",
      prLabel: "PR #514",
      headline: "can: fix flaky telemetry frame order under ISR load",
      hostUrl: HOST_URL,
      loop: { label: "loop #1847", href: runPath(SEEDED_RUN_ID, "dashboard"), external: false },
      issue: { label: "issue #482", href: TICKET_URL, external: true },
      pill: { label: "verifying — 5 of 7 gates green", tone: "warn", dot: undefined },
      branches: "loop/482-canbus-flake → main",
      counts: "+68 −15 · 3 files",
    });
  });

  it("names the PR alone before its first revision was recorded", () => {
    const page = prPage({ revisions: [], gates: null });

    expect(latestRevision(page)).toBeNull();
    expect(prEyebrow(514, null)).toBe("PR Verification · PR #514");
    expect(prHead(page, "dashboard").pill.label).toBe("verifying");
  });

  it("says one file as one file", () => {
    expect(countsLine(prHeadOf({ additions: 1, deletions: 0, changedFiles: 1 }))).toBe(
      "+1 −0 · 1 file",
    );
    expect(branchLine(prHeadOf({ headBranch: "fix/x", baseBranch: "release" }))).toBe(
      "fix/x → release",
    );
  });
});

describe("the loop and issue tag", () => {
  it("links the loop to its run console, keeping the origin", () => {
    expect(loopLink(prHeadOf(), "build-farm")?.href).toBe(runPath(SEEDED_RUN_ID, "build-farm"));
    expect(loopLink(prHeadOf({ run: null }), "dashboard")).toBeNull();
  });

  it("links the issue through the ticket's own record, so a non-GitHub tracker resolves", () => {
    const jira = prHeadOf({
      ticket: {
        id: "5eed0030-0000-4000-8000-000000000012",
        key: "HEL-12",
        title: "Fix flaky CAN-bus telemetry test",
        url: "https://acme.atlassian.net/browse/HEL-12",
      },
    });

    expect(issueLink(jira)).toEqual({
      label: "issue HEL-12",
      href: "https://acme.atlassian.net/browse/HEL-12",
      external: true,
    });
  });

  it("names the loop's issue without a link when there is no ticket record — never a guessed one", () => {
    expect(issueLink(prHeadOf({ ticket: null }))).toEqual({
      label: "issue #482",
      href: null,
      external: false,
    });
    expect(issueLink(prHeadOf({ ticket: null, run: null }))).toBeNull();
  });

  it("carries only a URL a browser fetches rather than executes", () => {
    expect(httpUrl("https://github.com/acme/helios/pull/514")).toBe(
      "https://github.com/acme/helios/pull/514",
    );
    expect(httpUrl("http://gitea.local/pull/1")).toBe("http://gitea.local/pull/1");

    for (const value of ["javascript:alert(1)", "data:text/html,x", "/relative", "", null]) {
      expect(httpUrl(value)).toBeNull();
    }

    const hostile = prHeadOf({
      url: "javascript:alert(1)",
      ticket: { id: "x", key: "#1", title: "t", url: "javascript:alert(2)" },
    });
    expect(prHead(prPage({ pullRequest: hostile }), "dashboard").hostUrl).toBeNull();
    expect(issueLink(hostile)?.href).toBeNull();
  });
});

describe("the aggregate pill", () => {
  it("is warn at 5 of 7 while verifying — the mockup's pill", () => {
    expect(aggregatePill("verifying", FIVE_OF_SEVEN)).toEqual({
      label: "verifying — 5 of 7 gates green",
      tone: "warn",
      dot: undefined,
    });
  });

  it("colours by the PR's state", () => {
    const tones = STATES.map((state) => aggregatePill(state, FIVE_OF_SEVEN).tone);

    expect(tones).toEqual(["neutral", "warn", "err", "warn", "ok", "neutral"]);
  });

  it("turns ok once every required gate is satisfied, and pulses while armed", () => {
    const ready = { ...FIVE_OF_SEVEN, greenCount: 7, satisfiedCount: 7, mergeReady: true };

    expect(aggregatePill("verifying", ready).tone).toBe("ok");
    expect(aggregatePill("armed", ready)).toEqual({
      label: "armed — 7 of 7 gates green",
      tone: "ok",
      dot: "pulse",
    });
  });

  it("says the state alone when there is no required gate to count", () => {
    expect(aggregatePill("open", null).label).toBe("open");
    expect(aggregatePill("verifying", { ...FIVE_OF_SEVEN, requiredCount: 0 }).label).toBe(
      "verifying",
    );
  });
});

describe("the red gates", () => {
  it("are the latest revision's, in the card's order, each with its evidence", () => {
    expect(redGates(blockedPage())).toEqual([
      { key: "test_suite", label: "Test suite", evidence: TESTS_RED },
      { key: "physical_hil", label: "Physical HIL", evidence: HIL_RED },
    ]);
  });

  it("are none when nothing is red, or nothing was evaluated", () => {
    expect(redGates(prPage())).toEqual([]);
    expect(redGates(prPage({ gates: null }))).toEqual([]);
  });

  it("say so when a red gate recorded no evidence line", () => {
    const page = blockedPage();
    page.gates = { ...page.gates!, rows: gateRows({ build: ["red", null] }) };

    expect(redGates(page)).toEqual([{ key: "build", label: "Build", evidence: NO_EVIDENCE }]);
  });
});

describe("Request human review", () => {
  it("is on for the seeded PR", () => {
    expect(reviewAction(input())).toEqual({ label: REVIEW_LABEL, reason: null });
  });

  it("becomes state-aware once a review is waiting, and says who asked", () => {
    const waiting = reviewAction(input({ page: prPage({ review: review() }) }));

    expect(waiting.label).toBe(REVIEW_REQUESTED_LABEL);
    expect(waiting.reason).toBe(reviewWaiting(review()));
    expect(waiting.reason).toBe("Ken S asked for a human review — it is waiting for an answer.");
    expect(reviewWaiting(review({ requestedBy: null }))).toMatch(/^Somebody asked/);
  });

  it("is state-aware from the press's own answer, before the next poll", () => {
    expect(reviewAction(input({ answeredReview: review() })).label).toBe(REVIEW_REQUESTED_LABEL);
  });

  it("is inert while its request is in flight, so it cannot be sent twice", () => {
    expect(reviewAction(input({ requestingReview: true }))).toEqual({
      label: REVIEW_SENDING_LABEL,
      reason: REVIEW_SENDING,
    });
  });

  it("can be asked again once the last review was answered", () => {
    for (const state of ["approved", "declined"] as const) {
      expect(reviewAction(input({ page: prPage({ review: review({ state }) }) }))).toEqual({
        label: REVIEW_LABEL,
        reason: null,
      });
    }
  });

  it("is off, with the reason, on a finished PR and before the first revision", () => {
    expect(reviewAction(input({ page: prPage({ pullRequest: { state: "merged" } }) })).reason).toBe(
      hostOwnedReason("merged"),
    );
    expect(reviewAction(input({ page: prPage({ revisions: [] }) })).reason).toBe(NO_REVISION);
  });

  it("reads the slot requested last, and the page's reading of a slot both hold", () => {
    const answered = review({ id: "a", requestedAt: "2026-09-27T15:00:00.000Z" });
    const older = review({ id: "b", requestedAt: "2026-09-27T14:00:00.000Z", state: "approved" });
    const decided = review({ id: "a", state: "approved" });

    expect(currentReview(null, null)).toBeNull();
    expect(currentReview(null, answered)).toBe(answered);
    expect(currentReview(older, null)).toBe(older);
    expect(currentReview(older, answered)).toBe(answered);
    expect(currentReview(answered, older)).toBe(answered);
    expect(currentReview(decided, answered)).toBe(decided);
  });
});

describe("Return to loop", () => {
  it("is on when a gate is red on the latest revision", () => {
    expect(returnAction(blockedPage())).toEqual({ label: RETURN_LABEL, reason: null });
  });

  it("is off, saying so, when no gate is red", () => {
    expect(returnAction(prPage()).reason).toBe(
      "No gate is red on revision 2 — there is nothing to send back.",
    );
  });

  it("is off for a PR no loop opened, and for one whose loop has finished", () => {
    expect(returnAction(blockedPage({ pullRequest: { run: null } })).reason).toBe(NO_LOOP);

    const finished = blockedPage({
      pullRequest: { run: { ...prHeadOf().run!, finishedAt: "2026-09-27T15:00:00.000Z" } },
    });
    expect(returnAction(finished).reason).toBe(
      "Loop #1847 has finished, so it cannot take a correction round.",
    );
  });

  it("is off on a finished PR and before the first revision", () => {
    expect(returnAction(blockedPage({ pullRequest: { state: "closed" } })).reason).toBe(
      hostOwnedReason("closed"),
    );
    expect(returnAction(blockedPage({ revisions: [] })).reason).toBe(NO_REVISION);
  });
});

describe("Merge when all gates green", () => {
  it("is on only for a verifying PR with a revision", () => {
    expect(mergeAction(prPage())).toEqual({ label: MERGE_LABEL, reason: null });
  });

  it("states the reason in every state that cannot be armed", () => {
    const reasons = Object.fromEntries(
      STATES.map((state) => [
        state,
        notArmable(state, latestRevision(prPage()), { ...FIVE_OF_SEVEN, redCount: 2 }),
      ]),
    );

    expect(reasons).toEqual({
      open: NOT_VERIFYING,
      verifying: null,
      blocked: "2 gates are red on revision 2 — a blocked PR cannot be armed.",
      armed: ALREADY_ARMED,
      merged: hostOwnedReason("merged"),
      closed: hostOwnedReason("closed"),
    });
  });

  it("counts one red gate as one, and says a gate is red when the count is unknown", () => {
    const revision = latestRevision(prPage());

    expect(notArmable("blocked", revision, { ...FIVE_OF_SEVEN, redCount: 1 })).toBe(
      "1 gate is red on revision 2 — a blocked PR cannot be armed.",
    );
    expect(notArmable("blocked", revision, null)).toBe(
      "A gate is red on revision 2 — a blocked PR cannot be armed.",
    );
  });

  it("cannot be armed before the first revision", () => {
    expect(notArmable("verifying", null, null)).toBe(NO_REVISION);
  });
});

describe("role gating", () => {
  it("draws all three for an owner or admin", () => {
    const view = actionsView(input());

    expect(view.review).not.toBeNull();
    expect(view.returnToLoop).not.toBeNull();
    expect(view.merge).not.toBeNull();
  });

  it("draws a member no arm affordance", () => {
    const view = actionsView(input({ mayArm: false }));

    expect(view.merge).toBeNull();
    expect(view.review).not.toBeNull();
    expect(view.returnToLoop).not.toBeNull();
    expect(hasActions(view)).toBe(true);
  });

  it("draws a viewer nothing", () => {
    const view = actionsView(input({ mayContribute: false, mayArm: false }));

    expect(view).toEqual({ review: null, returnToLoop: null, merge: null });
    expect(hasActions(view)).toBe(false);
  });
});

describe("the outcomes", () => {
  it("writes the return's receipt with a link into the run console, keeping the origin", () => {
    expect(returnReceipt(returned(), prHeadOf(), "build-farm")).toEqual({
      text:
        "Correction round queued for loop #1847, with the evidence of 2 gates as its steer. " +
        "The next revision is expected from attempt 5 of implement.",
      failed: false,
      link: { label: RECEIPT_LINK, href: runPath(SEEDED_RUN_ID, "build-farm") },
    });
  });

  it("counts one gate as one, and leaves the expectation out when no stage had started", () => {
    const one = returned({
      gates: ["physical_hil"],
      loopReturn: { ...returned().loopReturn!, gateKeys: ["physical_hil"], expected: null },
    });

    expect(returnReceipt(one, prHeadOf(), "dashboard").text).toBe(
      "Correction round queued for loop #1847, with the evidence of 1 gate as its steer.",
    );
  });

  it("says the service's reason for a correction round the loop rejected, with no link", () => {
    const rejected = returned({
      control: { ...returned().control, state: "rejected" },
      loopReturn: null,
      skipped: ["The run has finished, so no correction round was queued: merged."],
    });

    expect(returnReceipt(rejected, prHeadOf(), "dashboard")).toEqual({
      text: "The run has finished, so no correction round was queued: merged.",
      failed: true,
      link: null,
    });
    expect(returnReceipt({ ...rejected, skipped: [] }, prHeadOf(), "dashboard").text).toBe(
      RETURN_REJECTED,
    );
  });

  it("says whether the press opened the review or found one waiting", () => {
    expect(reviewOutcome(true).text).toBe(REVIEW_OPENED);
    expect(reviewOutcome(false).text).toBe(REVIEW_ALREADY_OPEN);
  });
});

describe("the dialog's words", () => {
  it("name the PR, the loop and how many gates are sent", () => {
    expect(returnTitle(514)).toBe("Return PR #514 to the loop");
    expect(returnCosts(prHeadOf())).toMatch(/back to loop #1847 for another attempt/);
    expect(returnCosts(prHeadOf({ run: null }))).toMatch(/back to the loop for another attempt/);
    expect(returnConfirmLabel(1)).toBe("Return to loop with 1 gate");
    expect(returnConfirmLabel(2)).toBe("Return to loop with 2 gates");
  });
});
