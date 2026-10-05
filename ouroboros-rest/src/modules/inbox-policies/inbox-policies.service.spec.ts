import type { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import type { OrgPolicyService } from "../policies/org-policy.service";
import type { PolicyResolutionService } from "../policies/policy-resolution.service";
import { recordingDatabase } from "../db/database.fixture";
import { InboxPoliciesRepository } from "./inbox-policies.repository";
import { InboxPoliciesService } from "./inbox-policies.service";

/** The card's sources are read live, each from the config that enforces it (#464). */

describe("InboxPoliciesService", () => {
  it("reads the document, BA.1's paths, the dormant spend kind and dry-run — then composes", async () => {
    const policies = {
      current: jest.fn(() =>
        Promise.resolve({
          version: 7,
          publishedAt: new Date(),
          rules: { human_review: { enabled: true, conditions: { label: "refactor" } } },
        }),
      ),
    };
    const dryRun = { dryRunNow: jest.fn(() => Promise.resolve(true)) };
    const registry = { isDormant: jest.fn(() => true) };
    const repository = {
      protectedPaths: jest.fn(() => Promise.resolve([{ glob: "boot/**", repos: 1 }])),
    };

    const card = await new InboxPoliciesService(
      policies as unknown as PolicyResolutionService,
      dryRun as unknown as OrgPolicyService,
      registry as unknown as DecisionKindRegistry,
      repository as unknown as InboxPoliciesRepository,
    ).card("org-acme");

    expect(policies.current).toHaveBeenCalledWith("org-acme");
    expect(dryRun.dryRunNow).toHaveBeenCalledWith("org-acme");
    expect(registry.isDormant).toHaveBeenCalledWith("spend_approval");
    expect(card.rows.map((row) => row.id)).toEqual([
      "human_review:label:refactor",
      "protected_paths",
      "claim_waiver",
    ]);
    expect(card.dryRun).toBe(true);
  });
});

describe("InboxPoliciesRepository", () => {
  it("counts each protected glob's repositories inside the workspace", async () => {
    const database = recordingDatabase();
    database.answers({ rows: [{ path_glob: "boot/**", repos: "2" }] });

    expect(await new InboxPoliciesRepository(database.service).protectedPaths("org-acme")).toEqual([
      { glob: "boot/**", repos: 2 },
    ]);
    expect(database.statements[0].sql).toContain('from "ouroboros"."protected_path_policies"');
    expect(database.statements[0].sql).toContain("count(distinct");
    expect(database.statements[0].parameters).toEqual(["org-acme"]);
  });
});
