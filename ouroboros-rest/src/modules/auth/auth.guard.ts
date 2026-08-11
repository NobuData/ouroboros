/**
 * The guard that makes this service authenticated by default.
 *
 * Registered globally in `auth.module.ts`, so it runs before every handler in the
 * application — the tenancy API included — and a route is reachable without a session only
 * when it says so with `@Public()`. `public.decorator.ts` is where that polarity is argued;
 * this file is where it is enforced.
 *
 * It does one thing per request: resolve the caller, or answer `401`. It decides nothing
 * about *what* that caller may do. Roles and the tenant a request is operating in are
 * [#32](https://github.com/NobuData/ouroboros/issues/32)'s `RolesGuard` and tenant context,
 * which run after this and can assume it: by the time they read the request, there is
 * somebody on it.
 */

import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { unauthenticated } from "./auth.errors";
import { AuthService } from "./auth.service";
import { attachPrincipal, type PrincipalRequest } from "./principal";
import { IS_PUBLIC } from "./public.decorator";

@Injectable()
export class SessionGuard implements CanActivate {
  /**
   * @param reflector - How `@Public()`'s metadata is read.
   * @param auth - Who resolves a cookie into a person.
   */
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  /**
   * Let a request through, or refuse it.
   *
   * @param context - The execution context. Read as HTTP; this service serves nothing else,
   *   and a guard that tried to cover a transport that does not exist would be untestable
   *   code guarding nothing.
   * @returns `true` when the route is public, or when a principal was established and
   *   attached to the request for `@CurrentUser()` to read.
   * @throws {UnauthenticatedError} `401` when the route needs a session and the request
   *   carries none this service will honour.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<PrincipalRequest>();
    const principal = await this.auth.authenticate(request.headers?.cookie);

    if (principal === undefined) {
      throw unauthenticated();
    }

    attachPrincipal(request, principal);

    return true;
  }

  /**
   * Is this route reachable without a session?
   *
   * @param context - The execution context.
   * @returns Whether `@Public()` is on the handler or on its controller. The handler is
   *   read first, so a public route inside a protected controller works — and, because the
   *   value is only ever `true`, so does the reverse reading: neither can turn the other
   *   off, which is the one asymmetry worth having in a decorator that removes
   *   authentication.
   */
  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}
