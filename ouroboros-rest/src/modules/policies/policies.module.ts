/**
 * `PoliciesModule` — the workspace's org-level policies (BA.3,
 * [#382](https://github.com/NobuData/ouroboros/issues/382)): today the dry-run policy, read under
 * `/api/v1/policies/dry-run`.
 *
 * Exports {@link OrgPolicyService}, because the policy is enforced **below** the surfaces: the PR
 * plane (`PullRequestsModule` — the merge executor and the PR opener) and onboarding completion
 * (`OnboardingModule`) import it rather than re-reading the table.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { OrgPolicyController } from "./org-policy.controller";
import { OrgPolicyRepository } from "./org-policy.repository";
import { OrgPolicyService } from "./org-policy.service";

@Module({
  imports: [DbModule, AuditModule],
  controllers: [OrgPolicyController],
  providers: [OrgPolicyRepository, OrgPolicyService],
  exports: [OrgPolicyService],
})
export class PoliciesModule {}
