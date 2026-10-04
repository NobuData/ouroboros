/**
 * The global authentication guard: a session, or a service token
 * ([#485](https://github.com/NobuData/ouroboros/issues/485), BR.1).
 *
 * The library's `AuthGuard` answers one question — *is there a session?* — and refuses with `401`
 * when there is not. A service account has no session by design: it is a principal of its own,
 * authenticated by `ServiceTokenMiddleware` before any guard runs. So this guard is the library's,
 * with one door added **in front of it**, which is what "a token guard parallel to sessions"
 * means in practice:
 *
 *   * a request the middleware accepted a service token for proceeds without a session — the
 *     tenant guard is where its scopes are checked;
 *   * a request that presented a service token which did not authenticate is a `401`
 *     `service_token_invalid`, even if it also carries a cookie — a rotated token must stop
 *     working, not fall back to whoever's browser the bot runs in;
 *   * everything else is exactly the library's guard.
 *
 * Anonymous routes are left alone either way: a bad token on `/healthz` is not this guard's
 * business.
 */

import { Injectable, type ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "@thallesp/nestjs-better-auth";

import { ALLOW_ANONYMOUS } from "../modules/auth/anonymous";
import {
  servicePrincipalOf,
  serviceTokenRejected,
  type ServiceRequest,
} from "../modules/auth/service.principal";
import { serviceTokenInvalid } from "../modules/auth/service.scopes";

@Injectable()
export class SessionOrServiceGuard extends AuthGuard {
  /**
   * Admit a service principal, refuse a rejected service token, and otherwise defer to the
   * library's session check.
   *
   * @param context - The request.
   * @returns `true` when the request may proceed.
   * @throws {UnauthenticatedError} `service_token_invalid` for a refused service token.
   */
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() === "http") {
      const request = context.switchToHttp().getRequest<ServiceRequest>();

      if (servicePrincipalOf(request) !== undefined) return true;
      if (serviceTokenRejected(request) && !this.isAnonymous(context)) {
        throw serviceTokenInvalid();
      }
    }

    return super.canActivate(context);
  }

  /**
   * Whether the route is `@AllowAnonymous()`.
   *
   * @param context - The request.
   * @returns `true` for an anonymous route.
   */
  private isAnonymous(context: ExecutionContext): boolean {
    return (
      Reflect.getMetadata(ALLOW_ANONYMOUS, context.getHandler()) === true ||
      Reflect.getMetadata(ALLOW_ANONYMOUS, context.getClass()) === true
    );
  }
}
