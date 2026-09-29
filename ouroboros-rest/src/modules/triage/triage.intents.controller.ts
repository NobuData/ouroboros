/**
 * `PUT /api/v1/runs/:id/pr-intents` — the Mark & Route card's two PR toggles, set on their own
 * (AU.6, [#340](https://github.com/NobuData/ouroboros/issues/340), decision **T8**).
 *
 * A toggle is a fact about the **run**, not about one attempt of it, which is why this route is
 * under `runs` while the rest of the card's routes are under `test-runs` — and why it is a
 * controller of its own rather than a seventh method of {@link TriageController}.
 *
 * **The workspace is the session's, never the request's**, and a run of another workspace is a
 * `404` like an absent one. **A `member` may set them**, as a member may classify: the toggles
 * were only ever written by a classification until now, and the role that may send them with a
 * decision may send them without one.
 */

import { Body, Controller, Param, Put } from "@nestjs/common";

import { RunParams } from "../runs/runs.dto";
import { CONTRIBUTORS, Roles } from "../tenancy/roles.guard";
import { currentUser, type ActiveMembership } from "../tenancy/tenant.context";
import { CurrentMember } from "../tenancy/tenant.decorators";
import { RunIntentsDto } from "./triage.dto";
import type { RunIntentsResource } from "./triage.resources";
import { TriageService } from "./triage.service";

@Controller("runs")
export class TriageIntentsController {
  /** @param triage - Where the toggles are stored. */
  constructor(private readonly triage: TriageService) {}

  /**
   * Set *Block PR until green*, *Auto re-run physical suite after fix*, or both.
   *
   * @param member - The membership: the workspace and the roles.
   * @param params - The run.
   * @param request - The toggles to set; an absent one keeps its stored value.
   * @returns Both toggles as stored.
   * @throws {Error} When there is no signed-in person, which the session guard makes unreachable.
   */
  @Put(":id/pr-intents")
  @Roles(...CONTRIBUTORS)
  setIntents(
    @CurrentMember() member: ActiveMembership,
    @Param() params: RunParams,
    @Body() request: RunIntentsDto,
  ): Promise<RunIntentsResource> {
    const user = currentUser();

    if (user === undefined) {
      throw new Error(
        "PUT /api/v1/runs/:id/pr-intents was reached with no signed-in person. The route is " +
          "neither @AllowAnonymous() nor @TenantOptional(), and a toggle is set by somebody.",
      );
    }

    return this.triage.setIntents(
      member.tenant.id,
      params.id,
      { id: user.id, name: user.name, roles: member.roles },
      request,
    );
  }
}
