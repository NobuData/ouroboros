/**
 * `/api/v1/pull-requests` — the PR page's reads and head actions (AX.5,
 * [#361](https://github.com/NobuData/ouroboros/issues/361)). `PageService`, `PageActionsService`
 * and `ThreadActionsService` say what each does.
 *
 * **The workspace is the session's, never the request's** — the criteria routes' rule. A PR of
 * another workspace is `404`.
 *
 * **Roles.** Reading is every member's, a `viewer` included. The head actions — *Return to loop*,
 * *Request human review* and approving or declining — and resolving a review-thread entry (#368)
 * are a contributor's: `owner`, `admin` or
 * `member`, as a steer (AP.4) and a criterion's verification (#359) are. Approving or declining
 * also requires the member's `can_approve_loops` capability (#485, `tenancy/capabilities.ts`).
 *
 * **`200` throughout** — the actions answer what they did and the re-evaluated state.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from "@nestjs/common";

import type { Organization } from "../../db/schema";
import { RequiresCapability } from "../../tenancy/capabilities";
import { CONTRIBUTORS, Roles } from "../../tenancy/roles.guard";
import { currentUser, type ActiveMembership } from "../../tenancy/tenant.context";
import { CurrentMember, CurrentTenant } from "../../tenancy/tenant.decorators";
import { PageActionsService, type PageActor } from "./page.actions";
import {
  ApprovalDecisionDto,
  ListPullRequestsQuery,
  PullRequestParams,
  RequestReviewDto,
  ResolveThreadEntryDto,
  ReturnToLoopDto,
  ThreadEntryParams,
} from "./page.dto";
import type {
  PullRequestListResource,
  PullRequestPageResource,
  ReturnToLoopResource,
  ReviewOutcomeResource,
  ThreadResolutionResource,
} from "./page.resources";
import { PageService } from "./page.service";
import { ThreadActionsService } from "./page.thread";

@Controller("pull-requests")
export class PageController {
  /**
   * @param pages - The reads.
   * @param actions - The head actions.
   * @param thread - The review thread's resolution.
   */
  constructor(
    private readonly pages: PageService,
    private readonly actions: PageActionsService,
    private readonly thread: ThreadActionsService,
  ) {}

  /**
   * The workspace's PRs — for navigation and the needs-you surfaces.
   *
   * @param tenant - The workspace.
   * @param query - `state`, `reviewRequested`, `limit`, `offset`.
   * @returns One page, most recently updated first.
   */
  @Get()
  list(
    @CurrentTenant() tenant: Organization,
    @Query() query: ListPullRequestsQuery,
  ): Promise<PullRequestListResource> {
    return this.pages.list(tenant.id, query);
  }

  /**
   * The whole PR page.
   *
   * @param tenant - The workspace.
   * @param params - The PR.
   * @returns Every region's data.
   */
  @Get(":id")
  page(
    @CurrentTenant() tenant: Organization,
    @Param() params: PullRequestParams,
  ): Promise<PullRequestPageResource> {
    return this.pages.page(tenant.id, params.id);
  }

  /**
   * **Return to loop** — the selected red gates' evidence, as an AP.4 correction round.
   *
   * @param member - The membership.
   * @param params - The PR.
   * @param request - The gates.
   * @returns The control, the steer and the expectation.
   */
  @Post(":id/return-to-loop")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  returnToLoop(
    @CurrentMember() member: ActiveMembership,
    @Param() params: PullRequestParams,
    @Body() request: ReturnToLoopDto,
  ): Promise<ReturnToLoopResource> {
    return this.actions.returnToLoop(
      member.tenant.id,
      params.id,
      actor(member, "return-to-loop"),
      request,
    );
  }

  /**
   * **Request human review** — open the approval slot; human approval becomes required.
   *
   * @param member - The membership.
   * @param params - The PR.
   * @param request - Optionally, a host login to ask.
   * @returns The slot and the re-evaluated gate.
   */
  @Post(":id/request-review")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  requestReview(
    @CurrentMember() member: ActiveMembership,
    @Param() params: PullRequestParams,
    @Body() request: RequestReviewDto,
  ): Promise<ReviewOutcomeResource> {
    return this.actions.requestReview(
      member.tenant.id,
      params.id,
      actor(member, "request-review"),
      request,
    );
  }

  /**
   * Approve or decline — the gate re-evaluates.
   *
   * @param member - The membership.
   * @param params - The PR.
   * @param request - The decision and its note.
   * @returns The answered slot and the re-evaluated gate.
   */
  @Post(":id/approvals")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  @RequiresCapability("can_approve_loops")
  decide(
    @CurrentMember() member: ActiveMembership,
    @Param() params: PullRequestParams,
    @Body() request: ApprovalDecisionDto,
  ): Promise<ReviewOutcomeResource> {
    return this.actions.decide(member.tenant.id, params.id, actor(member, "approvals"), request);
  }

  /**
   * **Reply and resolve** — close out an entry of the review thread (#368).
   *
   * @param member - The membership.
   * @param params - The PR and the entry.
   * @param request - The reply, and whether to mirror it to the host.
   * @returns The resolved entry and how the mirror landed.
   */
  @Post(":id/thread/:entryId/resolve")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  resolveThreadEntry(
    @CurrentMember() member: ActiveMembership,
    @Param() params: ThreadEntryParams,
    @Body() request: ResolveThreadEntryDto,
  ): Promise<ThreadResolutionResource> {
    return this.thread.resolve(
      member.tenant.id,
      params.id,
      params.entryId,
      actor(member, "thread/:entryId/resolve"),
      request,
    );
  }
}

/**
 * Who is acting: the signed-in person, with their name and their roles here.
 *
 * @param member - The membership.
 * @param route - The route's tail, for the error.
 * @returns The actor.
 * @throws {Error} When there is no signed-in person, which the session guard makes unreachable. A
 *   head action nobody can be named for would be an audit row that lied.
 */
function actor(member: ActiveMembership, route: string): PageActor {
  const user = currentUser();

  if (user === undefined) {
    throw new Error(
      `/api/v1/pull-requests/:id/${route} was reached with no signed-in person. The route is ` +
        "neither @AllowAnonymous() nor @TenantOptional(), and a head action belongs to somebody.",
    );
  }

  return { id: user.id, name: user.name, roles: member.roles };
}
