/**
 * `InboxPoliciesService` — reads the live configs the *What Needs A Human* card derives from (BN.4,
 * [#464](https://github.com/NobuData/ouroboros/issues/464), X7) and hands them to
 * `inbox-policies.compose.ts`.
 *
 * ```
 * the org policy document   OrgPolicyGateResolver.document — the reader the gate engine enforces through
 * protected paths           protected_path_policies (BA.1) — what AP.3 judges against
 * spend                     DecisionKindRegistry.isDormant("spend_approval") — no per-run cap is enforced
 * dry-run                   OrgPolicyService.dryRunNow (BA.3) — the caption
 * ```
 */

import { Injectable } from "@nestjs/common";

import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { OrgPolicyService } from "../policies/org-policy.service";
import { OrgPolicyGateResolver } from "../pull-requests/gates/gate.org-policy";
import { policyCard, type PolicyCardResource } from "./inbox-policies.compose";
import { InboxPoliciesRepository } from "./inbox-policies.repository";

@Injectable()
export class InboxPoliciesService {
  /**
   * @param policies - The published org policy document.
   * @param dryRun - BA.3's dry-run policy.
   * @param registry - Which decision kinds are dormant.
   * @param repository - BA.1's protected paths.
   */
  constructor(
    private readonly policies: OrgPolicyGateResolver,
    private readonly dryRun: OrgPolicyService,
    private readonly registry: DecisionKindRegistry,
    private readonly repository: InboxPoliciesRepository,
  ) {}

  /**
   * The card, from the configs as they stand now.
   *
   * @param organizationId - The workspace.
   * @returns The rows and the caption.
   */
  async card(organizationId: string): Promise<PolicyCardResource> {
    return policyCard({
      policy: await this.policies.document(organizationId),
      protectedPaths: await this.repository.protectedPaths(organizationId),
      spendDormant: this.registry.isDormant("spend_approval"),
      dryRun: await this.dryRun.dryRunNow(organizationId),
    });
  }
}
