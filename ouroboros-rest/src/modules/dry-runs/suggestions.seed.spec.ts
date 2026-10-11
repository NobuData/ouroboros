import { validateWorkflowDocument } from "../workflows/dsl.validator";
import { foldOperations } from "./suggestions.ops";
import { RULE_PACK, SCORING_METHOD, evaluatePack } from "./suggestions.rules";
import {
  REVIEW_PRIMARY,
  REVIEW_SECOND,
  SEEDED_CATALOGUE,
  SEEDED_CONDITIONAL_OPS,
  SEEDED_DRAFT,
  seededInput,
} from "./suggestions.seed.fixture";

describe("the rule pack over the seeded dry run (security-patch v0.3 × #489)", () => {
  const findings = evaluatePack(seededInput());

  it("produces exactly the two seeded suggestions: 93% and 81%", () => {
    expect(
      findings.map((finding) => `${finding.rule.id}:${String(finding.score.confidence)}`),
    ).toEqual(["skipped-nothing-to-do:93", "reviewer-disagreement:81"]);
  });

  it("turns the skipped stage into exactly the conditional suggestion the seed stores", () => {
    const [conditional] = findings;

    expect(conditional.title).toBe("Make exploit-verify conditional");
    expect(conditional.body).toBe(
      "Make exploit-verify conditional — it had nothing to do because #489 carries no `cve` label. Route issues without `cve` around it, so it skips cleanly instead of running with nothing to check.",
    );
    expect(conditional.evidence).toEqual({
      stage_key: "exploit-verify",
      verdict: "skipped",
      skip_kind: "nothing_to_do",
      skip_input: "cve",
      skip_reason: "no PoC exists: stage had nothing to do",
      ticket: "#489",
      ticket_labels: ["bug", "can-bus"],
      trigger_labels: ["security"],
    });
    expect(conditional.proposedOps).toEqual(SEEDED_CONDITIONAL_OPS);
    expect(conditional.score.basis).toEqual({
      method: SCORING_METHOD,
      inputs: {
        rule: "skipped-nothing-to-do",
        rule_version: 1,
        rule_strength: 0.95,
        sample_adequacy: 0.98,
        outcome: "skipped_nothing_to_do",
        deterministic: true,
        observations: 1,
      },
    });
  });

  it("proposes operations that validate and apply: the draft gains the has-cve decision and still validates", () => {
    const fold = foldOperations(SEEDED_DRAFT, findings[0].proposedOps, SEEDED_CATALOGUE);

    expect(fold.ok).toBe(true);
    if (!fold.ok) return;
    const document = fold.document as {
      nodes: { id: string }[];
      edges: { from: string; to: string }[];
    };
    expect(document.nodes.map((node) => node.id)).toContain("has-cve");
    expect(document.edges).not.toContainEqual(
      expect.objectContaining({ from: "test", to: "exploit-verify" }),
    );
    // A ticket without `cve` now reaches both reviewers without passing exploit-verify.
    expect(document.edges.filter((edge) => edge.from === "has-cve").map((edge) => edge.to)).toEqual(
      ["exploit-verify", "review-primary", "review-second"],
    );
    expect(validateWorkflowDocument(fold.document, { catalogue: SEEDED_CATALOGUE }).errors).toEqual(
      [],
    );
  });

  it("stands the 81% card on the replays: 6 of 10, the shared skill on both reviewers", () => {
    const reviewers = findings[1];

    expect(reviewers.title).toBe("Pin the pr-etiquette skill to both reviewers");
    expect(reviewers.body).toBe(
      "Pin the pr-etiquette skill to both reviewers — 6 of 10 replayed review pairs disagreed on comment style, not substance.",
    );
    expect(reviewers.evidence).toEqual({
      stage_keys: ["review-primary", "review-second"],
      replay_set: "5eed008d-0000-4000-8000-000000000000",
      pairs_replayed: 10,
      style_disagreements: 6,
      substance_disagreements: 0,
      skill: "pr-etiquette",
    });
    expect(reviewers.score.basis.inputs).toEqual({
      rule: "reviewer-disagreement",
      rule_version: 1,
      rule_strength: 0.9,
      sample_adequacy: 0.9,
      replay_set: "5eed008d-0000-4000-8000-000000000000",
      pairs: 10,
      style_disagreements: 6,
      substance_disagreements: 0,
      disagreement_rate: 0.6,
    });
    expect(reviewers.proposedOps).toEqual(
      [REVIEW_PRIMARY, REVIEW_SECOND].map((node) => ({
        kind: "set_stage",
        params: {
          node: { ...node, config: { ...node.config, mode: "skill", skill: "pr-etiquette" } },
        },
      })),
    );
    expect(foldOperations(SEEDED_DRAFT, reviewers.proposedOps, SEEDED_CATALOGUE).ok).toBe(true);
  });

  it("has no reviewer card at all when the replay data is absent — the honesty fixture", () => {
    const withoutReplays = evaluatePack(seededInput({ replay: null }));

    expect(withoutReplays.map((finding) => finding.rule.id)).toEqual(["skipped-nothing-to-do"]);
    expect(JSON.stringify(withoutReplays)).not.toContain("pr-etiquette");
  });

  it("carries a confidence with its scoring inputs on every finding", () => {
    for (const finding of findings) {
      const { inputs } = finding.score.basis;
      expect(finding.score.basis.method).toBe(SCORING_METHOD);
      expect(finding.score.confidence).toBe(
        Math.round((inputs.rule_strength as number) * (inputs.sample_adequacy as number) * 100),
      );
      expect(inputs.rule).toBe(finding.rule.id);
      expect(inputs.rule_version).toBe(finding.rule.version);
    }
    expect(RULE_PACK.map((rule) => rule.id)).toEqual([
      "skipped-nothing-to-do",
      "budget-proximity",
      "unresolved-reference-persists",
      "reviewer-disagreement",
    ]);
  });
});
