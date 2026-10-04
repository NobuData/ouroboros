/**
 * `InboxActionsController` — `POST /api/v1/inbox/items/{id}/actions/{actionId}`, the single
 * execution endpoint (BN.2, [#462](https://github.com/NobuData/ouroboros/issues/462)).
 *
 * **No `@Roles()`**: every member reaches the route, and the executor checks the action's declared
 * `required_role` (and `can_approve_loops` for `approver`) itself — the declaration is the policy,
 * so a direct API call from an under-privileged member is refused there rather than merely hidden
 * in the UI. A caller with no signed-in person (a service account) is refused: a resolution names
 * the person who answered.
 */

import { Body, Controller, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";

import type { ActiveMembership } from "../tenancy/tenant.context";
import { currentUser } from "../tenancy/tenant.context";
import { CurrentMember } from "../tenancy/tenant.decorators";
import { InboxActionDto, InboxActionParams } from "./inbox-actions.dto";
import type { ActionResultResource } from "./inbox-actions.resources";
import { InboxActionsService } from "./inbox-actions.service";

@Controller("inbox")
export class InboxActionsController {
  /**
   * @param actions - The executor.
   */
  constructor(private readonly actions: InboxActionsService) {}

  /**
   * Press one action of one decision card.
   *
   * @param member - The workspace and the caller's roles.
   * @param params - The item and the action.
   * @param request - The note and the idempotency key.
   * @returns The resolution, with the owning plane's receipt.
   */
  @Post("items/:id/actions/:actionId")
  @HttpCode(HttpStatus.OK)
  execute(
    @CurrentMember() member: ActiveMembership,
    @Param() params: InboxActionParams,
    @Body() request: InboxActionDto,
  ): Promise<ActionResultResource> {
    const user = currentUser();

    return this.actions.execute(
      member.tenant.id,
      params.id,
      params.actionId,
      user === undefined ? undefined : { id: user.id, name: user.name, roles: member.roles },
      { note: request.note, idempotencyKey: request.idempotencyKey },
      "web",
    );
  }
}
