import { QUEUE_EFFORTS } from "../db/schema";
import { effortAtLeast, matchesPredicate } from "./context";

/**
 * The predicate, and the one property that is easy to get subtly wrong.
 *
 * An **unstated** fact must not satisfy a condition about it. A rule reading `effort ≥ L`
 * against a context with no effort has learned nothing, and firing on nothing would route
 * every unsized run to the most expensive model in the workspace — which is the sort of bug
 * that shows up on an invoice rather than in a stack trace. Every absence case below exists
 * for that reason.
 */

describe("comparing effort", () => {
  it("orders the five sizes the way V009 declares them", () => {
    // Derived from `QUEUE_EFFORTS` rather than written out again, so a size added to the queue
    // and not to routing fails here rather than silently never matching.
    for (const [rank, effort] of QUEUE_EFFORTS.entries()) {
      for (const [floorRank, floor] of QUEUE_EFFORTS.entries()) {
        expect(effortAtLeast(effort, floor)).toBe(rank >= floorRank);
      }
    }
  });

  it("does not treat an unsized context as small", () => {
    // It is not small, it is unknown — and `_gte` asks a question about a scale the work has
    // not been placed on yet.
    for (const floor of QUEUE_EFFORTS) {
      expect(effortAtLeast(undefined, floor)).toBe(false);
    }
  });
});

describe("matching a predicate", () => {
  it("fires on the effort the mockup's first rule states", () => {
    expect(matchesPredicate({ effort_gte: "l" }, { effort: "l" })).toBe(true);
    expect(matchesPredicate({ effort_gte: "l" }, { effort: "xl" })).toBe(true);
    expect(matchesPredicate({ effort_gte: "l" }, { effort: "m" })).toBe(false);
  });

  it("fires on a label the work carries, among others", () => {
    expect(matchesPredicate({ label: "security" }, { labels: ["backend", "security"] })).toBe(true);
    expect(matchesPredicate({ label: "security" }, { labels: ["backend"] })).toBe(false);
    expect(matchesPredicate({ label: "security" }, {})).toBe(false);
  });

  it("compares labels whole and case-sensitively, as GitHub spells them", () => {
    // GitHub's vocabulary, not ours — V014 mirrors it. `Security` and `security` are two
    // labels a repository may genuinely have, and folding them here would fire a rule on a
    // label its author did not write.
    expect(matchesPredicate({ label: "security" }, { labels: ["Security"] })).toBe(false);
    expect(matchesPredicate({ label: "security" }, { labels: ["security-review"] })).toBe(false);
  });

  it("fires on the one diff classification the grammar has", () => {
    expect(matchesPredicate({ diff_kind: "docs_only" }, { diffKind: "docs_only" })).toBe(true);
    expect(matchesPredicate({ diff_kind: "docs_only" }, {})).toBe(false);
  });

  it("ANDs every stated condition", () => {
    // WF-P8's rule and V018's: `{effort_gte, label}` is *both*, and a context that satisfies
    // one of them satisfies neither rule.
    const both = { effort_gte: "l", label: "security" } as const;

    expect(matchesPredicate(both, { effort: "xl", labels: ["security"] })).toBe(true);
    expect(matchesPredicate(both, { effort: "xl", labels: ["backend"] })).toBe(false);
    expect(matchesPredicate(both, { effort: "s", labels: ["security"] })).toBe(false);
  });

  it("ignores the context field no rule can ask about", () => {
    // `repo` is in the shape for AB.5 (#211) and is not in the grammar, so no predicate can
    // read it and none of them may be affected by it.
    expect(matchesPredicate({ effort_gte: "l" }, { effort: "l", repo: "acme/robotics" })).toBe(
      true,
    );
  });
});
