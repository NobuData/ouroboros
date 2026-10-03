/**
 * The freeze: while a workspace is `pending_delete`, every surface of it answers with the
 * recovery screen's refusal (BR.5, [#489](https://github.com/NobuData/ouroboros/issues/489)).
 *
 * Registered as a global guard **after** the tenant guard (which establishes the membership this
 * reads) in `TenancyModule`. A route acting in no workspace — `@TenantOptional()`,
 * `@AllowAnonymous()`, the engine's internal routes — has no membership and is untouched, so a
 * person can still list their workspaces and switch away.
 *
 * ```
 * pending_delete ─▶ owner      ─▶ @LifecycleExempt() routes only (read state · restore)
 *                └▶ non-owner  ─▶ 403 workspace_pending_delete { restorable: false }
 * ```
 *
 * Deletion also revokes every non-owner session acting in the workspace, but a session cookie is
 * cached for up to five minutes (`SESSION_COOKIE_CACHE_SECONDS`); this guard is what makes the
 * freeze immediate regardless.
 */

import {
  Injectable,
  SetMetadata,
  type CanActivate,
  type CustomDecorator,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { currentMembership } from "../tenancy/tenant.context";
import { workspaceFrozen } from "./lifecycle.errors";
import { WorkspaceStateReader } from "./lifecycle.state";

/** Metadata key for {@link LifecycleExempt}. */
export const LIFECYCLE_EXEMPT = "ouroboros:lifecycle:exempt";

/**
 * `@LifecycleExempt()` — an owner may reach this route while the workspace is pending deletion.
 *
 * For the recovery screen's own routes only: reading the lifecycle state and restoring. A
 * non-owner is refused even here.
 *
 * @returns The decorator.
 */
export const LifecycleExempt = (): CustomDecorator => SetMetadata(LIFECYCLE_EXEMPT, true);

@Injectable()
export class WorkspaceFreezeGuard implements CanActivate {
  /**
   * @param reflector - How `@LifecycleExempt()` is read.
   * @param states - Where the workspace stands.
   */
  constructor(
    private readonly reflector: Reflector,
    private readonly states: WorkspaceStateReader,
  ) {}

  /**
   * Allow the request, or refuse it with the recovery screen's `403`.
   *
   * @param context - The execution context.
   * @returns `true` when the workspace is not pending deletion, when the request acts in no
   *   workspace, or when an owner reaches an exempt route.
   * @throws {ForbiddenError} `403 workspace_pending_delete` otherwise.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const membership = currentMembership();

    if (membership === undefined) {
      return true;
    }

    const standing = await this.states.standing(membership.tenant.id);

    if (standing.state !== "pending_delete") {
      return true;
    }

    const owner = membership.roles.includes("owner");
    const exempt =
      this.reflector.getAllAndOverride<boolean | undefined>(LIFECYCLE_EXEMPT, [
        context.getHandler(),
        context.getClass(),
      ]) === true;

    if (owner && exempt) {
      return true;
    }

    throw workspaceFrozen(standing.purgeAfter, owner);
  }
}
