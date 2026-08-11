/**
 * The GitHub authorization handshake: what is sent to github.com, and what is remembered
 * while the browser is there.
 *
 * The flow is OAuth 2.0's authorization code grant, and the only interesting part of it is
 * what happens between the two requests. This service sends the browser away with a
 * `state`; the browser comes back with a `code` and a `state`; and the whole security of
 * the second request rests on being able to say *this is the same browser I sent, coming
 * back from the trip I started*. That is what {@link HANDSHAKE_COOKIE} is:
 *
 *   * **`state` defeats CSRF.** Without it, an attacker who has obtained a `code` for
 *     their own GitHub account can hand a victim's browser a crafted callback URL and log
 *     that browser into the attacker's account, which then quietly collects whatever the
 *     victim does next. The state this service sent is stored in a signed, `HttpOnly`
 *     cookie and compared with the one that comes back — an attacker can put anything in
 *     the query string and cannot put anything in that cookie.
 *   * **PKCE binds the code to this handshake.** The verifier never leaves the cookie, and
 *     its SHA-256 goes to GitHub in the redirect; the exchange presents the verifier, so a
 *     `code` intercepted in transit is worth nothing without the cookie that started the
 *     flow. GitHub's OAuth application endpoints accept the parameters and this service
 *     does not depend on them being *enforced* there — the check it enforces itself is the
 *     one above, and PKCE is sent because it costs one hash and is the difference between
 *     a stolen code being useless and being a session on every provider that does honour
 *     it.
 *
 * There is deliberately no `return_to` in the handshake. A parameter naming where to land
 * after sign-in is an open redirect the moment its validation is imperfect, and the
 * product has one place to land: `OURO_UI_URL`. When a deep link after sign-in is wanted,
 * it belongs in the UI's own state rather than in a URL this service will bounce a browser
 * to.
 */

import { createHash, randomBytes } from "node:crypto";

import type { CookieAttributes } from "./cookies";
import { epochSeconds, readToken, signToken, type Issued, type TokenTerms } from "./signing";

/** Where a browser is sent to authorize. */
export const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

/** Where a code is exchanged for a token. Server-to-server; a browser never sees it. */
export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

/** The REST API this service reads a profile from. */
export const GITHUB_API_URL = "https://api.github.com";

/**
 * What this service asks GitHub for.
 *
 * `read:user` and `user:email` and nothing else. Sign-in needs a stable account id, a name
 * to render and a verified address to recognise the person by — the three things
 * `ouroboros.users` holds — and every additional scope is something a person is asked to
 * grant on the consent screen and something this service would then be trusted not to
 * misuse. Repository access is a separate grant belonging to the GitHub App installation
 * flow ([#22](https://github.com/NobuData/ouroboros/issues/22)'s enablement), not to
 * sign-in.
 */
export const GITHUB_SCOPES = ["read:user", "user:email"] as const;

/** The route the callback is served on, relative to the API base path. */
export const CALLBACK_ROUTE = "/auth/github/callback";

/** The handshake cookie's name. */
export const HANDSHAKE_COOKIE = "ouro_oauth";

/**
 * The path the handshake cookie is sent for.
 *
 * Narrower than the session's `/`: it is only ever read by the callback, so scoping it to
 * the auth routes keeps it off every other request a browser makes to this service.
 */
export const HANDSHAKE_COOKIE_PATH = "/api/v1/auth";

/**
 * How long a browser has to complete the trip to GitHub, in seconds.
 *
 * Ten minutes is long enough for a person to read a consent screen, sign in to GitHub and
 * take a phone call; short enough that an abandoned handshake is not a credential sitting
 * in a browser for a day. It also bounds replay of the callback URL, which is the other
 * thing this cookie's age is doing.
 */
export const HANDSHAKE_MAX_AGE_SECONDS = 10 * 60;

/** How many random bytes the state and the verifier are each made of. */
export const HANDSHAKE_ENTROPY_BYTES = 32;

/** What the handshake cookie carries. */
export interface HandshakePayload extends Issued {
  /** The opaque value echoed back by GitHub in the callback's query string. */
  state: string;
  /** The PKCE code verifier. Never leaves this service except to the token endpoint. */
  verifier: string;
}

/**
 * Is this decoded payload a handshake?
 *
 * @param payload - A payload whose signature and `iat` have already been checked.
 * @returns Whether it carries both non-empty fields — which is what stops a session cookie
 *   being replayed into the callback.
 */
export function isHandshakePayload(payload: Issued): payload is HandshakePayload {
  const candidate = payload as HandshakePayload;

  return (
    typeof candidate.state === "string" &&
    candidate.state !== "" &&
    typeof candidate.verifier === "string" &&
    candidate.verifier !== ""
  );
}

/**
 * A random, URL-safe value.
 *
 * @param bytes - How much entropy. Defaults to {@link HANDSHAKE_ENTROPY_BYTES}.
 * @returns base64url of `bytes` cryptographically random bytes. `randomBytes`, not
 *   `Math.random()`: this value is the whole of what an attacker must not guess.
 */
export function randomHandshakeValue(bytes: number = HANDSHAKE_ENTROPY_BYTES): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * The PKCE challenge for a verifier.
 *
 * @param verifier - The random value kept in the handshake cookie.
 * @returns Its SHA-256, base64url — the `S256` method. The plain method, which sends the
 *   verifier itself, is not implemented and should not be: it protects against nothing
 *   that matters, since anyone who can read the redirect can read the verifier in it.
 */
export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Everything {@link authorizeUrl} needs. */
export interface AuthorizeRequest {
  /** `OURO_GITHUB_CLIENT_ID`. */
  clientId: string;
  /** Where GitHub sends the browser back to — see {@link callbackUrl}. */
  redirectUri: string;
  /** The opaque anti-CSRF value, from {@link randomHandshakeValue}. */
  state: string;
  /** The PKCE challenge, from {@link codeChallenge}. */
  challenge: string;
}

/**
 * Where to send the browser.
 *
 * @param request - See {@link AuthorizeRequest}.
 * @returns The absolute `github.com` URL, with every parameter encoded by `URL` rather
 *   than by string concatenation — the redirect URI carries a `://` and a path, and a
 *   handshake value carries base64url's `-` and `_`.
 */
export function authorizeUrl(request: AuthorizeRequest): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);

  url.searchParams.set("client_id", request.clientId);
  url.searchParams.set("redirect_uri", request.redirectUri);
  url.searchParams.set("scope", GITHUB_SCOPES.join(" "));
  url.searchParams.set("state", request.state);
  url.searchParams.set("code_challenge", request.challenge);
  url.searchParams.set("code_challenge_method", "S256");

  // Nothing else. GitHub offers `login` and `allow_signup` too, and neither is set on
  // purpose: pinning `login` would fight a person who holds two accounts, and refusing
  // `allow_signup` would turn "I do not have a GitHub account yet" into a dead end on a
  // consent screen rather than a link.
  return url.toString();
}

/**
 * The absolute callback URL, as GitHub has it registered.
 *
 * @param restUrl - `OURO_REST_URL`, this service's own browser origin.
 * @param basePath - The API base path, `/api/v1`. Passed in rather than imported, because
 *   `src/application.ts` is what decides it and a second copy here could disagree.
 * @returns The URL to send as `redirect_uri` and to register against the OAuth
 *   application. Built from configuration rather than from the request's `Host` header,
 *   which an attacker controls: a callback URL taken from a header is how an
 *   authorization code ends up delivered somewhere else.
 */
export function callbackUrl(restUrl: string, basePath: string): string {
  return new URL(`${basePath}${CALLBACK_ROUTE}`, restUrl).toString();
}

/**
 * Sign a handshake into a cookie value.
 *
 * @param payload - The state and verifier for this trip.
 * @param secret - `OURO_SESSION_SECRET`.
 * @param now - When the handshake started.
 * @returns The token to put in {@link HANDSHAKE_COOKIE}.
 */
export function issueHandshake(
  payload: Omit<HandshakePayload, "iat">,
  secret: string,
  now: Date,
): string {
  return signToken({ ...payload, iat: epochSeconds(now) } satisfies HandshakePayload, secret);
}

/**
 * Read a handshake cookie.
 *
 * @param token - The cookie's value, or `undefined` when it was not sent — which is what a
 *   callback fabricated by somebody else looks like.
 * @param terms - The secret and the instant to age it against. `maxAgeSeconds` defaults to
 *   {@link HANDSHAKE_MAX_AGE_SECONDS}.
 * @returns The payload, or `undefined`.
 */
export function readHandshake(
  token: string | undefined,
  terms: Omit<TokenTerms, "maxAgeSeconds"> & Partial<Pick<TokenTerms, "maxAgeSeconds">>,
): HandshakePayload | undefined {
  return readToken(
    token,
    { maxAgeSeconds: HANDSHAKE_MAX_AGE_SECONDS, ...terms },
    isHandshakePayload,
  );
}

/**
 * The attributes the handshake cookie is set with.
 *
 * `SameSite=Lax` is load-bearing rather than conventional here: the callback arrives as a
 * top-level navigation *from github.com*, so a `Strict` cookie would not be sent and every
 * sign-in would fail its state check. See `session.ts` for the rest of the reasoning,
 * which is the same.
 *
 * @param isProduction - Whether this is a production deployment.
 * @param maxAgeSeconds - Lifetime. Defaults to {@link HANDSHAKE_MAX_AGE_SECONDS}.
 * @returns The attributes for `serializeCookie`.
 */
export function handshakeCookieAttributes(
  isProduction: boolean,
  maxAgeSeconds: number = HANDSHAKE_MAX_AGE_SECONDS,
): CookieAttributes {
  return {
    maxAgeSeconds,
    path: HANDSHAKE_COOKIE_PATH,
    httpOnly: true,
    secure: isProduction,
    sameSite: "Lax",
  };
}
