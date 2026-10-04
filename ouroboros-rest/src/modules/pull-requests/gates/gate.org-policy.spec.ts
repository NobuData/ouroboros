import { recordingDatabase } from "../../db/database.fixture";
import { OrgPolicyGateResolver, humanReviewRuleOf, rulesOf } from "./gate.org-policy";
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
    database.answers({
      rows: [
        {
          version: 7,
          published_at: new Date("2026-10-04T00:00:00Z"),
          document: { human_review: { enabled: true, conditions: { label: "refactor" } } },
        },
      ],
    });

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

describe("OrgPolicyGateResolver.document (#464)", () => {
  it("answers the whole current document — every rule that holds the envelope", async () => {
    const database = recordingDatabase();
    const publishedAt = new Date("2026-10-04T00:00:00Z");
    database.answers({
      rows: [
        {
          version: 7,
          published_at: publishedAt,
          document: {
            human_review: { enabled: true, conditions: { any: [{ label: "refactor" }] } },
            protected_paths: { enabled: false, conditions: { path_globs: ["boot/**"] } },
            spend_guard: { enabled: true },
            broken: "not a rule",
          },
        },
      ],
    });

    expect(await new OrgPolicyGateResolver(database.service).document("acme")).toEqual({
      version: 7,
      publishedAt,
      rules: {
        human_review: { enabled: true, conditions: { any: [{ label: "refactor" }] } },
        protected_paths: { enabled: false, conditions: { path_globs: ["boot/**"] } },
      },
    });
  });

  it("answers null when nothing is published", async () => {
    expect(
      await new OrgPolicyGateResolver(recordingDatabase().service).document("acme"),
    ).toBeNull();
  });
});

describe("rulesOf", () => {
  it("reads nothing from a document that is not an object", () => {
    expect(rulesOf(null)).toEqual({});
    expect(rulesOf("v7")).toEqual({});
  });
});
