import type { OrgPolicyRule } from "./org-policy.document";
import {
  MAX_EXACT_LABELS,
  canonical,
  classifyRule,
  diffPolicies,
  publishSummary,
  ruleName,
  parseRuleChanges,
  ruleChangePhrase,
  ruleChangesFact,
} from "./policy-publish";

/**
 * A policy edit, classified per rule (BQ.2, #481): tightening, loosening or neutral — computed by
 * comparing what each rule lets through, not guessed.
 */

/** Mockup 17's policy v7. */
const V7: Record<string, OrgPolicyRule> = {
  auto_merge: {
    enabled: true,
    conditions: { all: [{ effort_lte: "m" }, { not: { label: "refactor" } }] },
  },
  human_review: {
    enabled: true,
    conditions: { any: [{ label: "refactor" }, { effort_gte: "l" }] },
  },
  protected_paths: {
    enabled: true,
    conditions: { path_globs: ["boot/**", "keys/**", ".github/**"] },
  },
  spend_guard: { enabled: true, conditions: { per_run_cap_cents: 250, monthly_cap_cents: 60000 } },
  dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 10 } },
};

/**
 * V7 with one rule replaced.
 *
 * @param ruleId - The rule.
 * @param rule - Its replacement.
 * @returns The rules.
 */
function edit(ruleId: string, rule: OrgPolicyRule): Record<string, OrgPolicyRule> {
  return { ...V7, [ruleId]: rule };
}

describe("auto_merge", () => {
  it("is loosening when switched on, tightening when switched off", () => {
    expect(classifyRule("auto_merge", { ...V7.auto_merge, enabled: false }, V7.auto_merge)).toBe(
      "loosening",
    );
    expect(classifyRule("auto_merge", V7.auto_merge, { ...V7.auto_merge, enabled: false })).toBe(
      "tightening",
    );
  });

  it("is loosening when the conditions admit more tickets — effort ≤ M to effort ≤ L", () => {
    const wider = {
      enabled: true,
      conditions: { all: [{ effort_lte: "l" }, { not: { label: "refactor" } }] },
    };

    expect(classifyRule("auto_merge", V7.auto_merge, wider)).toBe("loosening");
    expect(classifyRule("auto_merge", wider, V7.auto_merge)).toBe("tightening");
  });

  it("is loosening when the refactor exclusion is dropped", () => {
    expect(
      classifyRule("auto_merge", V7.auto_merge, { enabled: true, conditions: { effort_lte: "m" } }),
    ).toBe("loosening");
  });

  it("is tightening when a new exclusion narrows it", () => {
    const narrower = {
      enabled: true,
      conditions: {
        all: [{ effort_lte: "m" }, { not: { label: "refactor" } }, { not: { label: "hotfix" } }],
      },
    };

    expect(classifyRule("auto_merge", V7.auto_merge, narrower)).toBe("tightening");
  });

  it("is neutral for a rewrite that admits exactly the same tickets", () => {
    const same = {
      enabled: true,
      conditions: { not: { any: [{ effort_gte: "l" }, { label: "refactor" }] } },
    };

    // `not (effort ≥ L or refactor)` differs from `effort ≤ M and not refactor` only for an
    // unestimated ticket — which the second excludes and the first admits. So this one loosens…
    expect(classifyRule("auto_merge", V7.auto_merge, same)).toBe("loosening");
    // …and a reordering is the same set exactly.
    expect(
      classifyRule("auto_merge", V7.auto_merge, {
        enabled: true,
        conditions: { all: [{ not: { label: "refactor" } }, { effort_lte: "m" }] },
      }),
    ).toBe("neutral");
  });

  it("is loosening when it both admits and excludes — something now merges that did not", () => {
    expect(
      classifyRule("auto_merge", V7.auto_merge, {
        enabled: true,
        conditions: { all: [{ effort_lte: "l" }, { not: { label: "docs" } }] },
      }),
    ).toBe("loosening");
  });

  it("is tightening on a first publish that restricts it, against no policy at all", () => {
    expect(classifyRule("auto_merge", undefined, V7.auto_merge)).toBe("tightening");
  });

  it(`falls back to loosening beyond ${String(MAX_EXACT_LABELS)} distinct labels`, () => {
    const labels = Array.from({ length: MAX_EXACT_LABELS + 1 }, (_, index) => ({
      not: { label: `l${String(index)}` },
    }));

    expect(
      classifyRule("auto_merge", V7.auto_merge, {
        enabled: true,
        conditions: { all: [...labels, { effort_lte: "s" }] },
      }),
    ).toBe("loosening");
  });
});

describe("human_review", () => {
  it("is loosening when switched off, tightening when switched on", () => {
    expect(
      classifyRule("human_review", V7.human_review, { ...V7.human_review, enabled: false }),
    ).toBe("loosening");
    expect(
      classifyRule("human_review", { ...V7.human_review, enabled: false }, V7.human_review),
    ).toBe("tightening");
  });

  it("is loosening when it stops covering large PRs, tightening when it starts covering docs", () => {
    expect(
      classifyRule("human_review", V7.human_review, {
        enabled: true,
        conditions: { label: "refactor" },
      }),
    ).toBe("loosening");
    expect(
      classifyRule("human_review", V7.human_review, {
        enabled: true,
        conditions: { any: [{ label: "refactor" }, { effort_gte: "l" }, { label: "docs" }] },
      }),
    ).toBe("tightening");
  });

  it("is tightening on a first publish", () => {
    expect(classifyRule("human_review", undefined, V7.human_review)).toBe("tightening");
  });
});

describe("protected_paths", () => {
  it("is loosening when a glob goes, tightening when one comes, neutral when only the order moves", () => {
    expect(
      classifyRule("protected_paths", V7.protected_paths, {
        enabled: true,
        conditions: { path_globs: ["boot/**"] },
      }),
    ).toBe("loosening");
    expect(
      classifyRule("protected_paths", V7.protected_paths, {
        enabled: true,
        conditions: { path_globs: ["boot/**", "keys/**", ".github/**", "ota/**"] },
      }),
    ).toBe("tightening");
    expect(
      classifyRule("protected_paths", V7.protected_paths, {
        enabled: true,
        conditions: { path_globs: [".github/**", "keys/**", "boot/**"] },
      }),
    ).toBe("neutral");
  });

  it("is loosening when switched off, and when a glob is swapped for another", () => {
    expect(
      classifyRule("protected_paths", V7.protected_paths, {
        ...V7.protected_paths,
        enabled: false,
      }),
    ).toBe("loosening");
    expect(
      classifyRule("protected_paths", V7.protected_paths, {
        enabled: true,
        conditions: { path_globs: ["boot/secure/**", "keys/**", ".github/**"] },
      }),
    ).toBe("loosening");
  });
});

describe("spend_guard", () => {
  it("is loosening when a cap rises or goes, tightening when one falls or comes", () => {
    const at = (perRun: number | undefined, monthly: number | undefined): OrgPolicyRule => ({
      enabled: true,
      conditions: {
        ...(perRun === undefined ? {} : { per_run_cap_cents: perRun }),
        ...(monthly === undefined ? {} : { monthly_cap_cents: monthly }),
      },
    });

    expect(classifyRule("spend_guard", V7.spend_guard, at(300, 60000))).toBe("loosening");
    expect(classifyRule("spend_guard", V7.spend_guard, at(undefined, 60000))).toBe("loosening");
    expect(classifyRule("spend_guard", V7.spend_guard, at(200, 60000))).toBe("tightening");
    expect(classifyRule("spend_guard", at(undefined, 60000), V7.spend_guard)).toBe("tightening");
    expect(classifyRule("spend_guard", V7.spend_guard, at(200, 90000))).toBe("loosening");
    expect(classifyRule("spend_guard", V7.spend_guard, { ...V7.spend_guard, enabled: false })).toBe(
      "loosening",
    );
  });

  it("is neutral when two unlimited caps stay unlimited", () => {
    expect(
      classifyRule(
        "spend_guard",
        { ...V7.spend_guard, enabled: false },
        { enabled: false, conditions: { monthly_cap_cents: 1 } },
      ),
    ).toBe("neutral");
  });
});

describe("dry_run_new_repos", () => {
  it("is loosening when fewer loops stay in dry-run, tightening when more do", () => {
    expect(
      classifyRule("dry_run_new_repos", V7.dry_run_new_repos, {
        enabled: true,
        conditions: { first_n_loops: 5 },
      }),
    ).toBe("loosening");
    expect(
      classifyRule("dry_run_new_repos", V7.dry_run_new_repos, {
        enabled: true,
        conditions: { first_n_loops: 20 },
      }),
    ).toBe("tightening");
    expect(
      classifyRule("dry_run_new_repos", V7.dry_run_new_repos, {
        ...V7.dry_run_new_repos,
        enabled: false,
      }),
    ).toBe("loosening");
  });
});

describe("a custom rule", () => {
  it("is loosening on any change — nothing in this release enforces it, so nothing can judge it", () => {
    const rule = { enabled: true, conditions: { label: "freeze" } };

    expect(classifyRule("custom:freeze-friday", undefined, rule)).toBe("loosening");
    expect(classifyRule("custom:freeze-friday", rule, undefined)).toBe("loosening");
  });
});

describe("diffPolicies", () => {
  it("lists only the rules that changed, in the card's order, with their class and line", () => {
    const after = {
      ...edit("auto_merge", { ...V7.auto_merge, enabled: false }),
      dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 5 } },
      "custom:freeze": { enabled: true, conditions: { label: "freeze" } },
    };

    expect(diffPolicies(V7, after)).toEqual({
      changes: [
        {
          ruleId: "auto_merge",
          classification: "tightening",
          verb: "disabled",
          summary: "disabled auto-merge",
        },
        {
          ruleId: "dry_run_new_repos",
          classification: "loosening",
          verb: "changed",
          summary: "changed dry-run for new repos",
        },
        {
          ruleId: "custom:freeze",
          classification: "loosening",
          verb: "enabled",
          summary: "enabled custom:freeze",
        },
      ],
      classification: "loosening",
    });
  });

  it("is tightening when nothing loosens", () => {
    expect(
      diffPolicies(
        V7,
        edit("human_review", {
          enabled: true,
          conditions: { any: [{ label: "refactor" }, { effort_gte: "m" }] },
        }),
      ).classification,
    ).toBe("tightening");
  });

  it("finds nothing in a document that only reorders its keys", () => {
    const reordered = {
      dry_run_new_repos: { conditions: { first_n_loops: 10 }, enabled: true },
      ...V7,
    };

    expect(diffPolicies(V7, reordered)).toEqual({ changes: [], classification: "neutral" });
  });

  it("names a removed custom rule", () => {
    const before = { ...V7, "custom:freeze": { enabled: true, conditions: { label: "freeze" } } };

    expect(diffPolicies(before, V7).changes).toEqual([
      {
        ruleId: "custom:freeze",
        classification: "loosening",
        verb: "removed",
        summary: "removed custom:freeze",
      },
    ]);
  });

  it("compares a first publish with no policy at all", () => {
    const first = diffPolicies(null, V7);

    expect(first.changes.map((change) => change.ruleId)).toEqual([
      "auto_merge",
      "human_review",
      "protected_paths",
      "spend_guard",
      "dry_run_new_repos",
    ]);
    expect(first.changes.every((change) => change.classification === "tightening")).toBe(true);
    expect(first.changes[0].summary).toBe("enabled auto-merge");
  });
});

describe("the audit line", () => {
  it("is the mockup's — enabled auto-merge (policy v8)", () => {
    expect(
      publishSummary(diffPolicies(edit("auto_merge", { ...V7.auto_merge, enabled: false }), V7), 8),
    ).toBe("enabled auto-merge (policy v8)");
  });

  it("joins several changes", () => {
    const after = {
      ...edit("auto_merge", { ...V7.auto_merge, enabled: false }),
      spend_guard: { enabled: true, conditions: { per_run_cap_cents: 100 } },
    };

    expect(publishSummary(diffPolicies(V7, after), 9)).toBe(
      "disabled auto-merge, changed the spend guard (policy v9)",
    );
  });

  it("names rules as the card does", () => {
    expect(ruleName("human_review")).toBe("human review");
    expect(ruleName("custom:freeze")).toBe("custom:freeze");
  });
});

describe("the typed changes fact (#486)", () => {
  it("writes rule:verb pairs the audit plane composes the line from", () => {
    const before = { ...V7, "custom:freeze": { enabled: true, conditions: { label: "freeze" } } };
    const diff = diffPolicies(before, edit("auto_merge", { ...V7.auto_merge, enabled: false }));

    expect(ruleChangesFact(diff)).toBe("auto_merge:disabled,custom:freeze:removed");
  });

  it("reads it back, splitting a custom rule id at its last colon", () => {
    expect(parseRuleChanges("auto_merge:enabled,custom:freeze:removed")).toEqual([
      { ruleId: "auto_merge", verb: "enabled" },
      { ruleId: "custom:freeze", verb: "removed" },
    ]);
  });

  it("drops malformed entries and anything that is not text", () => {
    expect(parseRuleChanges("auto_merge:exploded,:enabled,nocolon")).toEqual([]);
    expect(parseRuleChanges(7)).toEqual([]);
    expect(parseRuleChanges("")).toEqual([]);
  });

  it("phrases a change as the dialog does", () => {
    expect(ruleChangePhrase("auto_merge", "enabled")).toBe("enabled auto-merge");
  });
});

describe("canonical", () => {
  it("ignores key order and undefined members, and keeps array order", () => {
    expect(canonical({ b: 1, a: [2, 1], c: undefined })).toBe(canonical({ a: [2, 1], b: 1 }));
    expect(canonical({ a: [1, 2] })).not.toBe(canonical({ a: [2, 1] }));
  });
});
