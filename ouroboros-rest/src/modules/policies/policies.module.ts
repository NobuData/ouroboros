/**
 * `PoliciesModule` — the workspace's org-level policies: the dry-run switch (BA.3,
 * [#382](https://github.com/NobuData/ouroboros/issues/382)) under `/api/v1/policies/dry-run`, and
 * the versioned org policy document (BQ.2, [#481](https://github.com/NobuData/ouroboros/issues/481))
 * under `/api/v1/policies` — its read, its version history (BS.4, #494), a draft's classification
 * and the publish. The glob editor's match preview, `POST /api/v1/policies/path-preview`, is
 * `PathPreviewModule`'s: it reads repositories, and this module imports no plane.
 *
 * Exports {@link OrgPolicyService} and {@link PolicyResolutionService}, because the policy is
 * enforced **below** the surfaces: the gate engine, the merge executor and the PR opener, AP.3's
 * guardrails, Z.1's resolution, onboarding completion and the inbox's policy card import them
 * rather than re-reading the tables. Nothing here imports those planes, so none of them can cycle.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { OrgPolicyController } from "./org-policy.controller";
import { OrgPolicyRepository } from "./org-policy.repository";
import { OrgPolicyService } from "./org-policy.service";
import { PolicyController } from "./policy.controller";
import { PolicyHistoryService } from "./policy-history.service";
import { PolicyPublishService } from "./policy-publish.service";
import { PolicyResolutionService } from "./policy-resolution.service";

@Module({
  imports: [DbModule, AuditModule],
  controllers: [OrgPolicyController, PolicyController],
  providers: [
    OrgPolicyRepository,
    OrgPolicyService,
    PolicyResolutionService,
    PolicyPublishService,
    PolicyHistoryService,
  ],
  exports: [OrgPolicyService, PolicyResolutionService],
})
export class PoliciesModule {}
