/**
 * `/api/v1/backlog/{id}/estimate` and `/api/v1/backlog/estimate-all` — mockup 03's two
 * re-estimate actions (L.4, [#108](https://github.com/NobuData/ouroboros/issues/108)).
 *
 * **It is `EstimationModule`'s controller under `BacklogModule`'s prefix**, and that is
 * deliberate rather than untidy. What these two routes *do* is estimation — they are the
 * pipeline's only external trigger, and everything they touch is this module's — while what
 * they are *about* is an issue in the backlog, which is where a client looks for them.
 * `AuditModule` serves `GET /api/v1/providers/audit` on the same argument. Nothing here can be
 * shadowed by the routes that share the prefix: `estimate-all` and `sync` are two path
 * segments, `{id}/estimate` and `sync-status` cannot collide, and M.2's future
 * `GET /backlog/{id}` is a different method.
 *
 * **The workspace is the session's, never the request's** — the same sentence the backlog,
 * queue and dashboard controllers open with. No `{orgId}` in the path, the tenant guard
 * resolves and membership-checks the active organization, and these handlers read what it
 * established. No `@TenantOptional()`, so a session acting in no workspace is a
 * `400 organization_required` before either handler runs.
 *
 * **Two different role gates, and the difference is what the work costs.** One issue is
 * `member+` — re-estimating something you are working on is work. The whole backlog is
 * `admin+`, because a fan-out spends the workspace's engine quota in one press and real money
 * once O.2 ([#123](https://github.com/NobuData/ouroboros/issues/123)) puts a model behind it.
 * That is the ticket's own split, and it is the first place in this service where two routes
 * beside each other carry different lists.
 *
 * **Both answer `202`.** The work outlives the response: an estimate is an engine call and a
 * versioned write, and a request that waited for a backlog of them would be a timeout. What
 * the answers carry is what was *taken* — a status a client can render at once, and counts a
 * confirmation dialog can be honest about.
 */

import { Controller, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { ADMINISTRATORS, CONTRIBUTORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { EstimateParams } from "./estimation.dto";
import type { EstimationAccepted, EstimationFanout } from "./estimation.resources";
import { EstimationTriggerService } from "./estimation.trigger.service";

@Controller("backlog")
export class EstimationController {
  /** @param trigger - The guards, and the one call that queues work. */
  constructor(private readonly trigger: EstimationTriggerService) {}

  /**
   * Re-estimate the whole backlog.
   *
   * Declared **before** the single-issue route below. The two cannot actually collide — this
   * path is two segments and that one is three — but `app.module.ts` records the rule that a
   * literal segment is registered ahead of a parameterised one, and a reader should not have
   * to re-derive that these two are the exception.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @returns How many issues it queued, left alone, and found.
   * @throws {ConflictError} `backlog_already_estimating` when a fan-out is already running.
   * @throws {TooManyRequestsError} `estimation_rate_limited` when the window is full.
   */
  @Post("estimate-all")
  @Roles(...ADMINISTRATORS)
  @HttpCode(HttpStatus.ACCEPTED)
  estimateAll(@CurrentTenant() tenant: Organization): Promise<EstimationFanout> {
    return this.trigger.estimateAll(tenant.id);
  }

  /**
   * Re-estimate one issue.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The issue's row id, validated as a uuid before a statement is issued.
   * @returns The issue as it now stands: `estimating`, and queued.
   * @throws {NotFoundError} `issue_not_found` — including for an issue in another workspace.
   * @throws {ConflictError} `issue_already_estimating` when one is already in flight.
   * @throws {TooManyRequestsError} `estimation_rate_limited` when the window is full.
   */
  @Post(":id/estimate")
  @Roles(...CONTRIBUTORS)
  @HttpCode(HttpStatus.ACCEPTED)
  estimate(
    @CurrentTenant() tenant: Organization,
    @Param() params: EstimateParams,
  ): Promise<EstimationAccepted> {
    return this.trigger.estimate(tenant.id, params.id);
  }
}
