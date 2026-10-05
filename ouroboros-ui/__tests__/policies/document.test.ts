import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CORE_RULES,
  type CoreRuleId,
  EFFORTS,
  LABEL_MAX_LENGTH,
  LOOPS_MAX,
  NEEDS_A_CAP,
  NEEDS_A_CONDITION,
  type PolicyDocument,
  type PolicyDrafts,
  RULE_NAMES,
  RULE_REASONS,
  TERMS_MAX,
  UNPUBLISHED_DOCUMENT,
  clampLoops,
  composeDocument,
  composeRule,
  draftsOf,
  effortLabel,
  firstLoopsChip,
  isEffort,
  labelProblem,
  monthlyChip,
  parseAutoMerge,
  parseDryRun,
  parseHumanReview,
  parseProtectedPaths,
  parseSpendGuard,
  perRunChip,
  predicateText,
  ruleChips,
  termCount,
  validatePolicy,
  workingDocument,
} from "@/app/policies/document";

/**
 * The org policy document as the card reads, edits and states it
 * (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)): the seeded v7 draws mockup
 * 17's chips exactly; a document parsed and composed with nothing changed is the document; a rule
 * the chip editor cannot represent is never rewritten; and no draft the parsers produce breaks
 * its rule's invariant.
 */

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "schemas", "org-policy", "fixtures", "valid");

/**
 * A shipped fixture, as the service would answer it.
 *
 * @param name The fixture's file name.
 * @returns The document.
 */
function fixture(name: string): PolicyDocument {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as PolicyDocument;
}

const V7 = fixture("policy-v7.json");
const ALL_DISABLED = fixture("all-disabled.json");
const CUSTOM = fixture("custom-rule.json");

describe("the seeded card's chips", () => {
  it.each<[CoreRuleId, string[]]>([
    ["auto_merge", ["effort ≤ M", "non-refactor"]],
    ["human_review", ["label:refactor", "OR effort ≥ L"]],
    ["protected_paths", ["boot/", "keys/", ".github/"]],
    ["spend_guard", ["pause loop at $2.50/run", "monthly cap $600/provider"]],
    ["dry_run_new_repos", ["first 10 loops open draft PRs"]],
  ])("draws %s exactly as mockup 17 does", (id, chips) => {
    expect(ruleChips(id, V7[id])).toEqual(chips);
  });

  it("names and explains the five rules in the mockup's words and order", () => {
    expect(CORE_RULES.map((id) => RULE_NAMES[id])).toEqual([
      "Auto-merge when all gates green",
      "Human review required",
      "Protected paths need allow-once",
      "Spend guard",
      "Dry-run mode for new repos",
    ]);
    expect(RULE_REASONS.spend_guard).toBe("Runaway loops stop before they get expensive.");
  });
});

describe("chips for every shape the grammar admits", () => {
  it.each<[unknown, string]>([
    [{ effort_lte: "xs" }, "effort ≤ XS"],
    [{ effort_gte: "xl" }, "effort ≥ XL"],
    [{ label: "hotfix" }, "label:hotfix"],
    [{ not: { label: "refactor" } }, "non-refactor"],
    [{ not: { effort_gte: "l" } }, "NOT effort ≥ L"],
    [{ any: [{ label: "a" }, { effort_gte: "l" }] }, "(label:a OR effort ≥ L)"],
    [{ all: [{ label: "a" }, { not: { label: "b" } }] }, "(label:a AND non-b)"],
    [{ all: [{ label: "a" }] }, "label:a"],
    [{ not: { any: [{ label: "a" }, { label: "b" }] } }, "NOT (label:a OR label:b)"],
  ])("writes %j as %s", (predicate, text) => {
    expect(predicateText(predicate)).toBe(text);
  });

  it("falls back to the JSON for something that is not a predicate, rather than hiding it", () => {
    expect(predicateText({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
    expect(predicateText({ effort_lte: "huge" })).toBe('{"effort_lte":"huge"}');
  });

  it("says OR on every term of a top-level any after the first, and nothing on an all", () => {
    const rule = (conditions: Record<string, unknown>) => ({ enabled: true, conditions });

    expect(ruleChips("human_review", rule({ any: [{ label: "a" }, { label: "b" }, { effort_gte: "m" }] }))).toEqual([
      "label:a",
      "OR label:b",
      "OR effort ≥ M",
    ]);
    expect(ruleChips("auto_merge", rule({ all: [{ effort_lte: "s" }, { not: { label: "a" } }] }))).toEqual([
      "effort ≤ S",
      "non-a",
    ]);
    expect(ruleChips("auto_merge", rule({ effort_lte: "s" }))).toEqual(["effort ≤ S"]);
    expect(ruleChips("auto_merge", rule({}))).toEqual([]);
  });

  it("keeps a nested term legible on one chip", () => {
    expect(
      ruleChips("auto_merge", {
        enabled: true,
        conditions: { all: [{ effort_lte: "m" }, { any: [{ label: "docs" }, { label: "chore" }] }] },
      }),
    ).toEqual(["effort ≤ M", "(label:docs OR label:chore)"]);
  });

  it("abbreviates only 'everything under a directory', and shows any other glob as written", () => {
    expect(
      ruleChips("protected_paths", {
        enabled: true,
        conditions: { path_globs: ["boot/**", "drivers/*/isr.c", "src/**/keys/**", "LICENSE"] },
      }),
    ).toEqual(["boot/", "drivers/*/isr.c", "src/**/keys/**", "LICENSE"]);
    expect(ruleChips("protected_paths", { enabled: false, conditions: { path_globs: [] } })).toEqual([]);
  });

  it("draws one cap when only one is set", () => {
    expect(ruleChips("spend_guard", ALL_DISABLED.spend_guard)).toEqual(["monthly cap $600/provider"]);
    expect(perRunChip(1999)).toBe("pause loop at $19.99/run");
    expect(monthlyChip(120_000)).toBe("monthly cap $1,200/provider");
  });

  it("words the loop count for zero, one and many", () => {
    expect(firstLoopsChip(0)).toBe("no loops held as drafts");
    expect(firstLoopsChip(1)).toBe("first loop opens a draft PR");
    expect(firstLoopsChip(25)).toBe("first 25 loops open draft PRs");
  });

  it("draws every term a custom rule carries", () => {
    expect(ruleChips("custom:night-freeze", CUSTOM["custom:night-freeze"])).toEqual([
      "label:hotfix",
      "drivers/",
      "pause loop at $1/run",
    ]);
  });

  it("upper-cases an effort, and knows the five", () => {
    expect(EFFORTS.map(effortLabel)).toEqual(["XS", "S", "M", "L", "XL"]);
    expect(isEffort("m")).toBe(true);
    expect(isEffort("M")).toBe(false);
    expect(isEffort(3)).toBe(false);
  });
});

describe("document → drafts", () => {
  it("reads v7 as the five structured drafts", () => {
    expect(draftsOf(V7)).toEqual({
      auto_merge: { enabled: true, terms: { maxEffort: "m", excludedLabels: ["refactor"] } },
      human_review: { enabled: true, terms: { labels: ["refactor"], minEffort: "l" } },
      protected_paths: { enabled: true, terms: { globs: ["boot/**", "keys/**", ".github/**"] } },
      spend_guard: { enabled: true, terms: { perRunCents: 250, monthlyCents: 60_000 } },
      dry_run_new_repos: { enabled: true, terms: { firstLoops: 10 } },
    } satisfies PolicyDrafts);
  });

  it("reads a single comparison as a list of one", () => {
    expect(parseAutoMerge({ effort_lte: "s" })).toEqual({ maxEffort: "s", excludedLabels: [] });
    expect(parseAutoMerge({ not: { label: "x" } })).toEqual({ maxEffort: null, excludedLabels: ["x"] });
    expect(parseHumanReview({ label: "x" })).toEqual({ labels: ["x"], minEffort: null });
    expect(parseHumanReview({ effort_gte: "xl" })).toEqual({ labels: [], minEffort: "xl" });
  });

  it.each<[string, unknown]>([
    ["a nested composition", { all: [{ effort_lte: "m" }, { any: [{ label: "a" }] }] }],
    ["the other composition", { any: [{ effort_lte: "m" }] }],
    ["a positive label", { all: [{ label: "a" }] }],
    ["the other comparison", { all: [{ effort_gte: "m" }] }],
    ["two efforts", { all: [{ effort_lte: "m" }, { effort_lte: "s" }] }],
    ["a repeated label", { all: [{ not: { label: "a" } }, { not: { label: "a" } }] }],
    ["a negated effort", { all: [{ not: { effort_lte: "m" } }] }],
    ["an unknown effort", { all: [{ effort_lte: "huge" }] }],
    ["an empty list", { all: [] }],
    ["a two-key predicate", { effort_lte: "m", label: "a" }],
    ["a list that is not one", { all: "nope" }],
    ["nothing", null],
  ])("does not pretend to edit auto_merge with %s", (_name, conditions) => {
    expect(parseAutoMerge(conditions)).toBeNull();
  });

  it.each<[string, unknown]>([
    ["a nested composition", { any: [{ label: "a" }, { all: [{ label: "b" }] }] }],
    ["the other composition", { all: [{ label: "a" }] }],
    ["a negation", { any: [{ not: { label: "a" } }] }],
    ["two efforts", { any: [{ effort_gte: "m" }, { effort_gte: "l" }] }],
    ["a repeated label", { any: [{ label: "a" }, { label: "a" }] }],
    ["an over-long label", { any: [{ label: "x".repeat(LABEL_MAX_LENGTH + 1) }] }],
    ["an empty label", { any: [{ label: "" }] }],
    ["an empty list", { any: [] }],
  ])("does not pretend to edit human_review with %s", (_name, conditions) => {
    expect(parseHumanReview(conditions)).toBeNull();
  });

  it("reads globs, caps and loop counts only in their exact shapes", () => {
    expect(parseProtectedPaths({ path_globs: [] })).toEqual({ globs: [] });
    expect(parseProtectedPaths({ path_globs: ["a/**", 3] })).toBeNull();
    expect(parseProtectedPaths({ path_globs: ["a/**"], label: "x" })).toBeNull();
    expect(parseProtectedPaths({})).toBeNull();

    expect(parseSpendGuard({ per_run_cap_cents: 250 })).toEqual({ perRunCents: 250, monthlyCents: null });
    expect(parseSpendGuard({ monthly_cap_cents: 1 })).toEqual({ perRunCents: null, monthlyCents: 1 });
    expect(parseSpendGuard({})).toBeNull();
    expect(parseSpendGuard({ per_run_cap_cents: 2.5 })).toBeNull();
    expect(parseSpendGuard({ per_run_cap_cents: 0 })).toBeNull();
    expect(parseSpendGuard({ per_run_cap_cents: "250" })).toBeNull();
    expect(parseSpendGuard({ per_run_cap_cents: 250, label: "x" })).toBeNull();
    expect(parseSpendGuard([])).toBeNull();

    expect(parseDryRun({ first_n_loops: 0 })).toEqual({ firstLoops: 0 });
    expect(parseDryRun({ first_n_loops: LOOPS_MAX })).toEqual({ firstLoops: LOOPS_MAX });
    expect(parseDryRun({ first_n_loops: LOOPS_MAX + 1 })).toBeNull();
    expect(parseDryRun({ first_n_loops: -1 })).toBeNull();
    expect(parseDryRun({ first_n_loops: 1.5 })).toBeNull();
    expect(parseDryRun({ first_n_loops: 1, label: "x" })).toBeNull();
  });

  it("never produces a draft that breaks its rule's invariant", () => {
    for (const document of [V7, ALL_DISABLED, CUSTOM, UNPUBLISHED_DOCUMENT]) {
      expect(validatePolicy(draftsOf(document))).toEqual({});
    }
  });

  it("gives an unpublished workspace five rules, all off, and fills what a partial document lacks", () => {
    expect(workingDocument(null)).toEqual(UNPUBLISHED_DOCUMENT);
    expect(CORE_RULES.every((id) => !UNPUBLISHED_DOCUMENT[id].enabled)).toBe(true);
    expect(validatePolicy(draftsOf(UNPUBLISHED_DOCUMENT))).toEqual({});

    const partial = workingDocument({ spend_guard: V7.spend_guard });

    expect(partial.spend_guard).toBe(V7.spend_guard);
    expect(partial.auto_merge).toBe(UNPUBLISHED_DOCUMENT.auto_merge);
    expect(workingDocument(V7)).toEqual(V7);
  });
});

describe("drafts → document", () => {
  it.each([
    ["policy-v7.json", V7],
    ["all-disabled.json", ALL_DISABLED],
    ["custom-rule.json", CUSTOM],
  ])("composes %s back byte for byte when nothing was touched", (_name, document) => {
    const composed = composeDocument(document, draftsOf(document));

    expect(JSON.stringify(composed)).toBe(JSON.stringify(document));
  });

  it("carries a custom rule through an edit of a core rule", () => {
    const drafts = draftsOf(CUSTOM);
    const composed = composeDocument(CUSTOM, {
      ...drafts,
      dry_run_new_repos: { enabled: true, terms: { firstLoops: 3 } },
    });

    expect(composed["custom:night-freeze"]).toBe(CUSTOM["custom:night-freeze"]);
    expect(composed.dry_run_new_repos).toEqual({ enabled: true, conditions: { first_n_loops: 3 } });
    // Every untouched rule keeps the very conditions that were read.
    for (const id of ["auto_merge", "human_review", "protected_paths", "spend_guard"] as const) {
      expect(composed[id].conditions).toBe(CUSTOM[id].conditions);
    }
  });

  it("writes each rule's canonical form for edited terms", () => {
    const drafts = draftsOf(V7);
    const composed = composeDocument(V7, {
      auto_merge: { enabled: false, terms: { maxEffort: null, excludedLabels: ["refactor", "infra"] } },
      human_review: { enabled: true, terms: { labels: [], minEffort: "m" } },
      protected_paths: { enabled: true, terms: { globs: ["boot/**"] } },
      spend_guard: { enabled: true, terms: { perRunCents: null, monthlyCents: 1999 } },
      dry_run_new_repos: { ...drafts.dry_run_new_repos, enabled: false },
    });

    expect(composed).toEqual({
      auto_merge: {
        enabled: false,
        conditions: { all: [{ not: { label: "refactor" } }, { not: { label: "infra" } }] },
      },
      human_review: { enabled: true, conditions: { any: [{ effort_gte: "m" }] } },
      protected_paths: { enabled: true, conditions: { path_globs: ["boot/**"] } },
      spend_guard: { enabled: true, conditions: { monthly_cap_cents: 1999 } },
      dry_run_new_repos: { enabled: false, conditions: { first_n_loops: 10 } },
    });
    expect(validatePolicy(draftsOf(composed))).toEqual({});
  });

  it("puts the effort first in an all and last in an any, as the mockup reads", () => {
    expect(
      composeRule(
        "auto_merge",
        { enabled: true, terms: { maxEffort: "s", excludedLabels: ["refactor"] } },
        V7.auto_merge,
      ).conditions,
    ).toEqual({ all: [{ effort_lte: "s" }, { not: { label: "refactor" } }] });
    expect(
      composeRule(
        "human_review",
        { enabled: true, terms: { labels: ["refactor", "infra"], minEffort: "l" } },
        V7.human_review,
      ).conditions,
    ).toEqual({ any: [{ label: "refactor" }, { label: "infra" }, { effort_gte: "l" }] });
  });

  it("does not respell an equal predicate into a change: a bare comparison stays bare", () => {
    const saved = { enabled: true, conditions: { effort_lte: "s" } };
    const draft = draftsOf({ ...V7, auto_merge: saved }).auto_merge;

    expect(composeRule("auto_merge", { ...draft, enabled: false }, saved)).toEqual({
      enabled: false,
      conditions: saved.conditions,
    });
  });

  it("never rewrites a rule the chip editor cannot represent — and still draws and switches it", () => {
    const nested = {
      enabled: true,
      conditions: { all: [{ effort_lte: "m" }, { any: [{ label: "docs" }, { label: "chore" }] }] },
    };
    const document = { ...V7, auto_merge: nested };
    const drafts = draftsOf(document);

    expect(drafts.auto_merge).toEqual({ enabled: true, terms: null });
    expect(ruleChips("auto_merge", nested)).toEqual(["effort ≤ M", "(label:docs OR label:chore)"]);

    const composed = composeDocument(document, {
      ...drafts,
      auto_merge: { enabled: false, terms: null },
    });

    expect(composed.auto_merge.enabled).toBe(false);
    expect(composed.auto_merge.conditions).toBe(nested.conditions);
    expect(validatePolicy(drafts)).toEqual({});
  });
});

describe("edits that keep the invariants", () => {
  it("counts a predicate rule's terms", () => {
    expect(termCount({ maxEffort: "m", excludedLabels: ["a", "b"] })).toBe(3);
    expect(termCount({ maxEffort: null, excludedLabels: ["a"] })).toBe(1);
    expect(termCount({ labels: [], minEffort: "l" })).toBe(1);
    expect(termCount({ labels: ["a"], minEffort: null })).toBe(1);
  });

  it("says why a typed label cannot join, most specific reason first", () => {
    expect(labelProblem("", [], 0)).toBe("empty");
    expect(labelProblem("x".repeat(LABEL_MAX_LENGTH + 1), [], 0)).toBe("too_long");
    expect(labelProblem("x".repeat(LABEL_MAX_LENGTH), [], 0)).toBeNull();
    expect(labelProblem("refactor", ["refactor"], 1)).toBe("duplicate");
    expect(labelProblem("infra", ["refactor"], TERMS_MAX)).toBe("full");
    expect(labelProblem("infra", ["refactor"], TERMS_MAX - 1)).toBeNull();
  });

  it("clamps a loop count to a whole number in bounds", () => {
    expect(clampLoops(-3)).toBe(0);
    expect(clampLoops(10.9)).toBe(10);
    expect(clampLoops(LOOPS_MAX + 5)).toBe(LOOPS_MAX);
    expect(clampLoops(Number.NaN)).toBe(0);
    expect(clampLoops(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("refuses a draft built past the controls: no condition, no cap", () => {
    const drafts = draftsOf(V7);

    expect(
      validatePolicy({
        ...drafts,
        auto_merge: { enabled: true, terms: { maxEffort: null, excludedLabels: [] } },
        human_review: { enabled: true, terms: { labels: [], minEffort: null } },
        spend_guard: { enabled: true, terms: { perRunCents: null, monthlyCents: null } },
      }),
    ).toEqual({
      auto_merge: NEEDS_A_CONDITION,
      human_review: NEEDS_A_CONDITION,
      spend_guard: NEEDS_A_CAP,
    });
  });
});
