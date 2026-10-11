import { DslWarningCode } from "../workflows/dsl.errors";
import { effectiveBudget } from "./dry-runs.budget";
import { foldOperations } from "./suggestions.ops";
import {
  BUDGET_PROXIMITY,
  MIN_REPLAY_PAIRS,
  NEAR_NAME_ADEQUACY,
  REVIEWER_DISAGREEMENT,
  RULE_PACK,
  RULE_PACK_VERSION,
  SCORING_METHOD,
  SINGLE_RUN_ADEQUACY,
  SKIPPED_NOTHING_TO_DO,
  UNRESOLVED_REFERENCE_PERSISTS,
  dollars,
  evaluatePack,
  ruleById,
  score,
  type RuleFinding,
  type SuggestionRule,
} from "./suggestions.rules";
import {
  SEEDED_CATALOGUE,
  SEEDED_DRAFT,
  SEEDED_REPLAY,
  SEEDED_STAGES,
  seededInput,
  stageRow,
} from "./suggestions.seed.fixture";

const UNRESOLVED_TASK = {
  code: DslWarningCode.REFERENCE_UNKNOWN_TASK,
  node: "exploit-verify",
  name: "exploit-verify",
  path: "/nodes/9/config/routing/inherit_task",
  message: "No task route named `exploit-verify` exists in this workspace yet.",
};

/** The seeded rows, with exploit-verify skipped on its unresolved route instead. */
const UNRESOLVED_STAGES = SEEDED_STAGES.map((stage) =>
  stage.stage_key === "exploit-verify"
    ? { ...stage, skip_kind: "unresolved_reference" as const, skip_input: null }
    : stage,
);

describe("the rule pack", () => {
  it("is versioned, and every rule names itself, its version and how it scores", () => {
    expect(RULE_PACK_VERSION).toBe(1);
    expect(new Set(RULE_PACK.map((rule) => rule.id)).size).toBe(RULE_PACK.length);
    for (const rule of RULE_PACK) {
      expect(rule.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(rule.version).toBeGreaterThanOrEqual(1);
      expect(rule.firesWhen).not.toBe("");
      expect(rule.proposes).not.toBe("");
      expect(rule.scoring.strength).not.toBe("");
      expect(rule.scoring.adequacy).not.toBe("");
      expect(ruleById(rule.id)).toBe(rule);
    }
    expect(ruleById("retired-rule")).toBeUndefined();
  });

  it("reads only a run that ended with results", () => {
    for (const status of ["precheck", "running", "failed", "cancelled"] as const) {
      expect(evaluatePack(seededInput({ run: { status, costCents: 31 } }))).toEqual([]);
    }
    expect(
      evaluatePack(seededInput({ run: { status: "budget_stopped", costCents: 31 } })),
    ).not.toEqual([]);
  });

  it("takes a new rule as a pack entry", () => {
    const always: SuggestionRule = {
      id: "always",
      version: 3,
      firesWhen: "Always.",
      proposes: "Nothing.",
      scoring: { strength: "1", adequacy: "1" },
      evaluate(): RuleFinding[] {
        return [
          { title: "t", body: "b", evidence: { n: 1 }, proposedOps: [], score: score(this, 1, 1) },
        ];
      },
    };

    const [finding] = evaluatePack(seededInput(), [always]);

    expect(finding.rule).toBe(always);
    expect(finding.score).toEqual({
      confidence: 100,
      basis: {
        method: SCORING_METHOD,
        inputs: { rule: "always", rule_version: 3, rule_strength: 1, sample_adequacy: 1 },
      },
    });
  });
});

describe("scoring", () => {
  const rule = { id: "a-rule", version: 2 };

  it("is rule strength × sample adequacy, rounded, with both factors and the rule's own counts in the basis", () => {
    expect(score(rule, 0.95, 0.98, { observations: 1 })).toEqual({
      confidence: 93,
      basis: {
        method: SCORING_METHOD,
        inputs: {
          rule: "a-rule",
          rule_version: 2,
          rule_strength: 0.95,
          sample_adequacy: 0.98,
          observations: 1,
        },
      },
    });
    expect(score(rule, 0.9, 0.9).confidence).toBe(81);
  });

  it("refuses to emit a confidence without a basis: a factor outside (0, 1] throws", () => {
    for (const [strength, adequacy] of [
      [0, 0.9],
      [0.9, 0],
      [1.1, 0.9],
      [0.9, Number.NaN],
      [-0.5, 1],
      [0.9, Number.POSITIVE_INFINITY],
    ]) {
      expect(() => score(rule, strength, adequacy)).toThrow(RangeError);
    }
    expect(() => score(rule, 0.9, 0)).toThrow("a-rule: sample adequacy must be in (0, 1], got 0");
  });

  it("prints cents as dollars", () => {
    expect(dollars(431)).toBe("$4.31");
    expect(dollars(500)).toBe("$5.00");
  });
});

describe("skipped-nothing-to-do", () => {
  it("does not fire on a skip of any other kind, or on a stage that ran", () => {
    for (const kind of ["branch_not_taken", "unreached", "unresolved_reference", null] as const) {
      const stages = [
        stageRow(1, "exploit-verify", {
          verdict: "skipped",
          how: "skipped",
          skip_reason: "skipped",
          skip_kind: kind,
        }),
      ];
      expect(SKIPPED_NOTHING_TO_DO.evaluate(seededInput({ stages }))).toEqual([]);
    }
    expect(SKIPPED_NOTHING_TO_DO.evaluate(seededInput({ stages: [stageRow(1, "plan")] }))).toEqual(
      [],
    );
  });

  it("is silent once the draft holds the decision — the predicate is already there", () => {
    const [finding] = SKIPPED_NOTHING_TO_DO.evaluate(seededInput());
    const fold = foldOperations(SEEDED_DRAFT, finding.proposedOps, SEEDED_CATALOGUE);
    if (!fold.ok) throw new Error(fold.reason);

    expect(SKIPPED_NOTHING_TO_DO.evaluate(seededInput({ draft: fold.document }))).toEqual([]);
  });

  it("is advisory when the stage named no input, or the draft has no such stage to route around", () => {
    const unnamed = SEEDED_STAGES.map((stage) => ({ ...stage, skip_input: null }));
    const [withoutInput] = SKIPPED_NOTHING_TO_DO.evaluate(seededInput({ stages: unnamed }));
    expect(withoutInput.proposedOps).toEqual([]);
    expect(withoutInput.body).toBe(
      "Make exploit-verify conditional — it had nothing to do on #489. Give it a condition, so it skips cleanly instead of running with nothing to check.",
    );
    expect(withoutInput.score.confidence).toBe(93);

    const grouped = [
      stageRow(1, "review", {
        verdict: "skipped",
        how: "skipped",
        skip_reason: "nothing to review",
        skip_kind: "nothing_to_do",
        skip_input: "diff",
      }),
    ];
    const [withoutNode] = SKIPPED_NOTHING_TO_DO.evaluate(seededInput({ stages: grouped }));
    expect(withoutNode.proposedOps).toEqual([]);
    expect(withoutNode.evidence).toMatchObject({ stage_key: "review", skip_input: "diff" });
  });

  it("keeps a predecessor's own edge kind, and places the decision at the stage when nothing is positioned", () => {
    const draft = {
      dsl_version: "1.0",
      nodes: [
        { id: "gate", type: "flow", title: "gate", config: { kind: "decision" } },
        { id: "verify", type: "llm", title: "verify", config: {} },
      ],
      edges: [
        {
          from: "gate",
          to: "verify",
          kind: "branch",
          label: "yes",
          condition: { kind: "labels", op: "any", values: ["security"] },
        },
      ],
    };
    const stages = [
      stageRow(1, "verify", {
        verdict: "skipped",
        how: "skipped",
        skip_reason: "nothing",
        skip_kind: "nothing_to_do",
        skip_input: "cve",
      }),
    ];

    const [finding] = SKIPPED_NOTHING_TO_DO.evaluate(seededInput({ draft, stages }));

    expect(finding.proposedOps).toHaveLength(4);
    expect(finding.proposedOps).toMatchObject([
      { kind: "add_stage", params: { node: { id: "has-cve", position: { x: 0, y: 0 } } } },
      { kind: "remove_edge", params: { from: "gate", to: "verify" } },
      {
        kind: "add_edge",
        params: {
          edge: {
            from: "gate",
            to: "has-cve",
            kind: "branch",
            label: "yes",
            condition: { kind: "labels", op: "any", values: ["security"] },
          },
        },
      },
      { kind: "add_edge", params: { edge: { from: "has-cve", to: "verify", label: "cve" } } },
    ]);
    expect(finding.evidence.trigger_labels).toEqual([]);
  });
});

describe("budget-proximity", () => {
  const budget = effectiveBudget(1000, 500);

  it("stays quiet below 80% of the cap, on an unpriced run, and on a cap of nothing", () => {
    expect(BUDGET_PROXIMITY.evaluate(seededInput())).toEqual([]);
    expect(
      BUDGET_PROXIMITY.evaluate(seededInput({ run: { status: "complete", costCents: 399 } })),
    ).toEqual([]);
    expect(
      BUDGET_PROXIMITY.evaluate(seededInput({ run: { status: "complete", costCents: null } })),
    ).toEqual([]);
    expect(
      BUDGET_PROXIMITY.evaluate(
        seededInput({
          run: { status: "complete", costCents: 5 },
          budget: { ...budget, capCents: 0 },
        }),
      ),
    ).toEqual([]);
  });

  it("names the actual figures and the costliest stage, and proposes nothing to apply", () => {
    const [finding] = BUDGET_PROXIMITY.evaluate(
      seededInput({ run: { status: "complete", costCents: 431 } }),
    );

    expect(finding.title).toBe("Raise the dry-run cap or trim implement");
    expect(finding.body).toBe(
      "This run spent $4.31 of its $5.00 cap (86%). implement was the costliest stage at $0.14 — raise the cap or trim that stage before the next run.",
    );
    expect(finding.proposedOps).toEqual([]);
    expect(finding.evidence).toEqual({
      status: "complete",
      cost_cents: 431,
      cap_cents: 500,
      cap_source: "draft_guard",
      ratio: 0.862,
      costliest_stage: "implement",
      costliest_stage_cents: 14,
    });
    expect(finding.score.confidence).toBe(88);
    expect(finding.score.basis.inputs).toMatchObject({
      rule_strength: 0.9,
      sample_adequacy: SINGLE_RUN_ADEQUACY,
      cost_cents: 431,
      cap_cents: 500,
      threshold: 0.8,
      budget_stopped: false,
    });
  });

  it("speaks on a run that stopped at its cap, whatever the ratio, and without a priced stage", () => {
    const [finding] = BUDGET_PROXIMITY.evaluate(
      seededInput({
        run: { status: "budget_stopped", costCents: 300 },
        stages: [stageRow(1, "plan")],
      }),
    );

    expect(finding.title).toBe("Raise the dry-run cap or trim a stage");
    expect(finding.body).toBe(
      "This run stopped at its $5.00 cap after spending $3.00. Raise the cap or trim a stage before the next run.",
    );
    expect(finding.evidence).toMatchObject({ costliest_stage: null, costliest_stage_cents: null });
  });
});

describe("unresolved-reference-persists", () => {
  it("fires only for a stage the run skipped on a reference the draft still does not resolve", () => {
    // Skipped for another reason: W7 did not bite in this run.
    expect(
      UNRESOLVED_REFERENCE_PERSISTS.evaluate(seededInput({ unresolved: [UNRESOLVED_TASK] })),
    ).toEqual([]);
    // Skipped on the reference, but the draft has since resolved it.
    expect(
      UNRESOLVED_REFERENCE_PERSISTS.evaluate(seededInput({ stages: UNRESOLVED_STAGES })),
    ).toEqual([]);
  });

  it("is advisory when no name is close", () => {
    const [finding] = UNRESOLVED_REFERENCE_PERSISTS.evaluate(
      seededInput({ stages: UNRESOLVED_STAGES, unresolved: [UNRESOLVED_TASK] }),
    );

    expect(finding.title).toBe("Resolve exploit-verify on exploit-verify");
    expect(finding.body).toBe(
      "exploit-verify was skipped because the task route `exploit-verify` does not resolve. Create it or remove the reference before promoting — an unresolved reference never runs.",
    );
    expect(finding.proposedOps).toEqual([]);
    expect(finding.evidence).toEqual({
      stage_key: "exploit-verify",
      reference_kind: "task route",
      reference: "exploit-verify",
      warning_code: DslWarningCode.REFERENCE_UNKNOWN_TASK,
      path: "/nodes/9/config/routing/inherit_task",
      nearest: null,
    });
    expect(finding.score.confidence).toBe(93);
  });

  it("proposes the nearest name that exists, as one set_stage that applies", () => {
    const catalogue = { ...SEEDED_CATALOGUE, tasks: ["implement", "exploit_verify"] };
    const [finding] = UNRESOLVED_REFERENCE_PERSISTS.evaluate(
      seededInput({ stages: UNRESOLVED_STAGES, unresolved: [UNRESOLVED_TASK], catalogue }),
    );

    expect(finding.body).toContain(
      "Use `exploit_verify`, the closest task route this workspace defines, or create `exploit-verify` before promoting",
    );
    expect(finding.proposedOps).toHaveLength(1);
    expect(finding.proposedOps[0]).toMatchObject({
      kind: "set_stage",
      params: {
        node: { id: "exploit-verify", config: { routing: { inherit_task: "exploit_verify" } } },
      },
    });
    expect(finding.score.basis.inputs).toMatchObject({
      sample_adequacy: NEAR_NAME_ADEQUACY,
      nearest: "exploit_verify",
    });
    expect(foldOperations(SEEDED_DRAFT, finding.proposedOps, catalogue).ok).toBe(true);
    // The draft it was read from is untouched.
    expect(SEEDED_DRAFT.nodes[9]).toMatchObject({
      config: { routing: { inherit_task: "exploit-verify" } },
    });
  });

  it("reads skills and aliases too, and ignores a warning it does not know or cannot place", () => {
    const stages = [
      stageRow(1, "analyze", {
        verdict: "skipped",
        how: "skipped",
        skip_reason: "unresolved",
        skip_kind: "unresolved_reference",
      }),
    ];
    const findings = UNRESOLVED_REFERENCE_PERSISTS.evaluate(
      seededInput({
        stages,
        catalogue: { skills: ["advisory_db"], aliases: ["coder-std"] },
        unresolved: [
          {
            ...UNRESOLVED_TASK,
            code: DslWarningCode.REFERENCE_UNKNOWN_SKILL,
            node: "analyze",
            name: "advisory-db",
            path: "/nodes/1/config/skill",
          },
          {
            ...UNRESOLVED_TASK,
            code: DslWarningCode.REFERENCE_UNKNOWN_ALIAS,
            node: "analyze",
            name: "coder-stdd",
            // A pointer that leads nowhere in the node: advisory, not a broken operation.
            path: "/nodes/1/config/nowhere/pinned_model/alias",
          },
          { ...UNRESOLVED_TASK, code: "reference.unknown_other" as never, node: "analyze" },
          { ...UNRESOLVED_TASK, node: "analyze", name: "x", path: "/nodes/1" },
        ],
      }),
    );

    expect(findings.map((finding) => finding.evidence.reference_kind)).toEqual([
      "skill",
      "alias",
      "task route",
    ]);
    expect(findings[0].proposedOps).toMatchObject([
      { kind: "set_stage", params: { node: { id: "analyze", config: { skill: "advisory_db" } } } },
    ]);
    expect(findings[1].proposedOps).toEqual([]);
    expect(findings[2].proposedOps).toEqual([]);
  });
});

describe("reviewer-disagreement", () => {
  it("is dormant without replay data, and below the sample floor", () => {
    expect(REVIEWER_DISAGREEMENT.evaluate(seededInput({ replay: null }))).toEqual([]);
    expect(
      REVIEWER_DISAGREEMENT.evaluate(
        seededInput({
          replay: { ...SEEDED_REPLAY, pairs: MIN_REPLAY_PAIRS - 1, styleDisagreements: 4 },
        }),
      ),
    ).toEqual([]);
  });

  it("needs style-class disagreement: at least half the pairs, and more than substance", () => {
    expect(
      REVIEWER_DISAGREEMENT.evaluate(
        seededInput({ replay: { ...SEEDED_REPLAY, styleDisagreements: 4 } }),
      ),
    ).toEqual([]);
    expect(
      REVIEWER_DISAGREEMENT.evaluate(
        seededInput({
          replay: { ...SEEDED_REPLAY, pairs: 12, styleDisagreements: 6, substanceDisagreements: 6 },
        }),
      ),
    ).toEqual([]);
  });

  it("says nothing about reviewers the draft no longer has, or that already load the skill", () => {
    expect(
      REVIEWER_DISAGREEMENT.evaluate(
        seededInput({ replay: { ...SEEDED_REPLAY, reviewerStages: ["review-primary", "gone"] } }),
      ),
    ).toEqual([]);

    const [finding] = REVIEWER_DISAGREEMENT.evaluate(seededInput());
    const fold = foldOperations(SEEDED_DRAFT, finding.proposedOps, SEEDED_CATALOGUE);
    if (!fold.ok) throw new Error(fold.reason);
    expect(REVIEWER_DISAGREEMENT.evaluate(seededInput({ draft: fold.document }))).toEqual([]);
  });

  it("is advisory when the workspace does not define the shared skill, and scores by sample size", () => {
    const [finding] = REVIEWER_DISAGREEMENT.evaluate(
      seededInput({
        catalogue: { skills: ["zephyr-style"] },
        replay: { ...SEEDED_REPLAY, pairs: 20, styleDisagreements: 12 },
      }),
    );

    expect(finding.proposedOps).toEqual([]);
    // 0.9 × (1 − 1/20) = 0.855.
    expect(finding.score.confidence).toBe(86);
    expect(finding.score.basis.inputs).toMatchObject({ sample_adequacy: 0.95, pairs: 20 });
  });
});
