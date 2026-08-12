/**
 * Where BetterAuth answers, written down.
 *
 * [#701](https://github.com/NobuData/ouroboros/issues/701) asks for the route map as a
 * deliverable rather than as a comment, because two other things have to agree with it:
 * [#711](https://github.com/NobuData/ouroboros/issues/711) publishes these paths, and
 * `ouroboros-ui`'s BetterAuth client calls them. A map that lives only in prose is one
 * nothing can be checked against.
 *
 * The library serves them itself — they are **not** Nest controllers, and that is what
 * every claim below rests on. `@thallesp/nestjs-better-auth` registers one handler on the
 * HTTP adapter, ahead of Nest's router, so these paths never reach the routing table that
 * `/api/v1` and URI versioning are applied to. {@link AUTH_PREFIX_EXCLUSIONS} says the
 * same thing to Nest a second time, out loud, and `src/application.ts` explains why the
 * belt is worn with the braces.
 *
 * @see auth.options.ts — `AUTH_BASE_PATH`, the prefix every path here is built from.
 * @see auth.module.ts — the mounting itself.
 */

import { AUTH_BASE_PATH } from "./auth.options";
import { GITHUB_PROVIDER_ID } from "./github.provider";

/**
 * Where GitHub returns the browser, as an absolute path.
 *
 * **This is the URL an OAuth App is registered against**, prefixed with the origin —
 * `${BETTER_AUTH_URL}/api/auth/callback/github`. It is exported because three places have to
 * agree on it and only one of them is code: github.com's own application settings for
 * development and for production, `ouroboros-rest/README.md` § Signing in, and this. GitHub
 * compares what it was registered with against what the exchange presents, and a difference
 * of one character is a sign-in that fails at the last hop with a message about the redirect
 * URI.
 *
 * Composed from the provider id rather than written out, so the callback and the
 * `account.providerId` value can never disagree — see `github.provider.ts`.
 */
export const GITHUB_CALLBACK_PATH = `${AUTH_BASE_PATH}/callback/${GITHUB_PROVIDER_ID}`;

/** One route BetterAuth serves. */
export interface AuthRoute {
  /**
   * The verbs it answers to.
   *
   * More than one where the library accepts more than one: `get-session` is a `GET` for a
   * browser and a `POST` for a client that would rather not put anything in a URL, and the
   * OAuth callback is whichever the provider redirects with.
   */
  readonly methods: readonly ("GET" | "POST")[];
  /** The path, from the origin root, exactly as a client writes it. */
  readonly path: string;
  /** What it is for. */
  readonly purpose: string;
}

/**
 * The routes this service's BetterAuth instance serves today.
 *
 * The four the issue names — sign-in, callback, sign-out, session — plus the two the
 * library serves with nothing configured at all, which are the two a mount can be checked
 * with. They are transcribed from a real instance built by `betterAuth()` rather than from
 * documentation; `auth.routes.spec.ts` holds them to the shape the library uses.
 *
 * **Not the whole surface.** BetterAuth also exposes email/password, account linking and
 * session-management endpoints, and this service answers on them the moment the options
 * that back them are set: [#703](https://github.com/NobuData/ouroboros/issues/703) is the
 * session strategy, [#705](https://github.com/NobuData/ouroboros/issues/705)
 * email/password. Each of those issues adds its own rows here, which is what keeps this
 * list a record of what the service *does* rather than of what the library *could*.
 * [#702](https://github.com/NobuData/ouroboros/issues/702) added the GitHub rows below, and
 * with them the four routes that make a sign-in reachable — which is also the four routes
 * `/api/v1/auth/github` and `/api/v1/auth/github/callback` were removed in favour of.
 */
export const AUTH_ROUTES: readonly AuthRoute[] = [
  {
    methods: ["POST"],
    path: `${AUTH_BASE_PATH}/sign-in/social`,
    purpose:
      "Begin a social sign-in. `{ provider: 'github' }` is the whole body; the answer " +
      "carries the github.com authorization URL for the browser to follow (#702). It is a " +
      "POST answering with a URL rather than a redirect, so a script can decide what to do " +
      "with it — which is why `ouroboros-ui` calls `signIn.social` rather than linking.",
  },
  {
    methods: ["GET", "POST"],
    path: `${AUTH_BASE_PATH}/callback/:id`,
    purpose:
      "Where the provider redirects back to. `:id` is the provider's name, so GitHub's " +
      `OAuth App is registered against \`${GITHUB_CALLBACK_PATH}\` — see ` +
      "`GITHUB_CALLBACK_PATH`, which is that path composed rather than typed twice (#702).",
  },
  {
    methods: ["GET", "POST"],
    path: `${AUTH_BASE_PATH}/get-session`,
    purpose: "The caller's session, or null. What the login screen reads on load (#703).",
  },
  {
    methods: ["POST"],
    path: `${AUTH_BASE_PATH}/sign-out`,
    purpose: "End the session and clear its cookie (#703).",
  },
  {
    methods: ["GET"],
    path: `${AUTH_BASE_PATH}/ok`,
    purpose:
      "The library answering for itself — `{ ok: true }`, no database, no session. It is " +
      "what proves the handler is mounted, and it is not a health probe: it says nothing " +
      "about this service's dependencies, so `/health/ready` stays the only readiness.",
  },
  {
    methods: ["GET"],
    path: `${AUTH_BASE_PATH}/error`,
    purpose: "Where a failed flow is redirected, with the reason in the query string.",
  },
];

/**
 * The paths `src/application.ts` keeps out of the `/api/v1` global prefix.
 *
 * Two entries because Nest matches an exclusion as a path pattern rather than as a prefix:
 * the base path itself, and everything under it. `*path` is path-to-regexp's named
 * wildcard, which is the spelling Nest 11 and the library's own exclusion both use.
 *
 * It has to be stated here rather than left to the library, and the reason is ordering.
 * `@thallesp/nestjs-better-auth` adds exactly these two to the global prefix options from
 * its constructor — during `NestFactory.create` — and `configureApplication` then calls
 * `setGlobalPrefix`, which *replaces* the exclusion list rather than adding to it. The
 * library's contribution is overwritten a moment after it is made, so this is the copy
 * that survives.
 */
export const AUTH_PREFIX_EXCLUSIONS: readonly string[] = [
  AUTH_BASE_PATH,
  `${AUTH_BASE_PATH}/*path`,
];
