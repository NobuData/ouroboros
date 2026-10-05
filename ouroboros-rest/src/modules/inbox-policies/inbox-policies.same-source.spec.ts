import type { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import type { PublishedOrgPolicy } from "../policies/org-policy.document";
import { rulesOf } from "../policies/org-policy.document";
import type {
  PolicyDocumentStore,
  PolicyPublishStore,
  StoredPolicyVersion,
} from "../policies/org-policy.repository";
import type { OrgPolicyService } from "../policies/org-policy.service";
import { PolicyPublishService } from "../policies/policy-publish.service";
import { PolicyResolutionService } from "../policies/policy-resolution.service";
import type { InboxPoliciesRepository } from "./inbox-policies.repository";
import { InboxPoliciesService } from "./inbox-policies.service";

/**
 * BQ.2 (#481): the inbox's *What Needs A Human* card and the settings card's publish share one
 * source — a publish through the settings flow is what the inbox card shows next, with no second
 * write path and no stale cache in between.
 */

/** Mockup 17's policy v7. */
const V7_DOCUMENT = {
  auto_merge: {
    enabled: true,
    conditions: { all: [{ effort_lte: "m" }, { not: { label: "refactor" } }] },
  },
  human_review: {
    enabled: true,
    conditions: { any: [{ label: "refactor" }, { effort_gte: "l" }] },
  },
  protected_paths: { enabled: true, conditions: { path_globs: ["boot/**"] } },
  spend_guard: { enabled: true, conditions: { per_run_cap_cents: 250 } },
  dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 10 } },
};

/** One store behind both the resolver and the publish flow — what `OrgPolicyRepository` is. */
class OneStore implements PolicyDocumentStore, PolicyPublishStore {
  stored: StoredPolicyVersion = {
    version: 7,
    document: V7_DOCUMENT,
    publishedAt: new Date("2026-10-01T09:00:00Z"),
    publishedBy: "user-ken",
    changeNote: null,
  };

  version(): Promise<StoredPolicyVersion> {
    return Promise.resolve(this.stored);
  }

  current(): Promise<PublishedOrgPolicy> {
    return Promise.resolve({
      version: this.stored.version,
      publishedAt: this.stored.publishedAt,
      rules: rulesOf(this.stored.document),
    });
  }

  publish(
    _organizationId: string,
    document: Record<string, unknown>,
    publishedBy: string,
    changeNote: string | null,
    decide: (current: StoredPolicyVersion) => void,
  ): Promise<{ version: number; publishedAt: Date }> {
    decide(this.stored);
    this.stored = {
      version: this.stored.version + 1,
      document,
      publishedAt: new Date(),
      publishedBy,
      changeNote,
    };

    return Promise.resolve({ version: this.stored.version, publishedAt: this.stored.publishedAt });
  }
}

describe("the inbox card and the settings publish", () => {
  it("cannot disagree: a publish is the inbox card's next read, through the one resolver", async () => {
    const store = new OneStore();
    // A clock that never moves: only the publish's invalidation can make the cache read again.
    const resolver = new PolicyResolutionService(store, () => 0);
    const publisher = new PolicyPublishService(store, resolver, {
      record: () => Promise.resolve("audit-1"),
    });
    const inbox = new InboxPoliciesService(
      resolver,
      { dryRunNow: () => Promise.resolve(false) } as unknown as OrgPolicyService,
      { isDormant: () => true } as unknown as DecisionKindRegistry,
      { protectedPaths: () => Promise.resolve([]) } as unknown as InboxPoliciesRepository,
    );

    const before = await inbox.card("org");

    expect(before.policyVersion).toBe(7);
    expect(before.rows.map((row) => row.id)).toContain("human_review:label:refactor");

    await publisher.publish(
      "org",
      { id: "user-ken", roles: ["owner"] },
      {
        document: { ...V7_DOCUMENT, human_review: { ...V7_DOCUMENT.human_review, enabled: false } },
        baseVersion: 7,
      },
    );

    const after = await inbox.card("org");

    expect(after.policyVersion).toBe(8);
    expect(after.rows.map((row) => row.id)).not.toContain("human_review:label:refactor");
    expect(await publisher.read("org")).toMatchObject({ version: 8 });
  });
});
