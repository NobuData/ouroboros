/**
 * What a member may do, as one decorator and one guard.
 *
 * The issue's second acceptance criterion — *the role guard blocks member-level users from
 * admin mutations* — and the only place in this API that answers `403`. Everywhere else,
 * "you may not" is a `404`, because saying otherwise confirms that an identifier names
 * something real. Here it is safe and it is the only useful answer: the caller has already
 * proved they are a member, so the workspace's existence is not a secret from them, and
 * what they need to be told is that their role is too low.
 *
 * Registered globally after `TenantContextGuard`, which is what lets it assume a membership
 * on any route that declares roles.
 *
 * **A route with no `@Roles()` is open to every member.** That is not the same laxity as
 * `@AllowAnonymous()`: the tenant guard has already refused anybody who is not a member of the
 * workspace, so the default is "any of the four roles" rather than "anybody". Reads are
 * deliberately left at that default across this module — a `viewer` is a role that exists to
 * be able to look.
 */

import {
  Injectable,
  SetMetadata,
  type CanActivate,
  type CustomDecorator,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { OrganizationRole } from "../db/schema";
import { currentMembership } from "./tenant.context";
import { forbidden } from "./tenancy.errors";

/** The metadata key `@Roles()` sets. Namespaced, as every key in this service is. */
export const REQUIRED_ROLES = "ouroboros:tenancy:roles";

/**
 * The roles that administer a workspace.
 *
 * Every mutation in this module requires one of these. Named once rather than repeated on
 * fifteen handlers, so "who may change a workspace" is a question with a single answer and
 * widening it is one edit rather than a search.
 *
 * `member` and `viewer` are absent on purpose: mockup 17 shows a member list where a
 * Maintainer can invite and a Viewer cannot, and `admin` is the stored role behind that
 * Maintainer (V002, and `member.role` since V005).
 */
export const ADMINISTRATORS: readonly OrganizationRole[] = ["owner", "admin"];

/**
 * Require one of these roles in the active workspace.
 *
 * @param roles - The roles that suffice. Holding *any* of them is enough; there is no
 *   ordering between them, because `owner` and `admin` differ in what they may do rather
 *   than in rank.
 * @returns The decorator. Applied to a class it covers every route in it.
 */
export const Roles = (...roles: OrganizationRole[]): CustomDecorator =>
  SetMetadata(REQUIRED_ROLES, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  /** @param reflector - How `@Roles()` is read. */
  constructor(private readonly reflector: Reflector) {}

  /**
   * Allow the request, or refuse it with a `403`.
   *
   * @param context - The execution context.
   * @returns `true` when the route declares no roles, or when the caller holds one of them.
   * @throws {ForbiddenError} `403 forbidden` when their role is not among the required ones.
   * @throws {Error} When a route declares roles and no tenant was resolved — which cannot
   *   happen through the pipeline and would mean `@Roles()` and `@TenantOptional()` on one
   *   handler. A programming mistake, and one that must not read as "allowed".
   */
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<OrganizationRole[] | undefined>(
      REQUIRED_ROLES,
      [context.getHandler(), context.getClass()],
    );

    if (required === undefined || required.length === 0) {
      return true;
    }

    const membership = currentMembership();

    if (membership === undefined) {
      throw new Error(
        "@Roles() was declared on a route with no tenant context. A route that names roles " +
          "cannot also be @TenantOptional() — there is no membership to hold a role in.",
      );
    }

    // Any of them is enough, and a membership may carry more than one role — `member.role`
    // holds a comma-separated list where somebody does (V005). Holding one role that suffices
    // and three that do not is a caller who may proceed.
    if (!membership.roles.some((held) => required.includes(held))) {
      throw forbidden(heldRoles(membership.roles), required);
    }

    return true;
  }
}

/**
 * The roles a refusal echoes back, as one string.
 *
 * `details.role` is documented in `openapi.yaml` as the role the caller holds, and it stays a
 * string here even though a membership carries a list: for every membership anything in this
 * product creates, the list has one entry and this is that word. A member holding two roles
 * sees both, comma-separated, which is exactly how the column spells it — so what a client is
 * shown matches what an administrator would read out of the database.
 *
 * @param roles - What the membership carries.
 * @returns Them, joined. Empty when the membership carries no role this service recognises,
 *   which is honest: there is no word to show, and the caller was refused because of it.
 */
function heldRoles(roles: readonly string[]): string {
  return roles.join(",");
}
