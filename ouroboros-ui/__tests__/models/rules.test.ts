import { describe, expect, it } from "vitest";

import type { EscalationRule } from "@/app/api/routing";
import {
  ACTIONS,
  LABEL_REQUIRED,
  NO_ALIASES,
  NO_TASK_KINDS,
  PREDICATES,
  THINKING_CHOICES,
  activeCountLabel,
  activeRuleCount,
  composeRule,
  composeThen,
  composeWhen,
  deleteRuleLabel,
  initialDraft,
  needsTarget,
  ruleAlias,
  ruleSegments,
  ruleSwitchLabel,
  ruleTarget,
  withAliases,
} from "@/app/models/rules";

import { seededAliases, seededRules, seededTaskKinds } from "../helpers/models";

/**
 * The rules card's decisions (#204), as functions over the dev seed's three rules.
 *
 * Two properties carry this suite. **The sentence is never composed**: `ruleSegments`
 * concatenates back to `display` character for character, and the only thing it decides is
 * which run is violet. **Invalid structures are unreachable**: `composeRule` is total over
 * every value the builder's selects can hold, and produces a document the contract admits
 * for every one of them.
 */

/** The seeded workspace's kinds and aliases, as the builder is handed them. */
const KINDS = seededTaskKinds().map((kind) => kind.name);
const ALIASES = seededAliases().map((alias) => alias.alias);

describe("the count", () => {
  it("counts the enabled rules, which is the contract's own definition of `N active`", () => {
    expect(activeRuleCount(seededRules())).toBe(3);
  });

  it("leaves a disabled rule out, while it keeps its row", () => {
    const rules = seededRules().map((rule, index) => ({ ...rule, enabled: index !== 1 }));

    expect(activeRuleCount(rules)).toBe(2);
  });

  it("labels the chip as the mockup prints it, and draws a zero rather than hiding it", () => {
    expect(activeCountLabel(3)).toBe("3 active");
    expect(activeCountLabel(0)).toBe("0 active");
  });
});

describe("the alias in the sentence", () => {
  it("finds the alias each seeded rule names, and none for the one that names none", () => {
    expect(seededRules().map(ruleAlias)).toEqual(["coder-max", "second-opinion", null]);
  });

  it("splits the seeded sentences at the alias and nowhere else", () => {
    expect(ruleSegments(seededRules()[0])).toEqual([
      { text: "effort ≥ L → implement uses ", alias: false },
      { text: "coder-max", alias: true },
      { text: " (max thinking)", alias: false },
    ]);
    expect(ruleSegments(seededRules()[1])).toEqual([
      { text: "security label → review adds ", alias: false },
      { text: "second-opinion", alias: true },
      { text: " vote", alias: false },
    ]);
  });

  it("draws a rule naming no alias in one piece", () => {
    expect(ruleSegments(seededRules()[2])).toEqual([
      { text: "docs-only diff → everything routes local", alias: false },
    ]);
  });

  it("concatenates back to the server's sentence, character for character", () => {
    for (const rule of seededRules()) {
      expect(ruleSegments(rule).map((segment) => segment.text).join("")).toBe(rule.display);
    }
  });

  it("finds the alias after the verb, not a task kind spelt the same way", () => {
    // `docs uses docs`: the kind and the alias share a spelling, and the highlight must land
    // on the second.
    const rule: EscalationRule = {
      ...seededRules()[0],
      then: { use_alias: { task_kind: "docs", alias: "docs" } },
      display: "effort ≥ L → docs uses docs",
    };

    expect(ruleSegments(rule)).toEqual([
      { text: "effort ≥ L → docs uses ", alias: false },
      { text: "docs", alias: true },
    ]);
  });

  it("draws a sentence in one piece rather than guessing when the alias is not where the grammar puts it", () => {
    const rule: EscalationRule = {
      ...seededRules()[0],
      display: "a sentence the database has since learned to render differently",
    };

    expect(ruleSegments(rule)).toEqual([{ text: rule.display, alias: false }]);
  });
});

describe("the controls' names", () => {
  it("names a switch by what it decides and which rule it is for", () => {
    expect(ruleSwitchLabel(seededRules()[2])).toBe(
      "Apply docs-only diff → everything routes local",
    );
  });

  it("names a delete by which rule it is for", () => {
    expect(deleteRuleLabel(seededRules()[1])).toBe(
      "Delete rule: security label → review adds second-opinion vote",
    );
  });
});

describe("the builder's targets", () => {
  it("labels an alias with the same resolution line the matrix draws for it", () => {
    expect(ruleTarget(seededAliases()[1])).toEqual({
      alias: "coder-max",
      resolution: "claude-fable-5 · Anthropic Claude",
    });
  });

  it("says an unbound alias has no provider rather than stopping at the model", () => {
    expect(ruleTarget(seededAliases()[3])).toEqual({
      alias: "gpt5-experiments",
      resolution: "gpt-5 · no provider",
    });
  });
});

describe("the draft", () => {
  it("opens on mockup 06's own first rule, targeting the workspace's first kind and alias", () => {
    expect(initialDraft(KINDS, ALIASES)).toEqual({
      predicate: "effort_gte",
      effort: "l",
      label: "",
      diffKind: "docs_only",
      action: "use_alias",
      taskKind: "analyze",
      alias: "coder-fallback",
      thinking: "max",
    });
  });

  it("holds an empty target for a workspace with nothing to name", () => {
    expect(initialDraft([], []).taskKind).toBe("");
    expect(initialDraft([]).alias).toBe("");
  });

  it("fills in the first alias once the registry arrives, and only when none was chosen", () => {
    const empty = initialDraft(KINDS);

    expect(withAliases(empty, ALIASES).alias).toBe("coder-fallback");
    expect(withAliases({ ...empty, alias: "sizer" }, ALIASES).alias).toBe("sizer");
    expect(withAliases(empty, []).alias).toBe("");
  });

  it("knows which actions name a target", () => {
    expect(ACTIONS.map(needsTarget)).toEqual([true, true, false]);
  });
});

describe("composing the predicate", () => {
  it("produces exactly one condition for each predicate", () => {
    const draft = initialDraft(KINDS, ALIASES);

    expect(composeWhen({ ...draft, predicate: "effort_gte", effort: "xl" })).toEqual({
      effort_gte: "xl",
    });
    expect(composeWhen({ ...draft, predicate: "label", label: "security" })).toEqual({
      label: "security",
    });
    expect(composeWhen({ ...draft, predicate: "diff_kind" })).toEqual({ diff_kind: "docs_only" });
  });

  it("trims a label rather than sending whitespace the schema refuses", () => {
    expect(composeWhen({ ...initialDraft(KINDS), predicate: "label", label: "  security " })).toEqual({
      label: "security",
    });
  });

  it("produces nothing for a blank label, because an empty predicate is a route", () => {
    expect(composeWhen({ ...initialDraft(KINDS), predicate: "label", label: "   " })).toBeNull();
  });
});

describe("composing the action", () => {
  const draft = { ...initialDraft(KINDS, ALIASES), taskKind: "implement", alias: "coder-max" };

  it("reproduces the seed's use_alias rule, params and all", () => {
    expect(composeThen({ ...draft, action: "use_alias", thinking: "max" })).toEqual(
      seededRules()[0].then,
    );
  });

  it("sends no params at all when the alias's own thinking is to stand", () => {
    // The contract refuses an empty `params` object; absence is how "no params" is said.
    const then = composeThen({ ...draft, action: "use_alias", thinking: "inherit" });

    expect(then).toEqual({ use_alias: { task_kind: "implement", alias: "coder-max" } });
    expect("params" in (then as { use_alias: object }).use_alias).toBe(false);
  });

  it("reproduces the seed's add_vote rule, which carries no params", () => {
    expect(
      composeThen({ ...draft, action: "add_vote", taskKind: "review", alias: "second-opinion" }),
    ).toEqual(seededRules()[1].then);
  });

  it("reproduces the seed's route_local rule, which names nothing", () => {
    expect(composeThen({ ...draft, action: "route_local" })).toEqual({ route_local: {} });
  });
});

describe("composing the rule", () => {
  it("is total over every predicate, action and thinking choice the selects can hold", () => {
    // Invalid combinations are unreachable: every cell of the grid is a rule the contract
    // admits, with `when` and `then` and nothing else.
    for (const predicate of PREDICATES) {
      for (const action of ACTIONS) {
        for (const thinking of THINKING_CHOICES) {
          const composed = composeRule(
            { ...initialDraft(KINDS, ALIASES), predicate, action, thinking, label: "security" },
            KINDS,
            ALIASES,
          );

          expect(composed.ok).toBe(true);
          if (composed.ok) {
            expect(Object.keys(composed.rule)).toEqual(["when", "then"]);
            expect(Object.keys(composed.rule.when)).toHaveLength(1);
            expect(Object.keys(composed.rule.then)).toHaveLength(1);
          }
        }
      }
    }
  });

  it("reproduces each of the seed's three rules from a draft", () => {
    const base = initialDraft(KINDS, ALIASES);
    const drafts = [
      { ...base, taskKind: "implement", alias: "coder-max" },
      { ...base, predicate: "label" as const, label: "security", action: "add_vote" as const, taskKind: "review", alias: "second-opinion" },
      { ...base, predicate: "diff_kind" as const, action: "route_local" as const },
    ];

    expect(drafts.map((draft) => composeRule(draft, KINDS, ALIASES))).toEqual(
      seededRules().map((rule) => ({ ok: true, rule: { when: rule.when, then: rule.then } })),
    );
  });

  it("carries a reason rather than a rule while the label is blank", () => {
    expect(
      composeRule({ ...initialDraft(KINDS, ALIASES), predicate: "label" }, KINDS, ALIASES),
    ).toEqual({ ok: false, reason: LABEL_REQUIRED });
  });

  it("carries a reason for a workspace with no task kinds to name", () => {
    expect(composeRule(initialDraft([], ALIASES), [], ALIASES)).toEqual({
      ok: false,
      reason: NO_TASK_KINDS,
    });
  });

  it("carries a reason for a workspace with no aliases to name", () => {
    expect(composeRule(initialDraft(KINDS), KINDS, [])).toEqual({
      ok: false,
      reason: NO_ALIASES,
    });
  });

  it("needs no target for route_local, even in a workspace with nothing to name", () => {
    const composed = composeRule({ ...initialDraft([], []), action: "route_local" }, [], []);

    expect(composed).toEqual({ ok: true, rule: { when: { effort_gte: "l" }, then: { route_local: {} } } });
  });

  it("refuses a target the workspace does not have, whatever the draft claims", () => {
    // A select can emit only its options, but the composer checks rather than assumes.
    expect(
      composeRule({ ...initialDraft(KINDS, ALIASES), alias: "nope" }, KINDS, ALIASES),
    ).toEqual({ ok: false, reason: NO_ALIASES });
  });
});
