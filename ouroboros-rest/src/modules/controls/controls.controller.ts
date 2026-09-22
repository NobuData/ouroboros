/**
 * `/api/v1/runs/:id/controls` — the console's half of the control queue (AP.4,
 * [#306](https://github.com/NobuData/ouroboros/issues/306)): mockup 10's *Pause loop*, *Abort
 * run* and the steering box, and the list their ack chips read.
 *
 * **The workspace is the session's, never the request's**, as on every `/runs` route. The tenant
 * guard resolves and membership-checks it, and this controller reads what it established.
 *
 * **`@Roles(...CONTRIBUTORS)` on the submission, and the rest of the policy in the service.**
 * The guard refuses a `viewer` before the body is read, because a viewer may press nothing. The
 * finer rule (a `member` may steer, and only an administrator may pause, resume or abort)
 * depends on the body's `kind`, which a route decorator cannot see, so the service applies it,
 * with the same `403 forbidden`. The listing is open to every member, a `viewer` included: it
 * is a read.
 *
 * **`202` for a submission, whatever became of it.** The control is accepted onto the queue and
 * nothing has happened yet, which is what `202` says. The body's `state` is what the chip
 * draws: `pending` (*sent*), `rejected` with its reason, or the earlier control a repeat
 * collapsed into.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { Roles, CONTRIBUTORS } from "../tenancy/roles.guard";
import type { ActiveMembership } from "../tenancy/tenant.context";
import { currentUser } from "../tenancy/tenant.context";
import { CurrentMember, CurrentTenant } from "../tenancy/tenant.decorators";
import { RunControlsParams, SubmitControlDto } from "./controls.dto";
import type { RunControlResource, RunControlsListResource } from "./controls.resources";
import { ControlsService, type Requester } from "./controls.service";

@Controller("runs")
export class ControlsController {
  /** @param controls - Where the policy is. */
  constructor(private readonly controls: ControlsService) {}

  /**
   * Ask for a control.
   *
   * @param member - The membership that authorized this request: the workspace and the roles.
   * @param params - The run.
   * @param request - The kind, and what it carries.
   * @returns The control, as the chip reads it.
   */
  @Post(":id/controls")
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(...CONTRIBUTORS)
  submit(
    @CurrentMember() member: ActiveMembership,
    @Param() params: RunControlsParams,
    @Body() request: SubmitControlDto,
  ): Promise<RunControlResource> {
    return this.controls.submit(member.tenant.id, params.id, requester(member), request);
  }

  /**
   * The run's recent controls, newest first.
   *
   * @param tenant - The workspace.
   * @param params - The run.
   * @returns The controls, with their states.
   */
  @Get(":id/controls")
  list(
    @CurrentTenant() tenant: Organization,
    @Param() params: RunControlsParams,
  ): Promise<RunControlsListResource> {
    return this.controls.list(tenant.id, params.id);
  }
}

/**
 * Who is asking: the signed-in person, and the roles their membership carries.
 *
 * @param member - The membership.
 * @returns The requester.
 * @throws {Error} When there is no signed-in person, which the session guard makes
 *   unreachable. A control nobody can be named for would be an audit row that lied.
 */
function requester(member: ActiveMembership): Requester {
  const user = currentUser();

  if (user === undefined) {
    throw new Error(
      "POST /api/v1/runs/:id/controls was reached with no signed-in person. The route is " +
        "neither @AllowAnonymous() nor @TenantOptional(), and a control belongs to somebody.",
    );
  }

  return { id: user.id, name: user.name, roles: member.roles };
}
