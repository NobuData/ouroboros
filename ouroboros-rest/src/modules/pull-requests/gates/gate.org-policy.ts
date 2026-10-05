/**
 * `OrgPolicyGateResolver` — the gate engine's org configuration, with the published policy's
 * `human_review` rule.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)), the **#358 amendment**: the
 * refactor-label rule moved from mockup prose to the workspace's published org policy document
 * (V092, `org_policy_versions` at `org_policies.current_version`). Everything else stays at
 * {@link DEFAULT_ORG_GATE_CONFIG}.
 *
 * **Since BQ.2** ([#481](https://github.com/NobuData/ouroboros/issues/481)) this resolver no longer
 * reads the tables itself: it asks `PolicyResolutionService`, the one reader every enforcement
 * point shares, and passes on the version it read so the gate row's provenance names it —
 * `… + org policy v7: refactor → human review`. There is no hard-coded refactor rule anywhere in
 * the engine; a workspace that has published no policy has no rule, so nothing new is required of
 * it, and switching `human_review` off lets a refactor-labelled PR through.
 *
 * **Widened by BN.4** ([#464](https://github.com/NobuData/ouroboros/issues/464)): {@link
 * OrgPolicyGateResolver.document} answers the whole current published document — the same read.
 */

import { Injectable } from "@nestjs/common";

import type { PublishedOrgPolicy } from "../../policies/org-policy.document";
import { PolicyResolutionService } from "../../policies/policy-resolution.service";
import { DEFAULT_ORG_GATE_CONFIG, type OrgGateConfig, type OrgGatePolicy } from "./gate.policy";

export {
  type OrgPolicyRule,
  type PublishedOrgPolicy,
  ruleOf as humanReviewRuleOf,
  rulesOf,
} from "../../policies/org-policy.document";

@Injectable()
export class OrgPolicyGateResolver implements OrgGatePolicy {
  /**
   * @param policies - The one reader of the published org policy.
   */
  constructor(private readonly policies: PolicyResolutionService) {}

  /** @inheritdoc */
  async forOrganization(organizationId: string): Promise<OrgGateConfig> {
    const published = await this.document(organizationId);

    return {
      ...DEFAULT_ORG_GATE_CONFIG,
      humanReview: published?.rules.human_review ?? null,
      policyVersion: published?.version ?? null,
    };
  }

  /**
   * The workspace's current published policy document.
   *
   * @param organizationId - The workspace.
   * @returns The version, when it was published, and its rules; null when nothing is published.
   */
  document(organizationId: string): Promise<PublishedOrgPolicy | null> {
    return this.policies.current(organizationId);
  }
}
