import { DslWarningCode } from "../workflows/dsl.errors";
import {
  NO_DRAFT_REASON,
  SPEND_GUARD_ENFORCED_BY,
  blockedReasons,
  neverAutoMergeGuard,
  promotionGuards,
  promotionReference,
  spendGuard,
  terminalActions,
} from "./copilot.promotion";
import type { UnresolvedReference } from "./copilot.references";

function term(id: string, action?: string, options: Record<string, unknown> = {}) {
  return {
    id,
    type: "term",
    title: id,
    position: { x: 0, y: 0 },
    config: action === undefined ? {} : { action, options },
  };
}

function document(...nodes: unknown[]) {
  return { dsl_version: "1.0", nodes, edges: [] };
}

const INFRA = { id: "test", type: "infra", title: "Test", position: { x: 0, y: 0 }, config: {} };

function reference(code: DslWarningCode, node: string, name: string): UnresolvedReference {
  return { code, node, name, path: `/nodes/0/${name}`, message: `No ${name}.` };
}

describe("a draft's endings", () => {
  it("reads the action of every term node, in document order", () => {
    expect(
      terminalActions(
        document(INFRA, term("review", "needs_review"), term("queue", "back_to_queue")),
      ),
    ).toEqual(["needs_review", "back_to_queue"]);
  });

  it("answers nothing for a draft that is absent, empty or not a document", () => {
    expect(terminalActions(null)).toEqual([]);
    expect(terminalActions(document())).toEqual([]);
    expect(terminalActions({ nodes: "none" })).toEqual([]);
    expect(terminalActions(document(null, "term", INFRA))).toEqual([]);
  });

  it("keeps an ending that names no action yet, as one that does not merge", () => {
    expect(terminalActions(document(term("unfinished")))).toEqual([undefined]);
  });
});

describe("the never auto-merge guard", () => {
  it("is enforced by the definition when every ending is human review", () => {
    expect(neverAutoMergeGuard(document(INFRA, term("open-pr", "needs_review")))).toEqual({
      id: "never_auto_merge",
      label: "never auto-merge",
      source: "definition",
      enforcement: "enforced",
      enforcedBy:
        "Enforced by the workflow itself: every run ends at human review (`needs_review`), and no ending of this workflow merges on its own (`open_pr_automerge`).",
    });
  });

  it("names each kind of ending once, and never claims review where a run goes back to the queue", () => {
    const guard = neverAutoMergeGuard(
      document(
        term("review", "needs_review"),
        term("queue", "back_to_queue"),
        term("review-again", "needs_review"),
      ),
    );

    expect(guard?.enforcedBy).toBe(
      "Enforced by the workflow itself: every run ends at human review (`needs_review`) or the queue (`back_to_queue`), and no ending of this workflow merges on its own (`open_pr_automerge`).",
    );
  });

  it("is absent as soon as one ending auto-merges", () => {
    expect(
      neverAutoMergeGuard(
        document(
          term("review", "needs_review"),
          term("merge", "open_pr_automerge", { merge_method: "squash", delete_branch: true }),
        ),
      ),
    ).toBeUndefined();
  });

  it("is absent for a draft with no ending — it does not end yet, which is not never merging", () => {
    expect(neverAutoMergeGuard(document(INFRA))).toBeUndefined();
    expect(neverAutoMergeGuard(null)).toBeUndefined();
  });

  it("says only what it knows about an ending with no action", () => {
    expect(neverAutoMergeGuard(document(term("unfinished")))?.enforcedBy).toBe(
      "Enforced by the workflow itself: no ending of this workflow merges on its own (`open_pr_automerge`).",
    );
  });
});

describe("the spend guard", () => {
  it("names the cap in dollars per run, and that only dry runs honour it", () => {
    expect(spendGuard(500)).toEqual({
      id: "spend_guard",
      label: "spend cap $5.00/run",
      source: "conversation",
      enforcement: "dry_run_only",
      enforcedBy: SPEND_GUARD_ENFORCED_BY,
    });
    expect(SPEND_GUARD_ENFORCED_BY).toContain("Not enforced on real runs yet");
  });

  it("keeps the cents", () => {
    expect(spendGuard(1250)?.label).toBe("spend cap $12.50/run");
    expect(spendGuard(5)?.label).toBe("spend cap $0.05/run");
  });

  it("is absent when the conversation set none", () => {
    expect(spendGuard(null)).toBeUndefined();
  });
});

describe("a promotion's guards", () => {
  it("lists the document's guard first, then the conversation's", () => {
    expect(
      promotionGuards(document(term("open-pr", "needs_review")), 500).map((guard) => guard.id),
    ).toEqual(["never_auto_merge", "spend_guard"]);
  });

  it("lists only what holds", () => {
    const merging = document(term("merge", "open_pr_automerge"));

    expect(promotionGuards(merging, null)).toEqual([]);
    expect(promotionGuards(merging, 500).map((guard) => guard.id)).toEqual(["spend_guard"]);
    expect(promotionGuards(null, null)).toEqual([]);
  });
});

describe("a promotion's references", () => {
  it("is blocking exactly for an alias the registry does not have", () => {
    const alias = reference(DslWarningCode.REFERENCE_UNKNOWN_ALIAS, "review", "coder-maxx");
    const skill = reference(DslWarningCode.REFERENCE_UNKNOWN_SKILL, "analyze", "advisory-db");
    const task = reference(
      DslWarningCode.REFERENCE_UNKNOWN_TASK,
      "exploit-verify",
      "exploit-verify",
    );

    expect(promotionReference(alias)).toEqual({ ...alias, blocking: true });
    expect(promotionReference(skill)).toEqual({ ...skill, blocking: false });
    expect(promotionReference(task)).toEqual({ ...task, blocking: false });
  });
});

describe("why a promotion is blocked", () => {
  const advisory = promotionReference(
    reference(DslWarningCode.REFERENCE_UNKNOWN_SKILL, "analyze", "advisory-db"),
  );
  const blocking = promotionReference(
    reference(DslWarningCode.REFERENCE_UNKNOWN_ALIAS, "review-second", "second-opinion"),
  );

  it("is not, on advisory references alone", () => {
    expect(blockedReasons(true, [])).toEqual([]);
    expect(blockedReasons(true, [advisory])).toEqual([]);
  });

  it("names the stage and the alias of every blocking reference", () => {
    expect(blockedReasons(true, [advisory, blocking])).toEqual([
      "Stage `review-second` pins the alias `second-opinion`, which is not in this workspace's registry — publishing refuses it.",
    ]);
  });

  it("is, with no draft — and that is the whole reason", () => {
    expect(blockedReasons(false, [blocking])).toEqual([NO_DRAFT_REASON]);
    expect(NO_DRAFT_REASON).toBe("There is no draft to promote.");
  });
});
