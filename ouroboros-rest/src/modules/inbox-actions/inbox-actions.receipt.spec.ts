import { SHIPPED_KINDS } from "../decisions/decision.kinds.fixture";
import type { DecisionRef } from "../decisions/decision.types";
import { NAVIGATE_PREFIX } from "../decisions/inbox.links";
import { InboxActionHandlers } from "./inbox-actions.handlers";
import { actionReceipt, type ReceiptContext } from "./inbox-actions.receipt";

/**
 * The card's receipt (#467): what an answer executed, in words, worded by the operation that ran
 * and by what the plane actually answered — never by the kind, and never ahead of the facts.
 */

const RUN: DecisionRef = { type: "run", id: "run-1844", label: "loop #1844" };
const PR: DecisionRef = { type: "pr", id: "pr-504", label: "PR #504" };

/** A receipt's context over some refs. */
function context(refs: DecisionRef[], actionId = "act"): ReceiptContext {
  return { refs, sourceRef: "source-1", actionId };
}

describe("allow once", () => {
  it("says the exception was granted and the resume sent, and links the run console", () => {
    expect(
      actionReceipt(
        "guardrail.allow_once",
        { run_id: "run-1844", exception_id: "ex-1", control_id: "c-1", control_state: "pending" },
        context([RUN]),
      ),
    ).toEqual({
      effects: ["exception granted", "resume sent to loop #1844"],
      links: [{ label: "Run console", href: "/runs/run-1844" }],
    });
  });

  it("says resumed only once the loop has acknowledged the control", () => {
    expect(
      actionReceipt("guardrail.allow_once", { control_state: "acked" }, context([RUN])).effects,
    ).toEqual(["exception granted", "loop #1844 resumed"]);
  });
});

describe("approve & merge", () => {
  it("names the merge commit when the gates were already green", () => {
    expect(
      actionReceipt(
        "pr.approve_and_merge",
        { pr_id: "pr-504", merge: "merged", merge_sha: "3f9c2ab77d0e11aa" },
        context([RUN, PR]),
      ),
    ).toEqual({
      effects: ["approval recorded", "PR merged at 3f9c2ab"],
      links: [{ label: "PR verification", href: "/prs/pr-504" }],
    });
  });

  it("says armed, not merged, while the gates are still running", () => {
    expect(
      actionReceipt("pr.approve_and_merge", { merge: "armed", merge_sha: null }, context([PR]))
        .effects,
    ).toEqual(["approval recorded", "merge armed — it lands once its checks are green"]);
  });

  it("says merged without a sha the host did not report", () => {
    expect(
      actionReceipt("pr.approve_and_merge", { merge: "merged", merge_sha: null }, context([PR]))
        .effects,
    ).toEqual(["approval recorded", "PR merged"]);
  });
});

describe("waive & annotate", () => {
  it.each([
    ["annotated", "PR annotated publicly"],
    ["pending_pr_plane", "PR annotation queued"],
    ["failed", "the PR annotation failed — retry it from the PR page"],
  ])("reads an annotation that is %s as %s", (annotation, words) => {
    expect(
      actionReceipt("pr.waive_criterion", { pr_id: "pr-514", annotation }, context([PR])),
    ).toEqual({
      effects: ["claim waived", words],
      links: [{ label: "PR verification", href: "/prs/pr-514#criteria" }],
    });
  });
});

describe("the loop's controls", () => {
  it.each([
    ["run.deny_protected_path", "pending", ["path stays protected", "decision sent to loop #1844"]],
    [
      "run.deny_protected_path",
      "acked",
      ["path stays protected", "loop #1844 returned with your decision"],
    ],
    ["run.return_with_note", "pending", ["note sent to loop #1844"]],
    ["run.retry_with_note", "acked", ["loop #1844 returned with your note"]],
    ["run.cancel", "pending", ["cancel sent to loop #1844"]],
    ["run.cancel", "acked", ["loop #1844 cancelled"]],
  ])("%s with a %s control", (binding, state, effects) => {
    expect(actionReceipt(binding, { control_state: state }, context([RUN]))).toEqual({
      effects,
      links: [{ label: "Run console", href: "/runs/run-1844" }],
    });
  });

  it("speaks of the loop when the item carries no run ref, and links nothing", () => {
    expect(actionReceipt("run.cancel", { control_state: "pending" }, context([]))).toEqual({
      effects: ["cancel sent to the loop"],
      links: [],
    });
  });
});

describe("planning and knowledge", () => {
  it("counts what a split pushed, and says when the push stopped short", () => {
    expect(
      actionReceipt(
        "planning.push_batch",
        { draft_batch_id: "b-1", push: "pushed", pushed: 6 },
        context([]),
      ),
    ).toEqual({
      effects: ["split approved", "6 tickets pushed"],
      links: [{ label: "Planning", href: "/planning?batch=b-1" }],
    });
    expect(
      actionReceipt(
        "planning.push_batch",
        { draft_batch_id: "b-1", push: "partial", pushed: 1 },
        context([]),
      ).effects,
    ).toEqual(["split approved", "1 ticket pushed", "some drafts failed — resume from Planning"]);
    expect(
      actionReceipt(
        "planning.push_batch",
        { draft_batch_id: "b-1", push: "throttled", pushed: 0 },
        context([]),
      ).effects,
    ).toEqual([
      "split approved",
      "0 tickets pushed",
      "the tracker is rate limiting — resume from Planning",
    ]);
  });

  it("links a bench-gap draft to its batch", () => {
    expect(
      actionReceipt(
        "planning.require_bench_upgrade",
        { pr_id: "pr-514", draft_batch_id: "b-9", draft_id: "d-1" },
        context([PR]),
      ),
    ).toEqual({
      effects: ["bench-gap ticket drafted", "claim left unverified"],
      links: [{ label: "Planning", href: "/planning?batch=b-9" }],
    });
  });

  it("reads a fact's new status", () => {
    const knowledge = [{ label: "Knowledge", href: "/knowledge#facts-awaiting" }];

    expect(actionReceipt("facts.confirm", { status: "confirmed" }, context([]))).toEqual({
      effects: ["fact confirmed"],
      links: knowledge,
    });
    expect(actionReceipt("facts.retire", { status: "rejected" }, context([])).effects).toEqual([
      "fact rejected",
    ]);
    expect(actionReceipt("facts.retire", { status: "expired" }, context([])).effects).toEqual([
      "fact expired",
    ]);
  });
});

describe("an operation this table does not know", () => {
  it("still gets an honest line: the action in the past tense, and the item's run and PR", () => {
    expect(actionReceipt("billing.approve_spend", {}, context([RUN, PR], "approve_spend"))).toEqual(
      {
        effects: ["approved"],
        links: [
          { label: "Run console", href: "/runs/run-1844" },
          { label: "PR verification", href: "/prs/pr-504" },
        ],
      },
    );
    expect(actionReceipt(undefined, {}, context([], "mark_done")).effects).toEqual(["mark done"]);
  });
});

describe("coverage", () => {
  it("words every operation the executor can run — none falls back to the generic line", () => {
    const handlers = new InboxActionHandlers(
      ...([
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ] as unknown as ConstructorParameters<typeof InboxActionHandlers>),
    );
    const bound = [
      ...new Set(
        Object.values(SHIPPED_KINDS)
          .flatMap((kind) => kind.actions)
          .map((action) => action.handler_binding)
          .filter((binding) => !binding.startsWith(NAVIGATE_PREFIX) && handlers.isBound(binding)),
      ),
    ];

    expect(bound.length).toBeGreaterThan(5);

    for (const binding of bound) {
      const generic = actionReceipt(undefined, {}, context([RUN, PR], "zz_unknown"));

      expect({
        binding,
        effects: actionReceipt(binding, {}, context([RUN, PR], "zz_unknown")).effects,
      }).not.toEqual({
        binding,
        effects: generic.effects,
      });
    }
  });
});
