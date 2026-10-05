import { resolveActions } from "./decision.actions";
import { SHIPPED_KINDS } from "./decision.kinds.fixture";
import type { DecisionRef } from "./decision.types";
import {
  NO_FIGURE,
  decisionNoun,
  estimatePhrase,
  estimateSeconds,
  formatDuration,
  inboxActions,
  inboxHead,
  outcomeWords,
  refsOf,
  resolvedSubject,
  resolvedSummary,
  utcDay,
  utcWeek,
} from "./inbox.compose";

/**
 * The page's words and numbers (#464): the head sentence and its computed estimate (X8), the stat
 * card's durations, the role-filtered actions and the resolved rows' lines.
 */

/** The seeded week's per-kind medians (R__dev_seed_workspace_triage_inbox.sql, #460). */
const SEEDED_PER_KIND = {
  plan_sign_off: 290,
  resize_review: 25,
  split_approval: 55.5,
  run_needs_human: 55,
  protected_path_allow_once: 8,
};

describe("the head (X8)", () => {
  it("reads the mockup's sentence for the seeded queue: 41 + 8 + 41 = about 90 seconds", () => {
    const estimate = estimateSeconds(
      ["merge_approval", "protected_path_allow_once", "claim_waiver"],
      SEEDED_PER_KIND,
      41,
    );

    expect(estimate).toBe(90);
    expect(inboxHead(3, estimate).sentence).toBe("3 decisions. About 90 seconds of your time.");
  });

  it("changes with the queue's kind mix — computed, never seeded", () => {
    expect(
      estimateSeconds(["plan_sign_off", "plan_sign_off", "plan_sign_off"], SEEDED_PER_KIND, 41),
    ).toBe(870);
    expect(inboxHead(3, 870).sentence).toBe("3 decisions. About 15 minutes of your time.");
    expect(estimateSeconds(["resize_review"], SEEDED_PER_KIND, 41)).toBe(25);
  });

  it("pluralizes at one and at zero", () => {
    expect(decisionNoun(1)).toBe("decision");
    expect(decisionNoun(0)).toBe("decisions");
    expect(inboxHead(1, 25).sentence).toBe("1 decision. About 30 seconds of your time.");
    expect(inboxHead(0, 0)).toEqual({
      count: 0,
      noun: "decisions",
      estimateSeconds: 0,
      estimate: null,
      sentence: "No decisions waiting.",
    });
  });

  it("claims no time it does not know: no answers this week, no estimate", () => {
    expect(estimateSeconds(["merge_approval"], {}, null)).toBeNull();
    expect(inboxHead(2, null).sentence).toBe("2 decisions.");
  });

  it("rounds seconds to ten up to two minutes, then speaks in minutes", () => {
    expect(estimatePhrase(4)).toBe("About 10 seconds of your time.");
    expect(estimatePhrase(118)).toBe("About 120 seconds of your time.");
    expect(estimatePhrase(121)).toBe("About 2 minutes of your time.");
  });
});

describe("formatDuration", () => {
  it("prints the stat card's figures", () => {
    expect(formatDuration(41)).toBe("41s");
    expect(formatDuration(360)).toBe("6m");
    expect(formatDuration(95)).toBe("1m 35s");
    expect(formatDuration(7500)).toBe("2h 5m");
    expect(formatDuration(3600)).toBe("1h");
  });

  it("prints an em-dash, never a zero, for a figure it does not have", () => {
    expect(formatDuration(null)).toBe(NO_FIGURE);
    expect(NO_FIGURE).toBe("—");
  });
});

describe("inboxActions", () => {
  const kind = SHIPPED_KINDS.merge_approval;

  /** The merge card's refs (#460): loop #1830 and PR #504. */
  const LINKS = {
    refs: [
      { type: "run", id: "run-1830", label: "loop #1830" },
      { type: "pr", id: "pr-504", label: "PR #504" },
    ] satisfies DecisionRef[],
    sourceRef: "pr:pr-504:merge_approval",
  };

  it("gives a link action where it leads, and an answering action nothing (#467)", () => {
    const actions = inboxActions(
      resolveActions(kind.actions, { roles: ["owner"], canApproveLoops: true }),
      LINKS,
    );

    expect(actions.map((action) => [action.id, action.navigates, action.href])).toEqual([
      ["approve_merge", false, null],
      ["open_verification", true, "/prs/pr-504"],
      ["return_to_loop", false, null],
    ]);
  });

  it("leaves a link whose ref the item does not carry without a destination", () => {
    const actions = inboxActions(
      resolveActions(kind.actions, { roles: ["owner"], canApproveLoops: true }),
      { refs: [], sourceRef: "" },
    );

    expect(actions.find((action) => action.id === "open_verification")).toMatchObject({
      navigates: true,
      href: null,
    });
  });

  it("marks a member's approver action disabled with capability_required, and a viewer's member action role_required", () => {
    const member = inboxActions(
      resolveActions(kind.actions, { roles: ["member"], canApproveLoops: false }),
      LINKS,
    );
    const viewer = inboxActions(
      resolveActions(kind.actions, { roles: ["viewer"], canApproveLoops: false }),
      LINKS,
    );

    expect(member.find((action) => action.id === "approve_merge")).toMatchObject({
      allowed: false,
      disabledReason: "capability_required",
    });
    expect(member.find((action) => action.id === "return_to_loop")).toMatchObject({
      allowed: true,
      disabledReason: null,
    });
    expect(viewer.find((action) => action.id === "return_to_loop")).toMatchObject({
      allowed: false,
      disabledReason: "role_required",
    });
    expect(viewer.find((action) => action.id === "open_verification")).toMatchObject({
      allowed: true,
      navigates: true,
    });
  });

  it("keeps the declared order and every field the card renders", () => {
    const actions = inboxActions(
      resolveActions(kind.actions, { roles: ["owner"], canApproveLoops: true }),
      LINKS,
    );

    expect(actions.map((action) => action.id)).toEqual([
      "approve_merge",
      "open_verification",
      "return_to_loop",
    ]);
    expect(actions[2]).toMatchObject({
      label: "Return to loop with note",
      takesNote: true,
      requiredRole: "member",
    });
  });
});

describe("resolved summaries", () => {
  const ticket = (label: string): DecisionRef => ({ type: "ticket", id: "t-1", label });

  it("composes the subject on its own — the half of the line that is not the verdict (#468)", () => {
    expect(
      resolvedSubject(
        "split_approval",
        { subject: "Migrate", draft_count: 6 },
        [ticket("issue #490")],
        "?",
      ),
    ).toBe("Split #490 into 6 tickets");
    // A kind with no subject here reads as its rendered question.
    expect(resolvedSubject("custom:oven", {}, [], "Is the oven hot?")).toBe("Is the oven hot?");
  });

  it("reads the mockup's two rows", () => {
    expect(
      resolvedSummary(
        "split_approval",
        { subject: "Migrate", draft_count: 6, target: "acme" },
        [ticket("issue #490")],
        "?",
        {
          resolver: "human",
          policy: null,
          actionId: "approve_split",
        },
      ),
    ).toBe("Split #490 into 6 tickets — approved");
    expect(
      resolvedSummary(
        "resize_review",
        { ticket_key: "#486", from_effort: "L", to_effort: "M", confidence: 82 },
        [ticket("issue #486")],
        "?",
        { resolver: "policy", policy: "auto_accept_resize", actionId: "accept_resize" },
      ),
    ).toBe("Estimator re-size #486 L→M — auto-accepted by policy");
  });

  it("names an out-of-band closure, and falls back to the question for an unknown kind", () => {
    expect(
      outcomeWords({ resolver: "policy", policy: "source_resolved", actionId: "source_resolved" }),
    ).toBe("closed — settled elsewhere");
    expect(
      resolvedSummary("custom:oven", {}, [], "Is the oven hot?", {
        resolver: "human",
        policy: null,
        actionId: "open_door",
      }),
    ).toBe("Is the oven hot? — open door");
  });

  it("composes every shipped kind's subject from its facts", () => {
    const pr: DecisionRef = { type: "pr", id: "p", label: "PR #504" };

    expect(
      resolvedSummary("merge_approval", {}, [pr], "?", {
        resolver: "human",
        policy: null,
        actionId: "approve_merge",
      }),
    ).toBe("Merge PR #504 — approved");
    expect(
      resolvedSummary("protected_path_allow_once", { path: "boot/a.c" }, [], "?", {
        resolver: "human",
        policy: null,
        actionId: "deny",
      }),
    ).toBe("One-time edit to boot/a.c — denied");
    expect(
      resolvedSummary("run_needs_human", { subject: "Fix the leak" }, [], "?", {
        resolver: "human",
        policy: null,
        actionId: "retry_with_note",
      }),
    ).toBe("Fix the leak needed a human — retried with a note");
  });
});

describe("refsOf, utcDay, utcWeek", () => {
  it("reads a malformed refs column as none", () => {
    expect(refsOf(null)).toEqual([]);
  });

  it("buckets by UTC day and UTC ISO week (Monday)", () => {
    expect(utcDay(new Date("2026-10-04T23:59:59Z"))).toBe("2026-10-04");
    expect(utcWeek(new Date("2026-10-04T23:59:59Z"))).toBe("2026-09-28");
    expect(utcWeek(new Date("2026-09-28T00:00:00Z"))).toBe("2026-09-28");
  });
});
