import { recordingDatabase } from "../../db/database.fixture";
import { OrgPolicyGateResolver, humanReviewRuleOf } from "./gate.org-policy";
import { DEFAULT_ORG_GATE_CONFIG } from "./gate.policy";

/**
 * The gate engine's org configuration (#461, the #358 amendment): the published policy's
 * `human_review` rule, the defaults for everything else.
 */

describe("humanReviewRuleOf", () => {
  it("reads the envelope V092 holds", () => {
    expect(humanReviewRuleOf({ enabled: true, conditions: { label: "refactor" } })).toEqual({
      enabled: true,
      conditions: { label: "refactor" },
    });
  });

  it("reads anything else as no rule", () => {
    expect(humanReviewRuleOf(undefined)).toBeNull();
    expect(humanReviewRuleOf(null)).toBeNull();
    expect(humanReviewRuleOf({ enabled: "yes", conditions: {} })).toBeNull();
    expect(humanReviewRuleOf({ enabled: true })).toBeNull();
  });
});

describe("OrgPolicyGateResolver", () => {
  it("reads the rule from the workspace's current published version, keeping the defaults", async () => {
    const database = recordingDatabase();
    database.answers({ rows: [{ rule: { enabled: true, conditions: { label: "refactor" } } }] });

    const config = await new OrgPolicyGateResolver(database.service).forOrganization("acme");

    expect(config).toEqual({
      ...DEFAULT_ORG_GATE_CONFIG,
      humanReview: { enabled: true, conditions: { label: "refactor" } },
    });
    expect(database.statements[0].sql).toContain("v.version = p.current_version");
    expect(database.statements[0].parameters).toEqual(["acme"]);
  });

  it("answers no rule for a workspace that has published no policy", async () => {
    const database = recordingDatabase();

    expect(
      (await new OrgPolicyGateResolver(database.service).forOrganization("acme")).humanReview,
    ).toBeNull();
  });
});
