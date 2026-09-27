/**
 * `/api/v1/pull-requests/:id/criteria…` — the acceptance criteria matrix's routes (AX.3,
 * [#359](https://github.com/NobuData/ouroboros/issues/359)). The service's header lists them.
 *
 * **The workspace is the session's, never the request's.** The tenant guard resolves and
 * membership-checks it, and this controller reads what it established.
 *
 * **Roles on the routes themselves.** The matrix is every member's to read, a `viewer` included.
 * A `member` may author, import, reorder, cite and verify — the editorial step the issue gives to
 * *member and above* — and **only an administrator may waive**, because a waiver lets an unmet
 * criterion through, which is AT.4's rule for a test waiver (#332) applied to a claim.
 *
 * **`201` for what a request created** — a criterion, an import, a citation, a waiver; **`204`
 * for a delete**; `200` for everything else.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";

import type { Organization } from "../../db/schema";
import { ADMINISTRATORS, CONTRIBUTORS, Roles } from "../../tenancy/roles.guard";
import { currentUser, type ActiveMembership } from "../../tenancy/tenant.context";
import { CurrentMember, CurrentTenant } from "../../tenancy/tenant.decorators";
import {
  AttachEvidenceDto,
  CreateCriterionDto,
  CriterionParams,
  EvidenceParams,
  PullRequestParams,
  ReorderCriteriaDto,
  UpdateCriterionDto,
  WaiveCriterionDto,
} from "./criteria.dto";
import type {
  CriteriaImportResource,
  CriteriaMatrixResource,
  CriterionResource,
  CriterionWaivedResource,
} from "./criteria.resources";
import { CriteriaService, type CriteriaActor } from "./criteria.service";

@Controller("pull-requests")
export class CriteriaController {
  /** @param criteria - Where the matrix is. */
  constructor(private readonly criteria: CriteriaService) {}

  /**
   * The matrix.
   *
   * @param tenant - The workspace.
   * @param params - The PR.
   * @returns Every criterion, its evidence lines, status and waiver.
   */
  @Get(":id/criteria")
  matrix(
    @CurrentTenant() tenant: Organization,
    @Param() params: PullRequestParams,
  ): Promise<CriteriaMatrixResource> {
    return this.criteria.matrix(tenant.id, params.id);
  }

  /**
   * Author a claim.
   *
   * @param member - The membership.
   * @param params - The PR.
   * @param request - The claim.
   * @returns The criterion.
   */
  @Post(":id/criteria")
  @HttpCode(HttpStatus.CREATED)
  @Roles(...CONTRIBUTORS)
  create(
    @CurrentMember() member: ActiveMembership,
    @Param() params: PullRequestParams,
    @Body() request: CreateCriterionDto,
  ): Promise<CriterionResource> {
    return this.criteria.create(member.tenant.id, params.id, actor("criteria"), request);
  }

  /**
   * Import the plan's acceptance criteria.
   *
   * @param member - The membership.
   * @param params - The PR.
   * @returns What was imported.
   */
  @Post(":id/criteria/import")
  @HttpCode(HttpStatus.CREATED)
  @Roles(...CONTRIBUTORS)
  importPlan(
    @CurrentMember() member: ActiveMembership,
    @Param() params: PullRequestParams,
  ): Promise<CriteriaImportResource> {
    return this.criteria.importPlan(member.tenant.id, params.id, actor("criteria/import"));
  }

  /**
   * Reorder the matrix.
   *
   * @param member - The membership.
   * @param params - The PR.
   * @param request - Every criterion, first row first.
   * @returns The matrix in its new order.
   */
  @Put(":id/criteria/order")
  @Roles(...CONTRIBUTORS)
  reorder(
    @CurrentMember() member: ActiveMembership,
    @Param() params: PullRequestParams,
    @Body() request: ReorderCriteriaDto,
  ): Promise<CriteriaMatrixResource> {
    return this.criteria.reorder(member.tenant.id, params.id, request);
  }

  /**
   * Reword a claim.
   *
   * @param member - The membership.
   * @param params - The PR and the criterion.
   * @param request - The new wording.
   * @returns The criterion.
   */
  @Patch(":id/criteria/:criterionId")
  @Roles(...CONTRIBUTORS)
  update(
    @CurrentMember() member: ActiveMembership,
    @Param() params: CriterionParams,
    @Body() request: UpdateCriterionDto,
  ): Promise<CriterionResource> {
    return this.criteria.update(member.tenant.id, params.id, params.criterionId, request);
  }

  /**
   * Remove a claim.
   *
   * @param member - The membership.
   * @param params - The PR and the criterion.
   */
  @Delete(":id/criteria/:criterionId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...CONTRIBUTORS)
  remove(
    @CurrentMember() member: ActiveMembership,
    @Param() params: CriterionParams,
  ): Promise<void> {
    return this.criteria.remove(member.tenant.id, params.id, params.criterionId);
  }

  /**
   * Cite evidence.
   *
   * @param member - The membership.
   * @param params - The PR and the criterion.
   * @param request - The kind and its reference.
   * @returns The criterion, with the new line.
   */
  @Post(":id/criteria/:criterionId/evidence")
  @HttpCode(HttpStatus.CREATED)
  @Roles(...CONTRIBUTORS)
  attach(
    @CurrentMember() member: ActiveMembership,
    @Param() params: CriterionParams,
    @Body() request: AttachEvidenceDto,
  ): Promise<CriterionResource> {
    return this.criteria.attach(member.tenant.id, params.id, params.criterionId, request);
  }

  /**
   * Remove a citation.
   *
   * @param member - The membership.
   * @param params - The PR, the criterion and the evidence.
   * @returns The criterion, as it now stands.
   */
  @Delete(":id/criteria/:criterionId/evidence/:evidenceId")
  @Roles(...CONTRIBUTORS)
  detach(
    @CurrentMember() member: ActiveMembership,
    @Param() params: EvidenceParams,
  ): Promise<CriterionResource> {
    return this.criteria.detach(member.tenant.id, params.id, params.criterionId, params.evidenceId);
  }

  /**
   * Mark verified — only with evidence.
   *
   * @param member - The membership.
   * @param params - The PR and the criterion.
   * @returns The criterion.
   */
  @Post(":id/criteria/:criterionId/verify")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  verify(
    @CurrentMember() member: ActiveMembership,
    @Param() params: CriterionParams,
  ): Promise<CriterionResource> {
    return this.criteria.verify(member.tenant.id, params.id, params.criterionId, actor("verify"));
  }

  /**
   * Move back to unverified.
   *
   * @param member - The membership.
   * @param params - The PR and the criterion.
   * @returns The criterion.
   */
  @Post(":id/criteria/:criterionId/unverify")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  unverify(
    @CurrentMember() member: ActiveMembership,
    @Param() params: CriterionParams,
  ): Promise<CriterionResource> {
    return this.criteria.unverify(
      member.tenant.id,
      params.id,
      params.criterionId,
      actor("unverify"),
    );
  }

  /**
   * Waive, and annotate the host PR. Administrators only.
   *
   * @param member - The membership.
   * @param params - The PR and the criterion.
   * @param request - The reason.
   * @returns The criterion with its waiver, and how the annotation landed.
   */
  @Post(":id/criteria/:criterionId/waive")
  @HttpCode(HttpStatus.CREATED)
  @Roles(...ADMINISTRATORS)
  waive(
    @CurrentMember() member: ActiveMembership,
    @Param() params: CriterionParams,
    @Body() request: WaiveCriterionDto,
  ): Promise<CriterionWaivedResource> {
    return this.criteria.waive(
      member.tenant.id,
      params.id,
      params.criterionId,
      actor("waive"),
      request,
    );
  }
}

/**
 * Who is acting: the signed-in person.
 *
 * @param route - The route's tail, for the error.
 * @returns The actor.
 * @throws {Error} When there is no signed-in person, which the session guard makes unreachable.
 *   A status change nobody can be named for would be an audit row that lied.
 */
function actor(route: string): CriteriaActor {
  const user = currentUser();

  if (user === undefined) {
    throw new Error(
      `/api/v1/pull-requests/:id/…/${route} was reached with no signed-in person. The route is ` +
        "neither @AllowAnonymous() nor @TenantOptional(), and a decision belongs to somebody.",
    );
  }

  return { id: user.id, name: user.name };
}
