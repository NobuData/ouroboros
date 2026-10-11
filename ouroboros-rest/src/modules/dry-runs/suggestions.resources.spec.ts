import type { DryRunSuggestion } from "../db/schema";
import { dryRunSuggestion, dryRunSuggestionExplanation } from "./suggestions.resources";
import { RULE_PACK_VERSION, SKIPPED_NOTHING_TO_DO } from "./suggestions.rules";

const AT = new Date("2026-10-06T15:08:00Z");

function row(overrides: Partial<DryRunSuggestion> = {}): DryRunSuggestion {
  return {
    id: "s-1",
    organization_id: "acme-robotics-id",
    dry_run_id: "r-1",
    source: "rule",
    rule_id: "skipped-nothing-to-do",
    rule_version: 1,
    title: "Make exploit-verify conditional",
    body: "It had nothing to do.",
    evidence: { stage_key: "exploit-verify" },
    proposed_ops: [{ kind: "remove_stage", params: { id: "exploit-verify" } }],
    confidence: 93,
    confidence_basis: {
      method: "rule_strength_x_sample_adequacy",
      inputs: { rule_strength: 0.95 },
    },
    status: "open",
    applied_op_batch_id: null,
    resolved_by: null,
    resolved_at: null,
    created_at: AT,
    ...overrides,
  };
}

describe("the suggestions' wire shapes", () => {
  it("carries a confidence with its basis, and says whether there is anything to apply", () => {
    expect(dryRunSuggestion(row())).toEqual({
      id: "s-1",
      dryRunId: "r-1",
      source: "rule",
      ruleId: "skipped-nothing-to-do",
      ruleVersion: 1,
      title: "Make exploit-verify conditional",
      body: "It had nothing to do.",
      confidence: 93,
      confidenceBasis: {
        method: "rule_strength_x_sample_adequacy",
        inputs: { rule_strength: 0.95 },
      },
      applicable: true,
      proposedOps: [{ kind: "remove_stage", params: { id: "exploit-verify" } }],
      status: "open",
      appliedOpBatchId: null,
      resolvedAt: null,
      createdAt: AT.toISOString(),
    });

    expect(
      dryRunSuggestion(
        row({ proposed_ops: [], status: "ignored", resolved_at: AT, resolved_by: "user-1" }),
      ),
    ).toMatchObject({ applicable: false, status: "ignored", resolvedAt: AT.toISOString() });
  });

  it("explains a rule's suggestion with the pack's own description of the rule", () => {
    expect(dryRunSuggestionExplanation(row())).toEqual({
      suggestionId: "s-1",
      source: "rule",
      rule: {
        id: "skipped-nothing-to-do",
        version: 1,
        packVersion: RULE_PACK_VERSION,
        firesWhen: SKIPPED_NOTHING_TO_DO.firesWhen,
        proposes: SKIPPED_NOTHING_TO_DO.proposes,
        scoring: SKIPPED_NOTHING_TO_DO.scoring,
      },
      evidence: { stage_key: "exploit-verify" },
      confidence: 93,
      confidenceBasis: {
        method: "rule_strength_x_sample_adequacy",
        inputs: { rule_strength: 0.95 },
      },
      proposedOps: [{ kind: "remove_stage", params: { id: "exploit-verify" } }],
    });
  });

  it("keeps a retired rule's id and version, and names no rule on the copilot's suggestion", () => {
    expect(dryRunSuggestionExplanation(row({ rule_id: "deterministic-skip" })).rule).toEqual({
      id: "deterministic-skip",
      version: 1,
      packVersion: RULE_PACK_VERSION,
      firesWhen: null,
      proposes: null,
      scoring: null,
    });

    const llm = dryRunSuggestionExplanation(
      row({
        source: "llm",
        rule_id: null,
        rule_version: null,
        confidence: null,
        confidence_basis: { method: "llm_unscored", inputs: { alias: "coder-max" } },
      }),
    );
    expect(llm.rule).toBeNull();
    expect(llm.confidence).toBeNull();
    expect(llm.confidenceBasis.method).toBe("llm_unscored");
  });
});
