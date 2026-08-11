/**
 * The two calls this service makes to GitHub, and the only place it makes them.
 *
 * Bare `fetch` rather than a client library, which is what the issue asks for and what the
 * size of the surface justifies: one form post to exchange a code, and one or two reads to
 * learn who the person is. Octokit would be a dependency, a token-refresh model and a
 * plugin system in exchange for two URLs.
 *
 * Three rules hold everywhere below:
 *
 *   * **Nothing GitHub says reaches a client.** Every failure becomes one of
 *     `auth.errors.ts`'s constants. GitHub's error bodies are written for a developer
 *     reading their own logs and have carried request identifiers and — in the token
 *     endpoint's case — echoed parameters; forwarding them would publish that as this
 *     API's contract.
 *   * **Every call is bounded.** `AbortSignal.timeout` on all of them, for the reason
 *     `src/modules/health/probe.ts` gives about probes: a request that can hang turns a
 *     slow dependency into a request that never answers, and this one is holding a browser
 *     mid-redirect while it waits.
 *   * **The access token lives as long as this function call.** It is not stored, not
 *     logged and not put in the session — `ouroboros.user_identities` holds no credential
 *     by construction, and `ouroboros-db/tests/constraints.sql` fails if a column that
 *     looks like one ever appears there. This service needs GitHub to say *who this is*,
 *     once; it does not act on the person's behalf.
 */

import { Injectable, Optional } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { githubUnavailable, emailUnavailable } from "./auth.errors";
import { GITHUB_API_URL, GITHUB_TOKEN_URL } from "./oauth";

/** How long any single call to GitHub may take, in milliseconds. */
export const GITHUB_TIMEOUT_MS = 10_000;

/** The API version this service pins, as GitHub's own header spells it. */
export const GITHUB_API_VERSION = "2022-11-28";

/** What `User-Agent` GitHub sees. Required by their API; identifying is the courtesy. */
export const GITHUB_USER_AGENT = "ouroboros-rest";

/** Who signed in, as much of it as `ouroboros.users` and `user_identities` hold. */
export interface GithubProfile {
  /** GitHub's immutable numeric account id, as a string. The identity's `external_id`. */
  externalId: string;
  /** The account's login at this moment. Renameable, so it is used for display only. */
  login: string;
  /** What to call them: their GitHub name, or their login when they have set none. */
  displayName: string;
  /** Their verified primary address, lower-cased. */
  email: string;
  /** Their avatar, or `null` when GitHub offers none. */
  avatarUrl: string | null;
}

/** The fields of `GET /user` this service reads. */
interface UserResponse {
  id?: unknown;
  login?: unknown;
  name?: unknown;
  email?: unknown;
  avatar_url?: unknown;
}

/** One entry of `GET /user/emails`. */
interface EmailResponse {
  email?: unknown;
  primary?: unknown;
  verified?: unknown;
}

/** The fields of the token endpoint's answer this service reads. */
interface TokenResponse {
  access_token?: unknown;
  error?: unknown;
}

/**
 * The GitHub side of sign-in.
 *
 * A provider rather than free functions so a test can replace the whole of GitHub with an
 * object, and so the client id and secret are injected rather than read — nothing outside
 * `src/modules/config/` names an environment variable
 * ([#28](https://github.com/NobuData/ouroboros/issues/28)).
 */
@Injectable()
export class GithubClient {
  /**
   * @param config - Typed configuration, for the OAuth application's credentials.
   * @param fetchImpl - How a request is made. Defaults to the runtime's `fetch`; the seam
   *   exists so the specs beside this file exercise the parsing and the failure mapping
   *   against responses they construct, rather than against github.com. `@Optional()`
   *   because Nest has no provider for a bare function type and would refuse to construct
   *   this: marked optional it supplies `undefined`, which is exactly what makes a default
   *   parameter apply — so the application gets the runtime's `fetch` and a spec gets
   *   whatever it passed to `new GithubClient(…)`.
   */
  constructor(
    private readonly config: AppConfigService,
    @Optional() private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Exchange an authorization code for an access token.
   *
   * @param code - The `code` GitHub put in the callback's query string.
   * @param verifier - The PKCE verifier from the handshake cookie.
   * @param redirectUri - The same `redirect_uri` the authorize request carried. GitHub
   *   compares them, and a mismatch is one of the ways this can fail.
   * @returns The access token, which the caller uses immediately and then drops.
   * @throws {UpstreamError} `github_unavailable` — GitHub refused, answered with something
   *   that is not a token, or did not answer inside {@link GITHUB_TIMEOUT_MS}. The real
   *   reason is deliberately not distinguished: every one of them means the same thing to
   *   the browser waiting on the redirect.
   */
  async exchangeCode(code: string, verifier: string, redirectUri: string): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.config.githubClientId,
      client_secret: this.config.githubClientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });

    const payload = await this.call<TokenResponse>(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        // Without this GitHub answers `application/x-www-form-urlencoded`, and a token
        // parsed out of a query string is a token one encoding bug away from being wrong.
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": GITHUB_USER_AGENT,
      },
      body,
    });

    // The token endpoint answers `200` with `{error: "bad_verification_code"}` rather than
    // a 4xx, so the status alone does not say whether this worked.
    if (typeof payload.access_token !== "string" || payload.access_token === "") {
      throw githubUnavailable();
    }

    return payload.access_token;
  }

  /**
   * Read who the token belongs to.
   *
   * Two calls rather than one, because `GET /user` returns `email` only when the account
   * has made one public — most have not — and an address is not optional here: it is how
   * V002 recognises a person who was invited to a tenant before they ever signed in. So
   * the address comes from `GET /user/emails`, which is what the `user:email` scope is
   * for, and the public one is the fallback rather than the source.
   *
   * @param accessToken - From {@link exchangeCode}.
   * @returns The profile, with the address lower-cased to match `ouroboros.users.email`'s
   *   storage rule.
   * @throws {UpstreamError} `github_unavailable` when either call fails, or
   *   `github_email_unavailable` when the account offers no verified address.
   */
  async readProfile(accessToken: string): Promise<GithubProfile> {
    const user = await this.call<UserResponse>(`${GITHUB_API_URL}/user`, {
      headers: this.authorized(accessToken),
    });

    if (typeof user.id !== "number" || typeof user.login !== "string" || user.login === "") {
      throw githubUnavailable();
    }

    const login = user.login;

    return {
      externalId: String(user.id),
      login,
      // A GitHub account may have no name set; the login is what their profile page shows
      // in that case, so it is what a member list should show too.
      displayName: typeof user.name === "string" && user.name !== "" ? user.name : login,
      email: await this.readPrimaryEmail(accessToken, user.email),
      avatarUrl:
        typeof user.avatar_url === "string" && user.avatar_url !== "" ? user.avatar_url : null,
    };
  }

  /**
   * The account's verified primary address.
   *
   * @param accessToken - From {@link exchangeCode}.
   * @param publicEmail - `GET /user`'s `email`, whatever it was. Used only when the list
   *   call offers nothing, and only when it is a string.
   * @returns The address, lower-cased.
   * @throws {UpstreamError} `github_email_unavailable` when no verified address is
   *   offered. Unverified addresses are never accepted: an address nobody proved control
   *   of is an address someone else may hold, and this one decides which `users` row —
   *   and so which tenant invitations — the person lands on.
   */
  private async readPrimaryEmail(accessToken: string, publicEmail: unknown): Promise<string> {
    const addresses = await this.call<EmailResponse[]>(`${GITHUB_API_URL}/user/emails`, {
      headers: this.authorized(accessToken),
    });

    const verified = Array.isArray(addresses)
      ? addresses.filter(
          (entry) =>
            typeof entry?.email === "string" && entry.email !== "" && entry.verified === true,
        )
      : [];

    const chosen = verified.find((entry) => entry.primary === true) ?? verified[0];

    if (chosen !== undefined) {
      return String(chosen.email).toLowerCase();
    }

    // The public address is a last resort rather than a preference: GitHub only exposes it
    // when the account has published one, and it is always one of the verified addresses
    // above — so reaching here means the list call answered with nothing usable.
    if (typeof publicEmail === "string" && publicEmail !== "") {
      return publicEmail.toLowerCase();
    }

    throw emailUnavailable();
  }

  /** The headers a call carrying a user's token needs. */
  private authorized(accessToken: string): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": GITHUB_USER_AGENT,
      "x-github-api-version": GITHUB_API_VERSION,
    };
  }

  /**
   * Make one call and parse its JSON.
   *
   * @param url - Where to call.
   * @param init - Method, headers and body. A deadline is added here rather than by each
   *   caller, so no call can be written without one.
   * @returns The parsed body, typed as the caller expects and *not* validated — every
   *   caller narrows the fields it reads, which is where a shape that is not what GitHub
   *   documents is caught.
   * @throws {UpstreamError} `github_unavailable` for a transport failure, a deadline, a
   *   non-2xx status or a body that is not JSON. One answer, because the browser waiting
   *   on the redirect can act on exactly one of them.
   */
  private async call<T>(url: string, init: RequestInit): Promise<T> {
    let response: Response;

    try {
      response = await this.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
      });
    } catch {
      throw githubUnavailable();
    }

    if (!response.ok) {
      throw githubUnavailable();
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw githubUnavailable();
    }
  }
}
