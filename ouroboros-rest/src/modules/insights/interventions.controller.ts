/**
 * `/api/v1/insights/interventions` — re-categorizing an intervention's cause (BI.3,
 * [#434](https://github.com/NobuData/ouroboros/issues/434), decision **I5**).
 *
 * **Member and above** (`@Roles(...CONTRIBUTORS)`): correcting why a loop needed a person changes
 * what the Insights card tells a team to fix, so a `viewer` is refused with the API's one `403` —
 * on a direct call exactly as in the UI. Every correction writes an `intervention_overrides` audit
 * row (actor, from-cause, to-cause, reason) in the same transaction as the change.
 *
 * **The workspace is the session's, never the request's** — no `{orgId}` in the path; another
 * workspace's event is a `404`.
 */

import { Body, Controller, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";

import { CONTRIBUTORS, Roles } from "../tenancy/roles.guard";
import { currentUser, type ActiveMembership } from "../tenancy/tenant.context";
import { CurrentMember } from "../tenancy/tenant.decorators";
import { InterventionIdParams, RecategorizeInterventionBody } from "./interventions.dto";
import type { InterventionResource } from "./interventions.resources";
import { InterventionsService } from "./interventions.service";

@Controller("insights/interventions")
export class InterventionsController {
  /** @param interventions - The service. */
  constructor(private readonly interventions: InterventionsService) {}

  /**
   * `POST /api/v1/insights/interventions/{id}/recategorize` — a person's cause.
   *
   * @param member - The membership.
   * @param params - The event.
   * @param body - The cause and why.
   * @returns The event, `causeOrigin: "human"`, with its override.
   */
  @Roles(...CONTRIBUTORS)
  @Post(":id/recategorize")
  @HttpCode(HttpStatus.OK)
  recategorize(
    @CurrentMember() member: ActiveMembership,
    @Param() params: InterventionIdParams,
    @Body() body: RecategorizeInterventionBody,
  ): Promise<InterventionResource> {
    return this.interventions.recategorize(member.tenant.id, actorId(), params.id, body);
  }
}

/**
 * The signed-in person's id.
 *
 * @returns It.
 * @throws {Error} When there is no signed-in person, which the session guard makes unreachable —
 *   a correction nobody can be named for would be an audit row that lied.
 */
function actorId(): string {
  const user = currentUser();

  if (user === undefined) {
    throw new Error(
      "/api/v1/insights/interventions was reached with no signed-in person. The route is " +
        "neither @AllowAnonymous() nor @TenantOptional(), and a re-categorization belongs to " +
        "somebody.",
    );
  }

  return user.id;
}
