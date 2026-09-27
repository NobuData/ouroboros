/**
 * `/api/v1/pull-requests/:id/merge-plan…` — the merge plan, its arm, and the merge (AX.4,
 * [#360](https://github.com/NobuData/ouroboros/issues/360)). `MergeExecutorService`'s header says
 * what each does.
 *
 * **The workspace is the session's, never the request's** — the criteria routes' rule.
 *
 * **Roles.** Reading the plan is every member's, a `viewer` included. Arming and merging are
 * routed to contributors and then held by the service to `owner`/`admin`, or a `member` whose PR's
 * pinned workflow auto-merges — the policy is per PR, so it cannot be a route decorator. Disarming
 * is the safe direction and any contributor's.
 *
 * **`200` throughout** — nothing here creates a resource the caller did not already have.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";

import type { Organization } from "../../db/schema";
import { CONTRIBUTORS, Roles } from "../../tenancy/roles.guard";
import { currentUser, type ActiveMembership } from "../../tenancy/tenant.context";
import { CurrentMember, CurrentTenant } from "../../tenancy/tenant.decorators";
import { ArmMergePlanDto, PullRequestParams } from "./merge.dto";
import { MergeExecutorService, type MergeActor } from "./merge.executor";
import type { MergeOutcomeResource, MergePlanResource } from "./merge.resources";

@Controller("pull-requests")
export class MergeController {
  /** @param executor - The merge executor. */
  constructor(private readonly executor: MergeExecutorService) {}

  /**
   * The merge plan — mockup 12's Merge plan card, with why a re-check last disarmed it.
   *
   * @param tenant - The workspace.
   * @param params - The PR.
   * @returns The plan, written with the defaults if the PR had none.
   */
  @Get(":id/merge-plan")
  plan(
    @CurrentTenant() tenant: Organization,
    @Param() params: PullRequestParams,
  ): Promise<MergePlanResource> {
    return this.executor.plan(tenant.id, params.id);
  }

  /**
   * **Merge when all gates green** — arm against the revision the person looked at.
   *
   * @param member - The membership.
   * @param params - The PR.
   * @param request - The revision.
   * @returns The armed plan.
   */
  @Post(":id/merge-plan/arm")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  arm(
    @CurrentMember() member: ActiveMembership,
    @Param() params: PullRequestParams,
    @Body() request: ArmMergePlanDto,
  ): Promise<MergePlanResource> {
    return this.executor.arm(member.tenant.id, params.id, actor(member, "arm"), request.revisionId);
  }

  /**
   * Disarm.
   *
   * @param member - The membership.
   * @param params - The PR.
   * @returns The disarmed plan.
   */
  @Post(":id/merge-plan/disarm")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  disarm(
    @CurrentMember() member: ActiveMembership,
    @Param() params: PullRequestParams,
  ): Promise<MergePlanResource> {
    return this.executor.disarm(member.tenant.id, params.id, actor(member, "disarm"));
  }

  /**
   * Merge now, through the same re-check.
   *
   * @param member - The membership.
   * @param params - The PR.
   * @returns The final plan, the ticket's closure and any action that did not run.
   */
  @Post(":id/merge-plan/merge")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  merge(
    @CurrentMember() member: ActiveMembership,
    @Param() params: PullRequestParams,
  ): Promise<MergeOutcomeResource> {
    return this.executor.merge(member.tenant.id, params.id, actor(member, "merge"));
  }
}

/**
 * Who is acting: the signed-in person, with their roles here.
 *
 * @param member - The membership.
 * @param route - The route's tail, for the error.
 * @returns The actor.
 * @throws {Error} When there is no signed-in person, which the session guard makes unreachable. An
 *   arm or a merge nobody can be named for would be an audit row that lied.
 */
function actor(member: ActiveMembership, route: string): MergeActor {
  const user = currentUser();

  if (user === undefined) {
    throw new Error(
      `/api/v1/pull-requests/:id/merge-plan/${route} was reached with no signed-in person. The ` +
        "route is neither @AllowAnonymous() nor @TenantOptional(), and a merge belongs to somebody.",
    );
  }

  return { id: user.id, roles: member.roles };
}
