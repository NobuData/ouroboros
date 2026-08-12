/**
 * What a signed-in person is allowed to be told about themselves.
 *
 * One thing happens here and nowhere else: **`GET /api/v1/auth/me` is answered** — the
 * person, their memberships, and, for somebody brand new, the tenant their email domain
 * points at.
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
 * **And the session half has gone the same way.**
 * [#703](https://github.com/NobuData/ouroboros/issues/703) replaced the stateless cookie
 * with database-backed sessions and the library's own guard, so `authenticate` — the
 * guard's whole question — went with `SessionGuard`, and the `OURO_AUTH_DEV_USER`
 * development bypass went with it, because a bypass is a branch inside an authentication
 * decision and this service no longer makes one. Local work without a GitHub OAuth
 * application is [#705](https://github.com/NobuData/ouroboros/issues/705)'s email/password
 * sign-in, which replaces the bypass with a real credential rather than a way around one.
 * That interval is a deliberate cost, the same shape as the login button #702 left broken
 * until #718: the alternative is a second way to be signed in, kept alive beside the one
 * that is now real.
 *
 * What is left is one question — *who are you, and where do you belong* — and it is asked
 * of a session the guard has already resolved rather than of a cookie.
 */

import { Injectable } from "@nestjs/common";

import type { User } from "../db/schema";
import { AuthRepository } from "./auth.repository";
import {
  membershipResource,
  tenantSuggestionResource,
  userResource,
  type SessionResource,
  type TenantSuggestionResource,
} from "./auth.resources";

@Injectable()
export class AuthService {
  /**
   * @param repository - The statements.
   */
  constructor(private readonly repository: AuthRepository) {}

  /**
   * Everything `GET /api/v1/auth/me` answers.
   *
   * @param user - The signed-in person, from the session the global guard resolved — see
   *   `principal.ts`, which is where a BetterAuth session's user becomes this shape.
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
