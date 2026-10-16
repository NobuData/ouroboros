/**
 * The global authentication guard: a session, or a service token
 * ([#485](https://github.com/NobuData/ouroboros/issues/485), BR.1) — and, since account approval,
 * a session whose account is approved.
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
 *
 * ## Account approval: one check **behind** the library's
 *
 * Once the library has resolved a session, a person whose account is not *effectively approved*
 * (`auth/account.approval.ts` — status `approved`, or an application administrator whatever is
 * stored) is refused with `403 account_pending_approval` or `403 account_denied`, in the standard
 * envelope. Open to them still:
 *
 *   * BetterAuth's own `/api/auth/*` (get-session, sign-out), which never reaches Nest's guards;
 *   * every `@AllowAnonymous()` route — sign-out through `POST /api/v1/auth/logout` among them;
 *   * every `@AllowHeldAccount()` route, of which there is one: `GET /api/v1/account/status`.
 *
 * Service principals are not people and are never held.
 *
 * **The cookie snapshot.** `session.user.accountStatus` usually comes from the five-minute
 * signed cookie cache (`session.options.ts`), not the database. When that snapshot says the
 * account is held — or says nothing, being older than V149 — the guard asks again with the cache
 * bypassed: one query, and only for a held person. That is what makes an approval take effect
 * on the person's very next request, along with the personal organization the approval stamped
 * onto their sessions. The other direction is not re-read: a denial reaches a browser holding a
 * fresh *approved* snapshot when that snapshot expires, within five minutes — the same bound a
 * revoked session already has, and the price of the cache's one-query-per-five-minutes promise.
 */

import { Inject, Injectable, type ExecutionContext } from "@nestjs/common";
import { AuthGuard, AuthService } from "@thallesp/nestjs-better-auth";

import { ALLOW_ANONYMOUS } from "../modules/auth/anonymous";
import { accountDenied, accountPendingApproval } from "../modules/auth/auth.errors";
import { ALLOW_HELD_ACCOUNT } from "../modules/auth/held.account";
import { SESSION_PROPERTY, type Principal } from "../modules/auth/principal";
import {
  servicePrincipalOf,
  serviceTokenRejected,
  type ServiceRequest,
} from "../modules/auth/service.principal";
import { serviceTokenInvalid } from "../modules/auth/service.scopes";
import { AppConfigService } from "../modules/config/config.service";
import { effectiveAccountStatus } from "./account.approval";
import type { Auth } from "./auth.factory";

/** The request, as far as this guard reads and rewrites it. */
interface GuardedRequest extends ServiceRequest {
  headers?: Record<string, string | string[] | undefined>;
  [SESSION_PROPERTY]?: Principal | null;
  user?: Principal["user"] | null;
}

@Injectable()
export class SessionOrServiceGuard extends AuthGuard {
  /**
   * The configuration, for `OURO_APP_ADMIN_EMAILS`. Property-injected: the library's guard owns
   * the constructor, and its options token is not exported to restate.
   */
  @Inject(AppConfigService)
  appConfig!: Pick<AppConfigService, "appAdminEmails">;

  /** The library's service, for the cache-bypassing re-read of a held person's session. */
  @Inject(AuthService)
  betterAuth!: Pick<AuthService<Auth>, "api">;

  /**
   * Admit a service principal, refuse a rejected service token, defer to the library's session
   * check, then refuse a held account outside its allow-list.
   *
   * @param context - The request.
   * @returns `true` when the request may proceed.
   * @throws {UnauthenticatedError} `service_token_invalid` for a refused service token.
   * @throws {ForbiddenError} `account_pending_approval` / `account_denied` for a held account.
   */
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return super.canActivate(context);

    const request = context.switchToHttp().getRequest<GuardedRequest>();

    if (servicePrincipalOf(request) !== undefined) return true;
    if (serviceTokenRejected(request) && !this.hasMetadata(context, ALLOW_ANONYMOUS)) {
      throw serviceTokenInvalid();
    }

    const admitted = await super.canActivate(context);

    if (this.hasMetadata(context, ALLOW_ANONYMOUS)) return admitted;

    await this.checkAccountStatus(context, request);

    return admitted;
  }

  /**
   * Refuse a held account, after re-reading a snapshot that says it is held.
   *
   * @param context - The request, for the route's metadata.
   * @param request - Its session, replaced when the re-read finds a newer one.
   * @throws {ForbiddenError} `account_pending_approval` or `account_denied`.
   */
  private async checkAccountStatus(
    context: ExecutionContext,
    request: GuardedRequest,
  ): Promise<void> {
    const principal = request[SESSION_PROPERTY];

    // No session on a route the library let through without one — `@OptionalAuth()`. Nobody to
    // hold.
    if (principal === null || principal === undefined) return;

    const admins = this.appConfig?.appAdminEmails ?? [];
    let status = effectiveAccountStatus(principal.user, admins);

    if (status !== "approved") {
      const fresh = await this.reread(request);

      if (fresh !== null) {
        request[SESSION_PROPERTY] = fresh;
        request.user = fresh.user;
        status = effectiveAccountStatus(fresh.user, admins);
      }
    }

    if (status === "approved" || this.hasMetadata(context, ALLOW_HELD_ACCOUNT)) return;

    throw status === "denied" ? accountDenied() : accountPendingApproval();
  }

  /**
   * The session again, from the database rather than the cookie snapshot.
   *
   * @param request - The request, for its cookies.
   * @returns The fresh session, or `null` when there is none (or no library to ask).
   */
  private async reread(request: GuardedRequest): Promise<Principal | null> {
    if (this.betterAuth === undefined) return null;

    const headers = new Headers();

    for (const [name, value] of Object.entries(request.headers ?? {})) {
      if (typeof value === "string") headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(", "));
    }

    const fresh = (await this.betterAuth.api.getSession({
      headers,
      query: { disableCookieCache: true },
    })) as Principal | null;

    return fresh ?? null;
  }

  /**
   * Whether the route carries a boolean metadata flag, handler first.
   *
   * @param context - The request.
   * @param key - The metadata key.
   * @returns `true` when the handler or its class sets it.
   */
  private hasMetadata(context: ExecutionContext, key: string): boolean {
    return (
      Reflect.getMetadata(key, context.getHandler()) === true ||
      Reflect.getMetadata(key, context.getClass()) === true
    );
  }
}
