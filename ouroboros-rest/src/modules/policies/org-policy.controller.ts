/**
 * `/api/v1/policies/dry-run` — the dry-run policy's read API and its flip (BA.3,
 * [#382](https://github.com/NobuData/ouroboros/issues/382)).
 *
 * **The read is every member's** — a viewer included — because every surface that states the
 * safety promise (the wizard's safety rows, the PR page, the merge plan) reads it here, and a
 * surface that could not read it would have to guess.
 *
 * **The flip is `owner`/`admin`** (`@Roles(...ADMINISTRATORS)`): turning dry-run off means the
 * system may merge code without a person, so everyone below is refused with the API's one `403`,
 * on a direct call exactly as in the UI. Every persisted flip is audited as
 * `policy.dry_run_changed` with its actor, instant and the value it replaced.
 *
 * **The workspace is the session's, never the request's** — no `{orgId}` in the path.
 */

import { Body, Controller, Get, Patch } from "@nestjs/common";

import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { currentUser, type ActiveMembership } from "../tenancy/tenant.context";
import { CurrentMember } from "../tenancy/tenant.decorators";
import { PatchDryRunPolicyDto } from "./org-policy.dto";
import { OrgPolicyService, type DryRunPolicyResource } from "./org-policy.service";

@Controller("policies/dry-run")
export class OrgPolicyController {
  /** @param policies - The policy service. */
  constructor(private readonly policies: OrgPolicyService) {}

  /**
   * The dry-run policy — the one source every consuming surface reads.
   *
   * @param member - The membership.
   * @returns The policy. Never a 404: a workspace that never answered is in dry-run.
   */
  @Get()
  read(@CurrentMember() member: ActiveMembership): Promise<DryRunPolicyResource> {
    return this.policies.read(member.tenant.id);
  }

  /**
   * Flip the policy.
   *
   * @param member - The membership.
   * @param patch - The new value.
   * @returns The policy as it now stands.
   */
  @Patch()
  @Roles(...ADMINISTRATORS)
  update(
    @CurrentMember() member: ActiveMembership,
    @Body() patch: PatchDryRunPolicyDto,
  ): Promise<DryRunPolicyResource> {
    return this.policies.setDryRun(member.tenant.id, actorId(), patch.dryRun);
  }
}

/**
 * The signed-in person's id.
 *
 * @returns It.
 * @throws {Error} When there is no signed-in person, which the session guard makes unreachable —
 *   a flip nobody can be named for would be an audit row that lied.
 */
function actorId(): string {
  const user = currentUser();

  if (user === undefined) {
    throw new Error(
      "/api/v1/policies/dry-run was reached with no signed-in person. The route is neither " +
        "@AllowAnonymous() nor @TenantOptional(), and a policy flip belongs to somebody.",
    );
  }

  return user.id;
}
