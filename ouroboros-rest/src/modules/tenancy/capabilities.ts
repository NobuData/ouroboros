/**
 * Member capabilities — `can_approve_loops`, and the one check every approval path makes
 * ([#485](https://github.com/NobuData/ouroboros/issues/485), BR.1, decision S3).
 *
 * The Members & Roles card's *Can approve loops* column is a security control, and a control
 * that changed nothing would be worse than none: an administrator who unticks it would believe
 * they had removed somebody's approval power when they had not. So the capability is checked
 * here, **at the route**, by a global guard that runs after `RolesGuard`:
 *
 * ```
 * @Roles(...CONTRIBUTORS)                       ← may this role reach the route at all?
 * @RequiresCapability("can_approve_loops")      ← and does this member hold the capability?
 * ```
 *
 * One source for every consumer — the PR plane's approve, waive and merge routes now, the
 * inbox's approve-class actions when #464 builds them — so the planes cannot drift apart.
 *
 * **Defaults follow the role, explicit settings survive it.** A member with no
 * `member_capabilities` row holds what their role implies (owner and admin yes; member and
 * viewer no). Once an administrator sets the capability, the row wins, and a later role change
 * does not reset it.
 */

import {
  Injectable,
  SetMetadata,
  type CanActivate,
  type CustomDecorator,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { ForbiddenError } from "../errors/error.envelope";
import type { OrganizationRole } from "../db/schema";
import { CapabilityRepository } from "./capability.repository";
import { currentMembership, currentService, currentUser } from "./tenant.context";

/** Every capability a member can hold. */
export const MEMBER_CAPABILITIES = ["can_approve_loops"] as const;

/** One of {@link MEMBER_CAPABILITIES}. */
export type MemberCapabilityName = (typeof MEMBER_CAPABILITIES)[number];

/** The roles whose members may approve loops unless told otherwise. */
export const APPROVING_ROLES: readonly OrganizationRole[] = ["owner", "admin"];

/**
 * What a member holds when nobody has set it — the role default.
 *
 * @param roles - The member's roles (a member may hold several).
 * @returns `true` when any role is an approving one.
 */
export function defaultCanApproveLoops(roles: readonly string[]): boolean {
  return roles.some((role) => (APPROVING_ROLES as readonly string[]).includes(role));
}

/**
 * What a member actually holds.
 *
 * @param roles - The member's roles.
 * @param explicit - The stored setting, or `null` when none was ever made.
 * @returns The explicit setting when there is one, otherwise the role default.
 */
export function effectiveCanApproveLoops(
  roles: readonly string[],
  explicit: boolean | null,
): boolean {
  return explicit ?? defaultCanApproveLoops(roles);
}

/** Metadata key for {@link RequiresCapability}. */
export const REQUIRED_CAPABILITY = "ouroboros:tenancy:capability";

/**
 * Require a member capability on a route, after its role check.
 *
 * @param capability - The capability, e.g. `can_approve_loops`.
 * @returns The decorator.
 */
export const RequiresCapability = (capability: MemberCapabilityName): CustomDecorator =>
  SetMetadata(REQUIRED_CAPABILITY, capability);

/** The error code a missing capability answers with. */
export const CAPABILITY_REQUIRED = "capability_required";

/**
 * The caller lacks a capability the route requires.
 *
 * @param capability - The capability — named, so the UI can say which.
 * @returns A `403`.
 */
export function capabilityRequired(capability: MemberCapabilityName): ForbiddenError {
  return new ForbiddenError(
    CAPABILITY_REQUIRED,
    "You do not hold the capability this action requires. A workspace administrator can grant it.",
    { capability },
  );
}

@Injectable()
export class CapabilityGuard implements CanActivate {
  /**
   * @param reflector - Reads {@link REQUIRED_CAPABILITY}.
   * @param capabilities - The stored settings.
   */
  constructor(
    private readonly reflector: Reflector,
    private readonly capabilities: CapabilityRepository,
  ) {}

  /**
   * Refuse a caller who lacks the route's capability.
   *
   * @param context - The request.
   * @returns `true` when the route requires nothing or the caller holds it.
   * @throws {ForbiddenError} `capability_required`, naming the capability. Service accounts are
   *   always refused: they are not members and hold no person's approval power.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const capability = this.reflector.getAllAndOverride<MemberCapabilityName | undefined>(
      REQUIRED_CAPABILITY,
      [context.getHandler(), context.getClass()],
    );

    if (capability === undefined) return true;

    const membership = currentMembership();
    const user = currentUser();

    if (currentService() !== undefined || membership === undefined || user === undefined) {
      throw capabilityRequired(capability);
    }

    const explicit = await this.capabilities.explicitFor(membership.tenant.id, user.id);

    if (!effectiveCanApproveLoops(membership.roles, explicit)) {
      throw capabilityRequired(capability);
    }

    return true;
  }
}
