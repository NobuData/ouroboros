import type { Effort, SourceKind, TriggerSpec } from "./dsl.schema";
import {
  resolveWorkflow,
  triggerMatches,
  triggerSpecificity,
  type TicketFacts,
  type TriggerCandidate,
  type WorkflowChoice,
} from "./trigger.evaluation";

/**
 * R.1's rules, as a matrix ([#143](https://github.com/NobuData/ouroboros/issues/143)).
 *
 * The ticket's criteria at the layer that decides them: effort boundaries at, above and below
 * every threshold; label and source-kind conditions; explicit assignment winning; and the
 * documented precedence for several matches. Paused workflows and cross-org isolation are
 * decided by *which rows become candidates*, so they are `trigger.service.spec.ts`'.
 *
 * The matching rules are the engine's (`predicates.py`, `evaluate_trigger`), so every case here
 * is one both evaluators must answer the same way.
 */

const EFFORTS: readonly Effort[] = ["xs", "s", "m", "l", "xl"];
const SOURCES: readonly SourceKind[] = ["github", "gitlab", "jira", "linear"];

/** A trigger with these conditions. */
function trigger(conditions: TriggerSpec["conditions"] = {}): TriggerSpec {
  return { event: "ticket_queued", conditions };
}

/** Mockup 04's `#485`: effort M, a bug, from GitHub. */
function ticket(overrides: Partial<TicketFacts> = {}): TicketFacts {
  return { source: "github", labels: ["bug"], effort: "m", ...overrides };
}

/** A candidate workflow, published at `version`. */
function candidate(
  slug: string,
  conditions: TriggerSpec["conditions"],
  version = 1,
): TriggerCandidate {
  return { slug, version, trigger: trigger(conditions) };
}

/** A choice with no explicit workflow, suggesting `standard-fix`, with no versions known. */
function choice(overrides: Partial<WorkflowChoice> = {}): WorkflowChoice {
  return {
    explicit: undefined,
    suggested: "standard-fix",
    facts: ticket(),
    candidates: [],
    versionOf: () => null,
    ...overrides,
  };
}

describe("effort conditions", () => {
  // Every threshold against every effort: 25 cases, each named for where the effort sits.
  const matrix = EFFORTS.flatMap((threshold, thresholdRank) =>
    EFFORTS.map((effort, effortRank) => {
      const position =
        effortRank === thresholdRank ? "at" : effortRank < thresholdRank ? "below" : "above";
      return [threshold, effort, position, effortRank <= thresholdRank] as const;
    }),
  );

  it.each(matrix)(
    "effort ≤ %s against effort %s (%s the threshold) matches: %s",
    (threshold, effort, _position, expected) => {
      expect(triggerMatches(trigger({ effort_lte: threshold }), ticket({ effort }))).toBe(expected);
    },
  );

  it("holds at the threshold, which is what ≤ means", () => {
    // The mockup's own case: `#485` is M and `standard-fix` runs when effort ≤ M.
    expect(triggerMatches(trigger({ effort_lte: "m" }), ticket({ effort: "m" }))).toBe(true);
  });

  it("fails one size above the threshold", () => {
    expect(triggerMatches(trigger({ effort_lte: "m" }), ticket({ effort: "l" }))).toBe(false);
  });

  it("holds one size below the threshold", () => {
    expect(triggerMatches(trigger({ effort_lte: "m" }), ticket({ effort: "s" }))).toBe(true);
  });

  it("is not satisfied by a ticket nobody has sized, at any threshold", () => {
    for (const threshold of EFFORTS) {
      expect(triggerMatches(trigger({ effort_lte: threshold }), ticket({ effort: null }))).toBe(
        false,
      );
    }
  });

  it("does not care about effort when the trigger names none", () => {
    expect(triggerMatches(trigger({ labels: ["bug"] }), ticket({ effort: null }))).toBe(true);
  });
});

describe("label conditions", () => {
  it("matches a ticket carrying every required label", () => {
    const condition = trigger({ labels: ["dependencies", "tech-debt"] });

    expect(triggerMatches(condition, ticket({ labels: ["dependencies", "tech-debt"] }))).toBe(true);
  });

  it("matches a ticket carrying more than the required labels", () => {
    expect(
      triggerMatches(trigger({ labels: ["docs"] }), ticket({ labels: ["docs", "good-first"] })),
    ).toBe(true);
  });

  it("does not match a ticket carrying only some of them — all means all", () => {
    const condition = trigger({ labels: ["dependencies", "tech-debt"] });

    expect(triggerMatches(condition, ticket({ labels: ["dependencies"] }))).toBe(false);
  });

  it("does not match a ticket carrying none of them", () => {
    expect(triggerMatches(trigger({ labels: ["p0"] }), ticket({ labels: [] }))).toBe(false);
  });

  it("compares exactly, so a label spelled differently is a different label", () => {
    expect(triggerMatches(trigger({ labels: ["docs"] }), ticket({ labels: ["Docs"] }))).toBe(false);
    expect(triggerMatches(trigger({ labels: ["docs"] }), ticket({ labels: ["docs "] }))).toBe(
      false,
    );
  });

  it("reads a repeated required label as one label", () => {
    expect(
      triggerMatches(trigger({ labels: ["docs", "docs"] }), ticket({ labels: ["docs"] })),
    ).toBe(true);
  });
});

describe("source-kind conditions", () => {
  const matrix = SOURCES.flatMap((wanted) =>
    SOURCES.map((actual) => [wanted, actual, wanted === actual] as const),
  );

  it.each(matrix)("source %s against a ticket from %s matches: %s", (wanted, actual, expected) => {
    expect(triggerMatches(trigger({ source: wanted }), ticket({ source: actual }))).toBe(expected);
  });
});

describe("conditions together", () => {
  it("matches every ticket when there are no conditions at all", () => {
    for (const effort of [...EFFORTS, null]) {
      expect(triggerMatches(trigger(), ticket({ effort, labels: [], source: "linear" }))).toBe(
        true,
      );
    }
  });

  it("ANDs them: `docs-loop` needs a small ticket and the docs label", () => {
    const docsLoop = trigger({ effort_lte: "s", labels: ["docs"] });

    expect(triggerMatches(docsLoop, ticket({ effort: "xs", labels: ["docs"] }))).toBe(true);
    expect(triggerMatches(docsLoop, ticket({ effort: "m", labels: ["docs"] }))).toBe(false);
    expect(triggerMatches(docsLoop, ticket({ effort: "xs", labels: ["bug"] }))).toBe(false);
  });

  it("fails on any one condition, whichever it is", () => {
    const all = trigger({ effort_lte: "m", labels: ["bug"], source: "github" });

    expect(triggerMatches(all, ticket())).toBe(true);
    expect(triggerMatches(all, ticket({ effort: "xl" }))).toBe(false);
    expect(triggerMatches(all, ticket({ labels: [] }))).toBe(false);
    expect(triggerMatches(all, ticket({ source: "jira" }))).toBe(false);
  });
});

describe("specificity", () => {
  const cases: readonly [string, TriggerSpec["conditions"], number][] = [
    ["no conditions", {}, 0],
    ["an effort threshold", { effort_lte: "m" }, 1],
    ["a source", { source: "github" }, 1],
    ["one label", { labels: ["docs"] }, 1],
    ["two labels", { labels: ["p0", "priority-high"] }, 2],
    ["an effort threshold and a label", { effort_lte: "s", labels: ["docs"] }, 2],
    ["everything, with two labels", { effort_lte: "m", source: "github", labels: ["a", "b"] }, 4],
  ];

  it.each(cases)("counts %s as %i", (_name, conditions, expected) => {
    expect(triggerSpecificity(trigger(conditions))).toBe(expected);
  });

  it("counts a repeated label once, so repeating one cannot win precedence", () => {
    expect(triggerSpecificity(trigger({ labels: ["docs", "docs", "docs"] }))).toBe(1);
  });
});

describe("resolving which workflow claims a ticket", () => {
  describe("an explicit choice", () => {
    it("wins over a predicate that matched another workflow", () => {
      const pin = resolveWorkflow(
        choice({
          explicit: "deps-refresh",
          candidates: [candidate("standard-fix", { effort_lte: "m" }, 14)],
          versionOf: (slug) => (slug === "deps-refresh" ? 3 : 14),
        }),
      );

      expect(pin).toMatchObject({ slug: "deps-refresh", version: 3, reason: "explicit" });
    });

    it("wins even when its own trigger would not have matched", () => {
      const pin = resolveWorkflow(
        choice({
          explicit: "feature-loop",
          candidates: [candidate("feature-loop", { labels: ["enhancement"] })],
          versionOf: () => 1,
        }),
      );

      expect(pin).toMatchObject({ slug: "feature-loop", version: 1, reason: "explicit" });
    });

    it("wins over the estimate's suggestion", () => {
      const pin = resolveWorkflow(choice({ explicit: "docs-loop", suggested: "standard-fix" }));

      expect(pin).toMatchObject({ slug: "docs-loop", reason: "explicit" });
    });

    it("pins null when the chosen workflow has nothing published", () => {
      // A bootstrap workspace's `standard-fix`, or an active workflow with only a draft.
      const pin = resolveWorkflow(choice({ explicit: "release-train" }));

      expect(pin).toMatchObject({ slug: "release-train", version: null, reason: "explicit" });
    });

    it("still reports what matched, so an explanation can say what the choice overrode", () => {
      const pin = resolveWorkflow(
        choice({
          explicit: "deps-refresh",
          candidates: [candidate("standard-fix", { effort_lte: "m" }, 14)],
        }),
      );

      expect(pin.matched).toEqual([{ slug: "standard-fix", version: 14, specificity: 1 }]);
    });
  });

  describe("a predicate match", () => {
    it("fills the default when exactly one workflow matches — the mockup's #485", () => {
      // standard-fix (≤ M ✓), feature-loop (needs `enhancement` ✗).
      const pin = resolveWorkflow(
        choice({
          suggested: "docs-loop",
          candidates: [
            candidate("standard-fix", { effort_lte: "m" }, 14),
            candidate("feature-loop", { labels: ["enhancement"] }),
          ],
        }),
      );

      expect(pin).toEqual({
        slug: "standard-fix",
        version: 14,
        reason: "predicate",
        matched: [{ slug: "standard-fix", version: 14, specificity: 1 }],
      });
    });

    it("pins the candidate's own version, not whatever the lookup says", () => {
      const pin = resolveWorkflow(
        choice({ candidates: [candidate("standard-fix", {}, 14)], versionOf: () => 99 }),
      );

      expect(pin.version).toBe(14);
    });
  });

  describe("several matches", () => {
    it("go to the most specific trigger", () => {
      const pin = resolveWorkflow(
        choice({
          facts: ticket({ effort: "xs", labels: ["docs"] }),
          candidates: [
            candidate("standard-fix", { effort_lte: "m" }, 14),
            candidate("docs-loop", { effort_lte: "s", labels: ["docs"] }, 2),
          ],
        }),
      );

      expect(pin).toMatchObject({ slug: "docs-loop", version: 2, reason: "most_specific" });
    });

    it("go to the lowest slug when the most specific tie", () => {
      const pin = resolveWorkflow(
        choice({
          facts: ticket({ labels: ["p0", "priority-high", "docs"] }),
          candidates: [
            candidate("hotfix-p0", { labels: ["p0", "priority-high"] }, 1),
            candidate("docs-loop", { effort_lte: "m", labels: ["docs"] }, 2),
          ],
        }),
      );

      expect(pin).toMatchObject({ slug: "docs-loop", version: 2, reason: "alphabetical" });
    });

    it("only look at the top: a tie below the winner is still most_specific", () => {
      const pin = resolveWorkflow(
        choice({
          facts: ticket({ labels: ["bug", "docs"] }),
          candidates: [
            candidate("alpha", { effort_lte: "m" }),
            candidate("beta", { labels: ["docs"] }),
            candidate("gamma", { effort_lte: "m", labels: ["bug", "docs"] }),
          ],
        }),
      );

      expect(pin).toMatchObject({ slug: "gamma", reason: "most_specific" });
    });

    it("compare slugs by code point, not by locale", () => {
      // `-` (U+002D) sorts before `2` (U+0032). A locale compare may ignore punctuation.
      const pin = resolveWorkflow(
        choice({ candidates: [candidate("fix2", {}), candidate("fix-a", {})] }),
      );

      expect(pin.slug).toBe("fix-a");
    });

    it("answer the same whatever order the candidates arrived in", () => {
      const candidates = [
        candidate("standard-fix", { effort_lte: "m" }, 14),
        candidate("catch-all", {}, 1),
        candidate("bug-hunt", { labels: ["bug"] }, 5),
        candidate("github-only", { source: "github" }, 7),
      ];

      const forwards = resolveWorkflow(choice({ candidates }));
      const backwards = resolveWorkflow(choice({ candidates: [...candidates].reverse() }));

      expect(backwards).toEqual(forwards);
      expect(forwards).toMatchObject({ slug: "bug-hunt", reason: "alphabetical" });
    });

    it("are listed winner first, in precedence order", () => {
      const pin = resolveWorkflow(
        choice({
          candidates: [
            candidate("catch-all", {}),
            candidate("standard-fix", { effort_lte: "m" }, 14),
            candidate("bug-and-github", { labels: ["bug"], source: "github" }, 3),
            candidate("bug-hunt", { labels: ["bug"] }, 5),
          ],
        }),
      );

      expect(pin.matched.map((match) => match.slug)).toEqual([
        "bug-and-github",
        "bug-hunt",
        "standard-fix",
        "catch-all",
      ]);
    });
  });

  describe("a catch-all trigger", () => {
    it("loses to any match that says more", () => {
      const pin = resolveWorkflow(
        choice({
          candidates: [candidate("anything", {}), candidate("standard-fix", { effort_lte: "m" })],
        }),
      );

      expect(pin).toMatchObject({ slug: "standard-fix", reason: "most_specific" });
    });

    it("still beats the estimate's suggestion, because it is a match", () => {
      const pin = resolveWorkflow(
        choice({ suggested: "docs-loop", candidates: [candidate("anything", {})] }),
      );

      expect(pin).toMatchObject({ slug: "anything", reason: "predicate" });
    });
  });

  describe("no match", () => {
    it("keeps the estimate's suggestion, at its version in force", () => {
      const pin = resolveWorkflow(
        choice({
          suggested: "feature-loop",
          facts: ticket({ effort: "xl" }),
          candidates: [candidate("standard-fix", { effort_lte: "m" }, 14)],
          versionOf: (slug) => (slug === "feature-loop" ? 4 : null),
        }),
      );

      expect(pin).toEqual({ slug: "feature-loop", version: 4, reason: "suggested", matched: [] });
    });

    it("pins null for a suggestion with nothing published — a bootstrap workspace", () => {
      const pin = resolveWorkflow(choice({ suggested: "standard-fix" }));

      expect(pin).toEqual({
        slug: "standard-fix",
        version: null,
        reason: "suggested",
        matched: [],
      });
    });

    it("keeps the suggestion for an unsized ticket whose only candidate needs an effort", () => {
      const pin = resolveWorkflow(
        choice({
          facts: ticket({ effort: null }),
          candidates: [candidate("standard-fix", { effort_lte: "xl" }, 14)],
          suggested: "docs-loop",
        }),
      );

      expect(pin).toMatchObject({ slug: "docs-loop", reason: "suggested" });
    });
  });
});
