/**
 * `/api/v1/test-runs/:id/…` — the Mark & Route card's routes (AT.4,
 * [#332](https://github.com/NobuData/ouroboros/issues/332)).
 *
 * **The workspace is the session's, never the request's.** The tenant guard resolves and
 * membership-checks it, and this controller reads what it established.
 *
 * **Roles on the routes themselves.** The reads are every member's, a `viewer` included. A
 * `member` may classify and re-run — the correction round is a steer, which AP.4 lets a member
 * send, and a re-run is a build, which AH.4 lets a member submit — and **only an administrator may
 * waive**, because a waiver lets a failure through.
 *
 * **`201` for a classification and a waiver**, which are records this request created; **`202`
 * for a re-run**, which is queued and has not started — its `queueState` says where it stands.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";

import type { Requester } from "../controls/controls.service";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, CONTRIBUTORS, Roles } from "../tenancy/roles.guard";
import { currentUser, type ActiveMembership } from "../tenancy/tenant.context";
import { CurrentMember, CurrentTenant } from "../tenancy/tenant.decorators";
import { ClassifyCaseDto, RerunDto, TestCaseParams, TestRunParams, WaiveDto } from "./triage.dto";
import type {
  ClassificationsListResource,
  ClassifyResultResource,
  RerunResource,
  TestRunHintsResource,
  WaiverResource,
} from "./triage.resources";
import { TriageService } from "./triage.service";

@Controller("test-runs")
export class TriageController {
  /** @param triage - Where the routing is. */
  constructor(private readonly triage: TriageService) {}

  /**
   * The heuristic hint for every failing case of an attempt.
   *
   * @param tenant - The workspace.
   * @param params - The attempt.
   * @returns The hints.
   */
  @Get(":id/hints")
  hints(
    @CurrentTenant() tenant: Organization,
    @Param() params: TestRunParams,
  ): Promise<TestRunHintsResource> {
    return this.triage.hints(tenant.id, params.id);
  }

  /**
   * Each classified case's current decision, with its routing receipt.
   *
   * @param tenant - The workspace.
   * @param params - The attempt.
   * @returns The decisions.
   */
  @Get(":id/classifications")
  classifications(
    @CurrentTenant() tenant: Organization,
    @Param() params: TestRunParams,
  ): Promise<ClassificationsListResource> {
    return this.triage.classifications(tenant.id, params.id);
  }

  /**
   * Classify a failing case, and route the decision.
   *
   * @param member - The membership: the workspace and the roles.
   * @param params - The attempt and the case.
   * @param request - The class, note, subtype and toggles.
   * @returns The classification and what routing did.
   */
  @Post(":id/cases/:caseId/classify")
  @HttpCode(HttpStatus.CREATED)
  @Roles(...CONTRIBUTORS)
  classify(
    @CurrentMember() member: ActiveMembership,
    @Param() params: TestCaseParams,
    @Body() request: ClassifyCaseDto,
  ): Promise<ClassifyResultResource> {
    return this.triage.classify(
      member.tenant.id,
      params.id,
      params.caseId,
      requester(member, "classify"),
      request,
    );
  }

  /**
   * *Re-run failed* or *Re-run full suite*.
   *
   * @param member - The membership.
   * @param params - The attempt.
   * @param request - The scope.
   * @returns The job and its queue state.
   */
  @Post(":id/rerun")
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(...CONTRIBUTORS)
  rerun(
    @CurrentMember() member: ActiveMembership,
    @Param() params: TestRunParams,
    @Body() request: RerunDto,
  ): Promise<RerunResource> {
    return this.triage.rerun(
      member.tenant.id,
      params.id,
      requester(member, "rerun"),
      request.scope,
    );
  }

  /**
   * Record a waiver. Administrators only.
   *
   * @param member - The membership.
   * @param params - The attempt.
   * @param request - The reason and the waived cases.
   * @returns The waiver.
   */
  @Post(":id/waivers")
  @HttpCode(HttpStatus.CREATED)
  @Roles(...ADMINISTRATORS)
  waive(
    @CurrentMember() member: ActiveMembership,
    @Param() params: TestRunParams,
    @Body() request: WaiveDto,
  ): Promise<WaiverResource> {
    return this.triage.waive(member.tenant.id, params.id, requester(member, "waivers").id, request);
  }
}

/**
 * Who is asking: the signed-in person, and the roles their membership carries.
 *
 * @param member - The membership.
 * @param route - The route's last segment, for the error.
 * @returns The requester.
 * @throws {Error} When there is no signed-in person, which the session guard makes unreachable.
 *   A decision nobody can be named for would be an audit row that lied.
 */
function requester(member: ActiveMembership, route: string): Requester {
  const user = currentUser();

  if (user === undefined) {
    throw new Error(
      `POST /api/v1/test-runs/:id/…/${route} was reached with no signed-in person. The route is ` +
        "neither @AllowAnonymous() nor @TenantOptional(), and a decision belongs to somebody.",
    );
  }

  return { id: user.id, name: user.name, roles: member.roles };
}
