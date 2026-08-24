import type { EscalationThen } from "../db/schema";
import { RULE_CODES } from "./explanations";
import type { PlannedHop, RuleSpec } from "./inputs";
import {
  actionOf,
  applyRules,
  matchedRules,
  mergeParams,
  ruleParams,
  sortParams,
  targetAlias,
  targetTaskKind,
} from "./rules";
import { aliasNamed, ALIASES, IMPLEMENT_HOPS, RULES } from "./routing.fixture";

/**
 * M5's three actions, and the one property that keeps a chain a chain.
 *
 * `use_alias` **never shortens the chain**. A rule that says *use the better model for large
 * work* is asking for a better primary, not for a shallower fallback chain, and a
 * substitution that discarded hop 1 would quietly reduce the number of providers a run can
 * survive the loss of. The three cases below — already primary, elsewhere in the chain, not in
 * it — are the three ways that could go wrong, and each asserts the chain's length as well as
 * its order.
 */

/** The stored chain, planned — what `applyRules` is handed. */
const PLANNED: readonly PlannedHop[] = IMPLEMENT_HOPS.map((hop) => ({
  position: hop.position,
  note: hop.note,
  target: hop.target,
  params: sortParams(hop.target.params),
}));

/** One `use_alias` rule pointed at a name. */
function useAlias(alias: string, params?: Record<string, unknown>): RuleSpec {
  const use_alias =
    params === undefined
      ? { task_kind: "implement", alias }
      : { task_kind: "implement", alias, params };

  return { ...RULES[0], then: { use_alias } };
}

describe("reading a rule's then", () => {
  const cases: readonly [string, EscalationThen, string | null, string | null][] = [
    [
      "use_alias",
      { use_alias: { task_kind: "implement", alias: "coder-max" } },
      "implement",
      "coder-max",
    ],
    [
      "add_vote",
      { add_vote: { task_kind: "review", alias: "second-opinion" } },
      "review",
      "second-opinion",
    ],
    ["route_local", { route_local: {} }, null, null],
  ];

  it.each(cases)("reads %s", (action, then, kind, alias) => {
    expect(actionOf(then)).toBe(action);
    expect(targetTaskKind(then)).toBe(kind);
    expect(targetAlias(then)).toBe(alias);
  });

  it("gives route_local no task kind, which is what everything means", () => {
    // The mockup's *"docs-only diff → everything routes local"*. *Everything* is exactly the
    // absence of this field.
    expect(targetTaskKind({ route_local: {} })).toBeNull();
  });

  it("answers with an empty params object for the actions that carry none", () => {
    expect(ruleParams({ add_vote: { task_kind: "review", alias: "second-opinion" } })).toEqual({});
    expect(ruleParams({ route_local: {} })).toEqual({});
  });
});

describe("merging params", () => {
  it("lets the rule win, because the rule is the more specific statement", () => {
    expect(mergeParams({ thinking: "std", temperature: 0.2 }, { thinking: "max" })).toEqual({
      temperature: 0.2,
      thinking: "max",
    });
  });

  it("sorts the keys, which is half of what makes a resolution byte-stable", () => {
    expect(
      Object.keys(mergeParams({ token_budget: 1 }, { context_clamp: 2, thinking: "max" })),
    ).toEqual(["context_clamp", "thinking", "token_budget"]);
  });

  it("keeps a value the rule does not mention", () => {
    expect(mergeParams({ temperature: 0.2 }, {})).toEqual({ temperature: 0.2 });
  });
});

describe("selecting the rules that matched", () => {
  it("keeps them in sort_order rather than re-sorting", () => {
    // The caller loaded them ordered. Re-sorting here would hide a repository that forgot to.
    const matched = matchedRules(RULES, {
      effort: "xl",
      labels: ["security"],
      diffKind: "docs_only",
    });

    expect(matched.map((rule) => rule.sortOrder)).toEqual([1, 2, 3]);
  });

  it("selects none for a context that states nothing", () => {
    expect(matchedRules(RULES, {})).toEqual([]);
  });
});

describe("applying use_alias", () => {
  it("merges params when the alias is already the primary", () => {
    const applied = applyRules(
      PLANNED,
      [useAlias("coder-max", { thinking: "max" })],
      ALIASES,
      "implement",
    );

    expect(applied.outcomes[0].code).toBe(RULE_CODES.paramsMerged);
    expect(applied.chain).toHaveLength(3);
    expect(applied.chain[0].params).toEqual({ thinking: "max" });
    expect(applied.chain.map((hop) => hop.target.alias)).toEqual([
      "coder-max",
      "coder-fallback",
      "local-docs",
    ]);
  });

  it("moves an alias already in the chain to the front, exactly once", () => {
    const applied = applyRules(PLANNED, [useAlias("local-docs")], ALIASES, "implement");

    expect(applied.outcomes[0].code).toBe(RULE_CODES.swapped);
    expect(applied.chain).toHaveLength(3);
    expect(applied.chain.map((hop) => hop.target.alias)).toEqual([
      "local-docs",
      "coder-max",
      "coder-fallback",
    ]);
  });

  it("keeps a moved hop's stored position and its operator note", () => {
    // The hop is the same hop; only its place in the resolved chain changed. Losing the
    // position would move the floor, and losing the note would erase an operator's sentence.
    const [moved] = applyRules(PLANNED, [useAlias("local-docs")], ALIASES, "implement").chain;

    expect(moved.position).toBe(3);
    expect(moved.note).toBe("Offline mode — keeps the loop turning without a network");
  });

  it("prepends an alias the chain does not contain, and keeps every hop", () => {
    const applied = applyRules(PLANNED, [useAlias("coder-std")], ALIASES, "implement");

    expect(applied.outcomes[0].code).toBe(RULE_CODES.prepended);
    expect(applied.chain).toHaveLength(4);
    expect(applied.chain[0].position).toBeNull();
    expect(applied.chain[0].note).toBeNull();
  });

  it("does not mutate the chain it was given", () => {
    // A pure function that edited its argument would make two consecutive resolutions of one
    // route disagree, which is the determinism criterion failing in the least visible way.
    applyRules(PLANNED, [useAlias("coder-std")], ALIASES, "implement");

    expect(PLANNED.map((hop) => hop.target.alias)).toEqual([
      "coder-max",
      "coder-fallback",
      "local-docs",
    ]);
  });
});

describe("applying add_vote", () => {
  /** The security rule, retargeted at the kind under test. */
  const vote: RuleSpec = {
    ...RULES[1],
    then: { add_vote: { task_kind: "implement", alias: "second-opinion" } },
  };

  it("claims the vote and leaves the chain alone", () => {
    const applied = applyRules(PLANNED, [vote], ALIASES, "implement");

    expect(applied.outcomes[0].code).toBe(RULE_CODES.voteAdded);
    expect(applied.votes).toEqual([{ target: aliasNamed("second-opinion"), ruleId: vote.id }]);
    expect(applied.chain).toEqual(PLANNED);
  });

  it("does not claim the same vote twice", () => {
    // Two rules asking for one second opinion is a workspace's own configuration, not an
    // instruction to run the model twice — and the second rule is told so rather than ignored.
    const applied = applyRules(
      PLANNED,
      [vote, { ...vote, id: "another-rule", sortOrder: 4 }],
      ALIASES,
      "implement",
    );

    expect(applied.votes).toHaveLength(1);
    expect(applied.outcomes[1].code).toBe(RULE_CODES.voteAlreadyAdded);
    expect(applied.outcomes[1].applied).toBe(false);
  });
});

describe("applying route_local", () => {
  it("raises the flag the walk turns into per-hop drops", () => {
    const applied = applyRules(PLANNED, [RULES[2]], ALIASES, "implement");

    expect(applied.routeLocal).toBe(true);
    expect(applied.outcomes[0].code).toBe(RULE_CODES.routedLocal);
    // The filtering itself is the walk's, because a hop removed here would lose its
    // explanation on the way out.
    expect(applied.chain).toEqual(PLANNED);
  });

  it("applies to every kind, having named none", () => {
    for (const taskKind of ["implement", "review", "commit-msg"]) {
      expect(applyRules(PLANNED, [RULES[2]], ALIASES, taskKind).routeLocal).toBe(true);
    }
  });
});

describe("a rule that cannot be applied", () => {
  it("reports a rule for another kind rather than dropping it", () => {
    const applied = applyRules(PLANNED, [RULES[1]], ALIASES, "implement");

    expect(applied.outcomes[0].applied).toBe(false);
    expect(applied.outcomes[0].code).toBe(RULE_CODES.otherTaskKind);
    expect(applied.votes).toEqual([]);
  });

  it("reports a rule naming an alias this workspace does not have", () => {
    const applied = applyRules(PLANNED, [useAlias("nonexistent")], ALIASES, "implement");

    expect(applied.outcomes[0].code).toBe(RULE_CODES.aliasUnresolvable);
    expect(applied.chain).toEqual(PLANNED);
  });

  it("reports a rule naming an alias V019 left unbound", () => {
    const unbound = { ...aliasNamed("coder-std"), alias: "gpt5-experiments", binding: null };
    const applied = applyRules(
      PLANNED,
      [useAlias("gpt5-experiments")],
      [...ALIASES, unbound],
      "implement",
    );

    expect(applied.outcomes[0].code).toBe(RULE_CODES.aliasUnresolvable);
    expect(applied.chain).toEqual(PLANNED);
  });
});

describe("every matched rule's record", () => {
  it("carries the sentence the card renders, unchanged", () => {
    // Decision M5: `display` is a generated column, so reporting it is what stops the
    // explanation panel and the rules card printing two sentences for one rule.
    const applied = applyRules(PLANNED, [RULES[0]], ALIASES, "implement");

    expect(applied.outcomes[0].display).toBe(
      "effort ≥ L → implement uses coder-max (max thinking)",
    );
    expect(applied.outcomes[0].id).toBe(RULES[0].id);
    expect(applied.outcomes[0].sortOrder).toBe(1);
  });
});
