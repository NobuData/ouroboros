/**
 * `/api/v1/facts` — the learned facts' lifecycle (BF.2,
 * [#411](https://github.com/NobuData/ouroboros/issues/411)).
 *
 * **The workspace is the session's, never the request's** — no `{orgId}` in a path; the tenant
 * guard resolves and membership-checks the active organization, and every statement is scoped by
 * it, so another workspace's fact is a `404` indistinguishable from an absent one.
 *
 * **Members read; members and above decide.** The reads carry no `@Roles()` — every member
 * including a `viewer`. Proposing, Confirm / Reject / Re-confirm / Expire / Re-learn and anchor
 * changes carry `@Roles(...CONTRIBUTORS)` — owner, admin and member — and record the session's
 * person as the transition's actor. Running the staleness sweep on demand is an administrator's.
 *
 * **`needs-you` and `sweep` are declared before `:factId`, and the order is the route** — Express
 * matches in registration order. `facts.controller.spec.ts` holds the order.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from "@nestjs/common";

import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, CONTRIBUTORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import {
  CreateAnchorBody,
  ExpireFactBody,
  FactAnchorParams,
  FactIdParams,
  ListFactsQuery,
  ProposeFactBody,
  RelearnFactBody,
  TransitionFactBody,
} from "./facts.dto";
import type { FactDetail, FactList, FactNeedsYou } from "./facts.resources";
import { FactsService } from "./facts.service";
import { FactSweepService, type SweepReport } from "./facts.sweep";

@Controller("facts")
export class FactsController {
  /**
   * @param facts - The lifecycle.
   * @param sweep - The staleness sweep.
   */
  constructor(
    private readonly facts: FactsService,
    private readonly sweep: FactSweepService,
  ) {}

  /**
   * `GET /api/v1/facts` — mockup 14's *"Learned by the loop"* card.
   *
   * @param tenant - The workspace.
   * @param query - `status`, to read one status.
   * @returns The facts, newest first, and every status's count.
   */
  @Get()
  list(@CurrentTenant() tenant: Organization, @Query() query: ListFactsQuery): Promise<FactList> {
    return this.facts.list(tenant.id, query.status);
  }

  /**
   * `POST /api/v1/facts` — a fact written by hand, born `proposed`.
   *
   * @param tenant - The workspace.
   * @param principal - The session — the proposal's actor.
   * @param body - The fact.
   * @returns The new fact, `201`.
   */
  @Roles(...CONTRIBUTORS)
  @Post()
  propose(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: ProposeFactBody,
  ): Promise<FactDetail> {
    return this.facts.proposeManual(tenant.id, body, principal.user.id);
  }

  /**
   * `GET /api/v1/facts/needs-you` — the `fact_review` feed mockup 16's inbox consumes. Declared
   * above `:factId`.
   *
   * @param tenant - The workspace.
   * @returns Proposals awaiting review and stale facts, oldest wait first, and their count.
   */
  @Get("needs-you")
  needsYou(@CurrentTenant() tenant: Organization): Promise<FactNeedsYou> {
    return this.facts.needsYou(tenant.id);
  }

  /**
   * `POST /api/v1/facts/sweep` — run the nightly staleness pass for this workspace now. Declared
   * above `:factId`.
   *
   * @param tenant - The workspace.
   * @returns What the pass read and flagged, and how many confirmed facts it cannot watch.
   */
  @Roles(...ADMINISTRATORS)
  @Post("sweep")
  @HttpCode(HttpStatus.OK)
  runSweep(@CurrentTenant() tenant: Organization): Promise<SweepReport> {
    return this.sweep.sweepWorkspace(tenant.id);
  }

  /**
   * `GET /api/v1/facts/{factId}` — one fact and its audit history.
   *
   * @param tenant - The workspace.
   * @param params - The fact.
   * @returns The detail.
   */
  @Get(":factId")
  read(@CurrentTenant() tenant: Organization, @Param() params: FactIdParams): Promise<FactDetail> {
    return this.facts.get(tenant.id, params.factId);
  }

  /**
   * `POST /api/v1/facts/{factId}/confirm` — **Confirm**: `proposed → confirmed`.
   *
   * @param tenant - The workspace.
   * @param params - The fact.
   * @param principal - The session — *"confirmed by <you>"*.
   * @param body - An optional note.
   * @returns The fact.
   */
  @Roles(...CONTRIBUTORS)
  @Post(":factId/confirm")
  @HttpCode(HttpStatus.OK)
  confirm(
    @CurrentTenant() tenant: Organization,
    @Param() params: FactIdParams,
    @Session() principal: Principal,
    @Body() body: TransitionFactBody,
  ): Promise<FactDetail> {
    return this.facts.confirm(tenant.id, params.factId, principal.user.id, body.reason);
  }

  /**
   * `POST /api/v1/facts/{factId}/reject` — **Reject**: `proposed → rejected`.
   *
   * @param tenant - The workspace.
   * @param params - The fact.
   * @param principal - The session.
   * @param body - An optional note.
   * @returns The fact.
   */
  @Roles(...CONTRIBUTORS)
  @Post(":factId/reject")
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentTenant() tenant: Organization,
    @Param() params: FactIdParams,
    @Session() principal: Principal,
    @Body() body: TransitionFactBody,
  ): Promise<FactDetail> {
    return this.facts.reject(tenant.id, params.factId, principal.user.id, body.reason);
  }

  /**
   * `POST /api/v1/facts/{factId}/reconfirm` — a stale fact still holds: `stale → confirmed`.
   *
   * @param tenant - The workspace.
   * @param params - The fact.
   * @param principal - The session.
   * @param body - An optional note.
   * @returns The fact.
   */
  @Roles(...CONTRIBUTORS)
  @Post(":factId/reconfirm")
  @HttpCode(HttpStatus.OK)
  reconfirm(
    @CurrentTenant() tenant: Organization,
    @Param() params: FactIdParams,
    @Session() principal: Principal,
    @Body() body: TransitionFactBody,
  ): Promise<FactDetail> {
    return this.facts.reconfirm(tenant.id, params.factId, principal.user.id, body.reason);
  }

  /**
   * `POST /api/v1/facts/{factId}/expire` — a confirmed or stale fact stopped being true. The
   * reason is required; the use count is snapshotted and frozen.
   *
   * @param tenant - The workspace.
   * @param params - The fact.
   * @param principal - The session.
   * @param body - The reason.
   * @returns The fact, `expired`.
   */
  @Roles(...CONTRIBUTORS)
  @Post(":factId/expire")
  @HttpCode(HttpStatus.OK)
  expire(
    @CurrentTenant() tenant: Organization,
    @Param() params: FactIdParams,
    @Session() principal: Principal,
    @Body() body: ExpireFactBody,
  ): Promise<FactDetail> {
    return this.facts.expire(tenant.id, params.factId, principal.user.id, body.reason);
  }

  /**
   * `POST /api/v1/facts/{factId}/relearn` — **Re-learn**: a new proposal linked to this expired
   * fact, which stays as it was.
   *
   * @param tenant - The workspace.
   * @param params - The expired fact.
   * @param principal - The session.
   * @param body - The new text, optionally.
   * @returns The **new** fact, `201`.
   */
  @Roles(...CONTRIBUTORS)
  @Post(":factId/relearn")
  relearn(
    @CurrentTenant() tenant: Organization,
    @Param() params: FactIdParams,
    @Session() principal: Principal,
    @Body() body: RelearnFactBody,
  ): Promise<FactDetail> {
    return this.facts.relearn(tenant.id, params.factId, principal.user.id, body.text);
  }

  /**
   * `POST /api/v1/facts/{factId}/anchors` — a reason the fact can expire.
   *
   * @param tenant - The workspace.
   * @param params - The fact.
   * @param body - The anchor.
   * @returns The fact, `201`.
   */
  @Roles(...CONTRIBUTORS)
  @Post(":factId/anchors")
  addAnchor(
    @CurrentTenant() tenant: Organization,
    @Param() params: FactIdParams,
    @Body() body: CreateAnchorBody,
  ): Promise<FactDetail> {
    return this.facts.addAnchor(tenant.id, params.factId, body);
  }

  /**
   * `DELETE /api/v1/facts/{factId}/anchors/{anchorId}`.
   *
   * @param tenant - The workspace.
   * @param params - The fact and the anchor.
   * @returns The fact.
   */
  @Roles(...CONTRIBUTORS)
  @Delete(":factId/anchors/:anchorId")
  removeAnchor(
    @CurrentTenant() tenant: Organization,
    @Param() params: FactAnchorParams,
  ): Promise<FactDetail> {
    return this.facts.removeAnchor(tenant.id, params.factId, params.anchorId);
  }
}
