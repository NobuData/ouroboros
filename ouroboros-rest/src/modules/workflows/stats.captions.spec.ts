import { TERM_ACTIONS } from "./dsl.schema";
import {
  CAPTION_SEPARATOR,
  NO_RUNS_CAPTION,
  NOT_PUBLISHED_CAPTION,
  railCaption,
  stageSegment,
  terminalBehaviour,
  TERMINAL_CAPTIONS,
  TERMINAL_PRECEDENCE,
  usageCaption,
  usageShare,
} from "./stats.captions";

/**
 * The captions mockup 04 prints, and the honesty rule underneath them
 * ([#135](https://github.com/NobuData/ouroboros/issues/135)).
 *
 * Every function here is pure, so this suite is the one that can assert the *strings* — the
 * five the mockup writes, character for character — without a database, a workspace or a
 * clock. That the strings are composed from a workspace's real rows is
 * `workflows.integration-spec.ts`' question.
 */

describe("the terminal behaviour", () => {
  it("names the furthest outcome when a definition ends in several places", () => {
    // `standard-fix` is the case: it ends at `Open PR & auto-merge` *and* at `Back to queue`,
    // because the `> M` branch splits the work and hands it back — and the mockup's rail reads
    // `auto-merge`. The rule that produces that is precedence, not a graph walk.
    expect(terminalBehaviour(["back_to_queue", "open_pr_automerge"])).toBe("open_pr_automerge");
    expect(terminalBehaviour(["back_to_queue", "needs_review"])).toBe("needs_review");
    expect(terminalBehaviour(["back_to_queue"])).toBe("back_to_queue");
  });

  it("does not depend on the order the definition lists them in", () => {
    expect(terminalBehaviour(["open_pr_automerge", "back_to_queue"])).toBe(
      terminalBehaviour(["back_to_queue", "open_pr_automerge"]),
    );
  });

  it("ignores duplicates, which a document may legally hold", () => {
    // Two `needs_review` terminals is a document with two ways of stopping for a person, and
    // the DSL permits it — `predicate-kinds.json` has four terminals.
    expect(terminalBehaviour(["needs_review", "needs_review"])).toBe("needs_review");
  });

  it("answers null for a definition with no terminals", () => {
    // An unpublished workflow, or the empty `{}` draft **+ New workflow** leaves behind.
    expect(terminalBehaviour([])).toBeNull();
  });

  it("ignores an action this build does not define rather than rendering it", () => {
    // `workflow_versions.definition` is CHECKed to be an object and no further, so a stored
    // document may say anything. A caption is not where that is discovered.
    expect(terminalBehaviour(["ship_it"])).toBeNull();
    expect(terminalBehaviour(["ship_it", "needs_review"])).toBe("needs_review");
  });

  it("has a word and a rank for every action the DSL defines", () => {
    // The completeness check in both directions. An action added to `dsl.schema.ts` with no
    // word here would caption nothing, and one with no rank would never win a precedence it
    // ought to — both silent, which is why they are asserted rather than typed alone.
    expect(Object.keys(TERMINAL_CAPTIONS).sort()).toEqual([...TERM_ACTIONS].sort());
    expect([...TERMINAL_PRECEDENCE].sort()).toEqual([...TERM_ACTIONS].sort());
  });
});

describe("the stage segment", () => {
  it("counts stages, and says `stage` when there is one of them", () => {
    expect(stageSegment(6)).toBe("6 stages");
    expect(stageSegment(2)).toBe("2 stages");
    expect(stageSegment(1)).toBe("1 stage");
  });

  it("says nothing is published rather than claiming zero stages", () => {
    // `0 stages` would be a number about a document nobody published. A workflow with only a
    // draft has no stage count at all, which is what the null carries.
    expect(stageSegment(null)).toBe(NOT_PUBLISHED_CAPTION);
    expect(stageSegment(null)).not.toContain("0");
  });
});

describe("the rail caption", () => {
  it("reads exactly as the mockup's rail does", () => {
    // docs/mockups/04-workflow-builder.html, the five `.wf-cap` strings. Four of them here;
    // the paused one is below, where the rule that produces it is the subject.
    expect(
      railCaption({ stageCount: 6, status: "active", terminalActions: ["open_pr_automerge"] }),
    ).toBe("6 stages · auto-merge");
    expect(
      railCaption({ stageCount: 7, status: "active", terminalActions: ["open_pr_automerge"] }),
    ).toBe("7 stages · auto-merge");
    expect(
      railCaption({ stageCount: 5, status: "active", terminalActions: ["needs_review"] }),
    ).toBe("5 stages · needs review");
    expect(
      railCaption({ stageCount: 4, status: "active", terminalActions: ["open_pr_automerge"] }),
    ).toBe("4 stages · auto-merge");
  });

  it("says `paused` instead of the behaviour, as the mockup's hotfix-p0 does", () => {
    // `5 stages · paused`, and deliberately *not* `5 stages · auto-merge · paused`: a paused
    // workflow's terminal behaviour is not what a reader needs to know about it.
    expect(
      railCaption({ stageCount: 5, status: "paused", terminalActions: ["open_pr_automerge"] }),
    ).toBe("5 stages · paused");
  });

  it("still says `paused` for a paused workflow that was never published", () => {
    expect(railCaption({ stageCount: null, status: "paused", terminalActions: [] })).toBe(
      "not published · paused",
    );
  });

  it("carries the stage segment alone when there is no behaviour to name", () => {
    // A published document naming no terminal this build knows. The DSL's structural rules
    // refuse one at publish time, so this is the unreadable-document case rather than a
    // shape the studio produces — and a trailing separator would be worse than a short caption.
    expect(railCaption({ stageCount: 3, status: "active", terminalActions: [] })).toBe("3 stages");
    expect(railCaption({ stageCount: null, status: "active", terminalActions: [] })).toBe(
      NOT_PUBLISHED_CAPTION,
    );
    expect(railCaption({ stageCount: 3, status: "active", terminalActions: [] })).not.toContain(
      CAPTION_SEPARATOR,
    );
  });

  it("changes when the definition changes, because it is composed on every call", () => {
    // The ticket's third criterion, at this layer: there is no stored caption to update, so
    // one stage more is one word different with no write anywhere.
    const before = railCaption({
      stageCount: 6,
      status: "active",
      terminalActions: ["open_pr_automerge"],
    });
    const after = railCaption({
      stageCount: 7,
      status: "active",
      terminalActions: ["needs_review"],
    });

    expect(before).toBe("6 stages · auto-merge");
    expect(after).toBe("7 stages · needs review");
  });
});

describe("the usage share", () => {
  it("is the rounded percentage of the window's runs", () => {
    expect(usageShare(61, 100)).toBe(61);
    // The mockup's own number from a plausible denominator: 47 of 77 runs is 61.04%.
    expect(usageShare(47, 77)).toBe(61);
    expect(usageShare(1, 3)).toBe(33);
    expect(usageShare(2, 3)).toBe(67);
  });

  it("is null when the window holds no runs, rather than zero", () => {
    // The honesty rule as a return type: there is no share of nothing, so there is no number
    // to hand a caller who might render it as a percentage.
    expect(usageShare(0, 0)).toBeNull();
  });

  it("is zero for a workflow that ran none of a workspace's runs", () => {
    // Distinct from the case above and a real answer: the workspace has runs, and none of them
    // were this workflow's.
    expect(usageShare(0, 40)).toBe(0);
  });

  it("never exceeds a hundred, because the numerator is part of the denominator", () => {
    expect(usageShare(40, 40)).toBe(100);
  });
});

describe("the usage caption", () => {
  it("reads exactly as the mockup's head does", () => {
    expect(usageCaption(61, 100)).toBe("used by 61% of runs");
  });

  it("says `no runs yet` for a workspace with no runs in the window", () => {
    // The ticket's second criterion. Never a fabricated percentage, and never `0%` either —
    // which would be a number about a denominator that does not exist.
    expect(usageCaption(0, 0)).toBe(NO_RUNS_CAPTION);
    expect(usageCaption(0, 0)).not.toContain("%");
  });

  it("says `used by 0% of runs` for a workflow nothing ran, in a workspace that ran something", () => {
    expect(usageCaption(0, 40)).toBe("used by 0% of runs");
  });

  it("says `<1%` rather than rounding a workflow that ran down to nothing", () => {
    // One run in a thousand is 0.1%, and `used by 0% of runs` beside a workflow that
    // demonstrably ran is the one reading a rounded share can make that is worse than the
    // precision it hides.
    expect(usageCaption(1, 1000)).toBe("used by <1% of runs");
  });
});
