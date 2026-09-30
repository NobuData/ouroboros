/**
 * `/api/v1/knowledge/import` — mockup 14's **Import CLAUDE.md / .cursorrules** (BF.4,
 * [#413](https://github.com/NobuData/ouroboros/issues/413)).
 *
 * **The same role gate as skill creation**: `@Roles(...ADMINISTRATORS)` on both routes, as on
 * `POST /api/v1/skills` — an import creates skills, so whoever may not create one may not import
 * one. The preview is gated too: it spends the connection's requests and reads the repository.
 *
 * **Both are `POST`s answering `200`.** The preview writes nothing but reads a remote host and is
 * not a cacheable representation of anything; the apply writes, and answers with what it wrote.
 */

import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";

import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { ApplyRuleImportBody, PreviewRuleImportBody } from "./rule-import.dto";
import type { RuleImportPreview, RuleImportResult } from "./rule-import.resources";
import { RuleImportService } from "./rule-import.service";

@Controller("knowledge/import")
export class RuleImportController {
  /** @param imports - The import's rules. */
  constructor(private readonly imports: RuleImportService) {}

  /**
   * `POST /api/v1/knowledge/import/preview` — what an apply would write. Writes nothing.
   *
   * @param tenant - The workspace.
   * @param body - `repo`.
   * @returns Counts and samples per file and kind, and the fingerprint the apply must send.
   */
  @Roles(...ADMINISTRATORS)
  @Post("preview")
  @HttpCode(HttpStatus.OK)
  preview(
    @CurrentTenant() tenant: Organization,
    @Body() body: PreviewRuleImportBody,
  ): Promise<RuleImportPreview> {
    return this.imports.preview(tenant.id, body.repo);
  }

  /**
   * `POST /api/v1/knowledge/import/apply` — write exactly the previewed plan, audited.
   *
   * @param tenant - The workspace.
   * @param principal - The session, for the audit's actor.
   * @param body - `repo` and the preview's `fingerprint`.
   * @returns The preview it matched, and what was written.
   */
  @Roles(...ADMINISTRATORS)
  @Post("apply")
  @HttpCode(HttpStatus.OK)
  apply(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: ApplyRuleImportBody,
  ): Promise<RuleImportResult> {
    return this.imports.apply(tenant.id, body.repo, body.fingerprint, principal.user.id);
  }
}
