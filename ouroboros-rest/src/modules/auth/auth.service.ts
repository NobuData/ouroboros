/**
 * Sign-in, as rules rather than as routes.
 *
 * The controller knows about redirects and cookies; this knows what a sign-in *is*. Three
 * things happen here and nowhere else:
 *
 *   * **The handshake is started and finished.** A random state and PKCE verifier go into
 *     a signed cookie, the browser goes to GitHub, and the callback is only honoured when
 *     the state it carries is the state that cookie holds — see `oauth.ts` for why that
 *     comparison is the CSRF defence.
 *   * **A GitHub account becomes a person.** {@link AuthService.resolveUser} is the whole
 *     of the identity model, and its three branches are the three ways somebody can arrive.
 *   * **A session is issued and read.** Signing is `session.ts`; deciding *whose* session,
 *     and refusing one whose user has since been deleted, is here.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import type { Transaction } from "kysely";

import { AppConfigService } from "../config/config.service";
import { DatabaseService } from "../db/db.service";
import type { Database, User } from "../db/schema";
import { handshakeInvalid } from "./auth.errors";
import { AuthRepository, GITHUB_PROVIDER } from "./auth.repository";
import {
  membershipResource,
  tenantSuggestionResource,
  userResource,
  type SessionResource,
  type TenantSuggestionResource,
} from "./auth.resources";
import { parseCookies } from "./cookies";
import { GithubClient, type GithubProfile } from "./github";
import {
  authorizeUrl,
  codeChallenge,
  issueHandshake,
  randomHandshakeValue,
  readHandshake,
} from "./oauth";
import type { Principal } from "./principal";
import { issueSession, readSession, SESSION_COOKIE } from "./session";

/** What a started handshake needs the controller to send. */
export interface StartedHandshake {
  /** The `github.com` URL to redirect the browser to. */
  authorizeUrl: string;
  /** The signed value for the handshake cookie. */
  handshake: string;
}

@Injectable()
export class AuthService {
  /** Where the development bypass announces itself. Named per Nest's convention. */
  private readonly logger = new Logger(AuthService.name);

  /**
   * @param config - Typed configuration: the OAuth client id, the signing secret, this
   *   service's own origin, and the development bypass.
   * @param database - For the one operation here that must be all-or-nothing; see
   *   {@link resolveUser}.
   * @param repository - The statements.
   * @param github - The two calls to GitHub.
   * @param clock - What "now" means. A parameter rather than a call to `new Date()`, so
   *   that every expiry rule in this module is testable without a fake timer library.
   *   `@Optional()` for the reason `GithubClient`'s `fetchImpl` is: Nest has no provider
   *   for a bare function type, supplies `undefined` when told the parameter is optional,
   *   and `undefined` is what makes a default parameter apply.
   */
  constructor(
    private readonly config: AppConfigService,
    private readonly database: DatabaseService,
    private readonly repository: AuthRepository,
    private readonly github: GithubClient,
    @Optional() private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Begin a sign-in.
   *
   * @param callbackUri - Where GitHub should send the browser back to, absolute. Passed in
   *   by the controller, which is what knows the API's base path.
   * @returns Where to send the browser, and the handshake to remember while it is away.
   */
  startSignIn(callbackUri: string): StartedHandshake {
    const state = randomHandshakeValue();
    const verifier = randomHandshakeValue();

    return {
      authorizeUrl: authorizeUrl({
        clientId: this.config.githubClientId,
        redirectUri: callbackUri,
        state,
        challenge: codeChallenge(verifier),
      }),
      handshake: issueHandshake({ state, verifier }, this.config.sessionSecret, this.clock()),
    };
  }

  /**
   * Finish a sign-in: verify the handshake, exchange the code, and issue a session.
   *
   * @param code - The `code` GitHub put in the callback's query string.
   * @param state - The `state` it echoed back.
   * @param handshakeToken - The handshake cookie's value, or `undefined` when the browser
   *   sent none.
   * @param callbackUri - The same `redirect_uri` the authorize request carried.
   * @returns The session token to set as a cookie.
   * @throws {UnauthenticatedError} `oauth_handshake_invalid` when the cookie is missing,
   *   expired, forged, or carries a different state than the query string. All four are
   *   one answer on purpose — see `auth.errors.ts`.
   * @throws {UpstreamError} When GitHub refuses the exchange or offers no verified address.
   */
  async completeSignIn(
    code: string,
    state: string,
    handshakeToken: string | undefined,
    callbackUri: string,
  ): Promise<string> {
    const handshake = readHandshake(handshakeToken, {
      secret: this.config.sessionSecret,
      now: this.clock(),
    });

    // Compared before anything is spent on GitHub: a callback that did not come from a
    // handshake this service started should cost one string comparison, not a round trip.
    if (handshake === undefined || handshake.state !== state) {
      throw handshakeInvalid();
    }

    const accessToken = await this.github.exchangeCode(code, handshake.verifier, callbackUri);
    const profile = await this.github.readProfile(accessToken);
    const user = await this.resolveUser(profile);

    return issueSession(user.id, this.config.sessionSecret, this.clock());
  }

  /**
   * Turn a GitHub profile into the person it belongs to, creating them if this is the
   * first time.
   *
   * The three branches are the three ways somebody arrives, and the middle one is the one
   * worth reading twice:
   *
   *   1. **The identity is known.** They have signed in before. The same `users` row is
   *      returned — which is the issue's third acceptance criterion — and their name and
   *      avatar are refreshed from GitHub.
   *   2. **The identity is new and the address is known.** Somebody invited them to a
   *      tenant before they ever signed in, and `MembersRepository.createUser` made a stub
   *      row for the invitation to point at ([#31](https://github.com/NobuData/ouroboros/issues/31)).
   *      This is where that stub becomes a real person: the identity is attached to the
   *      existing row, so they arrive already holding the membership they were invited to
   *      rather than as a stranger with an empty product and a duplicate account.
   *   3. **Neither is known.** A new person; a new row, and the identity beside it.
   *
   * All of it inside one transaction. Branches 2 and 3 each write two tables, and a
   * process that died between them would leave a `users` row nobody can sign in as —
   * reachable only by the address, which nothing in this flow looks up second.
   *
   * @param profile - Who GitHub says this is.
   * @returns The person, as `ouroboros.users` now holds them.
   */
  async resolveUser(profile: GithubProfile): Promise<User> {
    return this.database.transaction(async (trx: Transaction<Database>) => {
      const known = await this.repository.findUserByIdentity(
        GITHUB_PROVIDER,
        profile.externalId,
        trx,
      );

      if (known !== undefined) {
        return this.repository.refreshProfile(
          known.id,
          profile.displayName,
          profile.avatarUrl,
          trx,
        );
      }

      const invited = await this.repository.findUserByEmail(profile.email, trx);

      if (invited !== undefined) {
        await this.repository.linkIdentity(invited.id, GITHUB_PROVIDER, profile.externalId, trx);
        return this.repository.refreshProfile(
          invited.id,
          profile.displayName,
          profile.avatarUrl,
          trx,
        );
      }

      const created = await this.repository.createUser(
        {
          email: profile.email,
          display_name: profile.displayName,
          avatar_url: profile.avatarUrl,
        },
        trx,
      );

      await this.repository.linkIdentity(created.id, GITHUB_PROVIDER, profile.externalId, trx);

      return created;
    });
  }

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
