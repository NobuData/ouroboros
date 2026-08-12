/**
 * Who a request is from, and what a signed-in person is allowed to be told about
 * themselves.
 *
 * Two things happen here and nowhere else:
 *
 *   * **A session is read.** Verifying is `session.ts`; deciding *whose* session, and
 *     refusing one whose user has since been deleted, is here.
 *   * **`GET /api/v1/auth/me` is answered** — the person, their memberships, and, for
 *     somebody brand new, the tenant their email domain points at.
 *
 * **Sign-in used to be here too, and is not any more.**
 * [#702](https://github.com/NobuData/ouroboros/issues/702) replaced #33's hand-rolled
 * GitHub flow with BetterAuth's, so `startSignIn`, `completeSignIn` and `resolveUser` —
 * the three-branch identity model that wrote `users` and `user_identities` — are gone along
 * with `oauth.ts` and `github.ts`. What became of each branch is worth knowing, because
 * none of them was dropped:
 *
 *   1. *The identity is known* is now BetterAuth's `findOAuthUser`, which looks the arriving
 *      account up by `account(providerId, accountId)` — the pair #706's back-fill copied
 *      `user_identities` into, which is what makes a person who first signed in under #33
 *      resolve to the same row.
 *   2. *The identity is new and the address is known* — the invited stub — is the library's
 *      account linking, configured in `src/auth/github.provider.ts`, where the argument for
 *      each setting is written out.
 *   3. *Neither is known* is its `createOAuthUser`.
 *
 * What is left here is the **session half**, and it is on borrowed time as well:
 * [#703](https://github.com/NobuData/ouroboros/issues/703) replaces the stateless cookie
 * with database-backed sessions and the library's own guard, and takes
 * {@link AuthService.authenticate} and the development bypass with it. Until it lands this
 * service signs people in with BetterAuth and remembers them with #33's cookie — a seam
 * both issues name, and the reason they are meant to land close together.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import type { User } from "../db/schema";
import { AuthRepository } from "./auth.repository";
import {
  membershipResource,
  tenantSuggestionResource,
  userResource,
  type SessionResource,
  type TenantSuggestionResource,
} from "./auth.resources";
import { parseCookies } from "./cookies";
import type { Principal } from "./principal";
import { readSession, SESSION_COOKIE } from "./session";

@Injectable()
export class AuthService {
  /** Where the development bypass announces itself. Named per Nest's convention. */
  private readonly logger = new Logger(AuthService.name);

  /**
   * @param config - Typed configuration: the signing secret and the development bypass.
   * @param repository - The statements.
   * @param clock - What "now" means. A parameter rather than a call to `new Date()`, so
   *   that every expiry rule in this module is testable without a fake timer library.
   *   `@Optional()` because Nest has no provider for a bare function type: marked optional
   *   it supplies `undefined`, which is exactly what makes a default parameter apply.
   */
  constructor(
    private readonly config: AppConfigService,
    private readonly repository: AuthRepository,
    @Optional() private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Who a request is from, if anybody.
   *
   * The guard's whole question. Two ways to answer it, in this order:
   *
   *   1. **A session cookie**, verified and then *read from the database*. The row is what
   *      makes the answer current: a person deleted five minutes ago is holding a cookie
   *      whose signature is still perfectly good, and this is where that stops being
   *      access. It costs one primary-key lookup per request.
   *   2. **The development bypass**, when `OURO_AUTH_DEV_USER` names an address and this is
   *      not production. Second rather than first, deliberately: with the bypass
   *      configured, a real sign-in still wins, so a developer can exercise the actual
   *      OAuth flow on a machine that has the bypass set.
   *
   * @param cookieHeader - The request's `Cookie` header, or `undefined`.
   * @returns The principal, or `undefined` when this request is not signed in.
   */
  async authenticate(cookieHeader: string | undefined): Promise<Principal | undefined> {
    const user = await this.userFromSession(cookieHeader);

    return user === undefined ? this.developmentPrincipal() : { user };
  }

  /**
   * The person a session cookie names, if it names a live one.
   *
   * @param cookieHeader - The request's `Cookie` header, or `undefined`.
   * @returns The user, or `undefined` for every way a session can fail to be one.
   */
  private async userFromSession(cookieHeader: string | undefined): Promise<User | undefined> {
    const session = readSession(sessionTokenFrom(cookieHeader), {
      secret: this.config.sessionSecret,
      now: this.clock(),
    });

    return session === undefined ? undefined : this.repository.findUserById(session.sub);
  }

  /**
   * The principal the development bypass grants, if it grants one.
   *
   * `AppConfigService.devUserEmail` is `null` in production whatever the environment said,
   * and `loadConfiguration` has already dropped the variable there — two checks, because
   * one of them being wrong is authentication turned off for a deployment.
   *
   * The address must name a real `users` row. An unknown address grants nothing rather
   * than inventing a person: a bypass that created accounts would be a bypass that wrote
   * to the database, and the row it wrote would outlive the machine it was convenient on.
   * The development seed ([#23](https://github.com/NobuData/ouroboros/issues/23)) creates
   * the addresses `.env.example` suggests.
   *
   * @returns The principal, or `undefined` when the bypass is off or names nobody.
   */
  private async developmentPrincipal(): Promise<Principal | undefined> {
    const email = this.config.devUserEmail;

    if (email === null) {
      return undefined;
    }

    const user = await this.repository.findUserByEmail(email.toLowerCase());

    if (user === undefined) {
      this.logger.warn(
        `OURO_AUTH_DEV_USER names an address no user has (${email}); requests stay unauthenticated`,
      );
      return undefined;
    }

    return { user };
  }

  /**
   * Everything `GET /api/v1/auth/me` answers.
   *
   * @param user - The signed-in person, from the guard.
   * @returns Them, their memberships, and — only when they have none — the tenant their
   *   email domain points at.
   */
  async describe(user: User): Promise<SessionResource> {
    const memberships = await this.repository.listMemberships(user.id);

    return {
      user: userResource(user),
      memberships: memberships.map(membershipResource),
      tenantSuggestion: memberships.length > 0 ? null : await this.suggestTenant(user.email),
    };
  }

  /**
   * The tenant an address's domain resolves to, if any.
   *
   * @param email - The person's address, as stored — already lower-cased by V002's rule.
   * @returns The suggestion, or `null`. An address with no `@`, or nothing after it, is
   *   `null` rather than a lookup of the empty string: `tenant_domains.domain` is
   *   non-blank, so the query could not match, and asking anyway would be a round trip that
   *   cannot succeed.
   */
  private async suggestTenant(email: string): Promise<TenantSuggestionResource | null> {
    const domain = email.slice(email.lastIndexOf("@") + 1);

    if (domain === "" || domain === email) {
      return null;
    }

    const tenant = await this.repository.findTenantByDomain(domain);

    return tenant === undefined ? null : tenantSuggestionResource(tenant);
  }
}

/**
 * The session token out of a `Cookie` header.
 *
 * A free function rather than a method because it is pure — which is what lets the spec
 * beside this file check the header parsing without building a service.
 *
 * @param cookieHeader - The header, or `undefined`.
 * @returns The value of the session cookie, or `undefined` when it is not there.
 */
export function sessionTokenFrom(cookieHeader: string | undefined): string | undefined {
  return parseCookies(cookieHeader).get(SESSION_COOKIE);
}
