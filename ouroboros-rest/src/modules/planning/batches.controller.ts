/**
 * `/api/v1/planning/batches` — mockup 09's generator card over HTTP.
 *
 * AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)). Every route runs under the tenant
 * context, and the **role matrix is the documented policy**, enforced here and nowhere else:
 *
 * | Route                                  | Who                        |
 * |----------------------------------------|----------------------------|
 * | `GET` a batch, its push status          | every member (`viewer` too) |
 * | generate · regenerate · patch a draft   | contributors — owner, admin, member |
 * | push · resume                           | **administrators** — owner, admin |
 *
 * Drafting is exploration; pushing writes into a shared tracker. So a member may draft, select and
 * edit, and a push by a member is a `403` AM.5 (#287) renders as an explanation rather than a
 * missing button.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, CONTRIBUTORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { BatchesService } from "./batches.service";
import { BatchParams, CreateBatchBody, DraftParams, PatchDraftBody } from "./planning.dto";
import type {
  BatchResource,
  GeneratedBatchResource,
  PushResultResource,
  PushStatusResource,
} from "./planning.resources";

@Controller("planning/batches")
export class BatchesController {
  /**
   * @param batches - The generator card's service.
   */
  constructor(private readonly batches: BatchesService) {}

  /**
   * Generate a batch.
   *
   * @param tenant - The workspace.
   * @param principal - The session — the batch's `created_by`.
   * @param body - The prompt, outline, target and toggles.
   * @returns The batch and the planner's notes. `201`.
   */
  @Post()
  @Roles(...CONTRIBUTORS)
  generate(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: CreateBatchBody,
  ): Promise<GeneratedBatchResource> {
    return this.batches.generate(tenant.id, principal.user.id, body);
  }

  /**
   * Read a batch.
   *
   * @param tenant - The workspace.
   * @param params - The batch.
   * @returns The batch, its drafts and footer.
   */
  @Get(":batch")
  read(
    @CurrentTenant() tenant: Organization,
    @Param() params: BatchParams,
  ): Promise<BatchResource> {
    return this.batches.read(tenant.id, params.batch);
  }

  /**
   * Regenerate a batch's unpushed drafts, preserving selections by local key.
   *
   * @param tenant - The workspace.
   * @param params - The batch.
   * @returns The batch and the planner's notes.
   */
  @Post(":batch/regenerate")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  regenerate(
    @CurrentTenant() tenant: Organization,
    @Param() params: BatchParams,
  ): Promise<GeneratedBatchResource> {
    return this.batches.regenerate(tenant.id, params.batch);
  }

  /**
   * Select, edit or re-wire one draft.
   *
   * @param tenant - The workspace.
   * @param params - The batch and the draft's local key.
   * @param body - What changes.
   * @returns The batch.
   */
  @Patch(":batch/drafts/:key")
  @Roles(...CONTRIBUTORS)
  patchDraft(
    @CurrentTenant() tenant: Organization,
    @Param() params: DraftParams,
    @Body() body: PatchDraftBody,
  ): Promise<BatchResource> {
    return this.batches.patchDraft(tenant.id, params.batch, params.key, body);
  }

  /**
   * Push a batch — administrators only.
   *
   * @param tenant - The workspace.
   * @param params - The batch.
   * @returns AL.3's report and the queue-small outcome.
   */
  @Post(":batch/push")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  push(
    @CurrentTenant() tenant: Organization,
    @Param() params: BatchParams,
  ): Promise<PushResultResource> {
    return this.batches.push(tenant.id, params.batch);
  }

  /**
   * Resume a push that stopped short — administrators only.
   *
   * @param tenant - The workspace.
   * @param params - The batch.
   * @returns AL.3's report and the queue-small outcome.
   */
  @Post(":batch/push/resume")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  resume(
    @CurrentTenant() tenant: Organization,
    @Param() params: BatchParams,
  ): Promise<PushResultResource> {
    return this.batches.resume(tenant.id, params.batch);
  }

  /**
   * Per-draft push states.
   *
   * @param tenant - The workspace.
   * @param params - The batch.
   * @returns The states.
   */
  @Get(":batch/push-status")
  pushStatus(
    @CurrentTenant() tenant: Organization,
    @Param() params: BatchParams,
  ): Promise<PushStatusResource> {
    return this.batches.pushStatus(tenant.id, params.batch);
  }
}
