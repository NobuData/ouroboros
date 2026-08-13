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
 * That same fact is why this file is the *only* thing `openapi.yaml`'s auth section can be
 * checked against. Every other path in the document is compared with the route table Nest
 * built, and these paths are not in it — so `src/openapi/openapi.spec.ts` compares the
 * document with this map instead, through {@link openApiPath}.
 *
 * @see auth.options.ts — `AUTH_BASE_PATH`, the prefix every path here is built from.
 * @see auth.module.ts — the mounting itself.
 * @see ../openapi/openapi.spec.ts — where this map and the published document are held
 *   to each other.
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
 * that back them are set — [#705](https://github.com/NobuData/ouroboros/issues/705) is
 * email/password, and it adds its own rows here. That is what keeps this list a record of
 * what the service *does* rather than of what the library *could*.
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
    purpose:
      "The caller's session, or null. What the login screen reads on load, and — since " +
      "#703 — what the global guard calls on every request: with the cookie cache fresh " +
      "it answers from the signed snapshot in the cookie and issues no statement at all.",
  },
  {
    methods: ["POST"],
    path: `${AUTH_BASE_PATH}/sign-out`,
    purpose:
      "End the session and clear its cookie. Since #703 it **deletes the `session` row**, " +
      "so revocation is immediate rather than an expiry a copied cookie can outlive. " +
      "`POST /api/v1/auth/logout` is this service's own documented alias and delegates to " +
      "it — see `src/modules/auth/auth.controller.ts`.",
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
  {
    methods: ["GET"],
    path: `${AUTH_BASE_PATH}/organization/list`,
    purpose:
      "The caller's organizations — mockup 01 Step 2's list, and mockup 17's. " +
      "`metadata.personal` is what renders the `personal` pill (#704). It answers from the " +
      "session, so there is no id to pass and no way to ask about somebody else's " +
      "memberships. **It carries no role**: the plugin's adapter reads the `member` rows " +
      "and returns only the organizations they point at, so *what may I do here* is the " +
      "separate question `get-active-member-role` below answers.",
  },
  {
    methods: ["GET"],
    path: `${AUTH_BASE_PATH}/organization/get-active-member-role`,
    purpose:
      "What the caller may do — `{ role }`, for the session's active organization or for " +
      "whichever `?organizationId=` names, provided they belong to it. This is the third " +
      "part of the session question, and the reason `GET /api/v1/auth/me` was deleted " +
      "rather than reimplemented (#711): who you are is `get-session`, where you belong is " +
      "`organization/list`, and what you hold there is this. Cheaper than " +
      "`get-full-organization` for the purpose, and it discloses one role rather than the " +
      "whole membership list.",
  },
  {
    methods: ["POST"],
    path: `${AUTH_BASE_PATH}/organization/create`,
    purpose:
      "Create one. The caller becomes its `owner` — the one role nobody else can grant. A " +
      "`personal` flag in the request's `metadata` is stripped before the row is written; " +
      "see `stripPersonalFlag` in `organization.plugin.ts` for why that matters on the one " +
      "screen whose job is to say where somebody's work is going (#704).",
  },
  {
    methods: ["POST"],
    path: `${AUTH_BASE_PATH}/organization/set-active`,
    purpose:
      "Choose where the loop runs — mockup 01 Step 2's **Enter mission control →**. It " +
      '**writes `session."activeOrganizationId"`**, which is what makes the tenant server ' +
      "state rather than a header a client asserts (decision A5). #713 is what teaches this " +
      "service's own middleware to read it.",
  },
  {
    methods: ["GET"],
    path: `${AUTH_BASE_PATH}/organization/get-full-organization`,
    purpose:
      "One organization with its members and pending invitations — mockup 17's members & " +
      "roles table. Defaults to the session's active organization when no id is given.",
  },
  {
    methods: ["POST"],
    path: `${AUTH_BASE_PATH}/organization/invite-member`,
    purpose:
      "Invite somebody by address, at a role. Writes an `invitation` row and nothing else " +
      "in MVP — **no email is sent**; #724 is the delivery, and `expiresAt` is already on " +
      "the row waiting for it (#707). Requires `invitation: create`, which owner and admin " +
      "hold and member and viewer do not.",
  },
  {
    methods: ["POST"],
    path: `${AUTH_BASE_PATH}/organization/update-member-role`,
    purpose:
      "Change what somebody may do. The route #715 verifies a member-level caller is " +
      "refused on — `member: update` is an owner/admin permission, and `viewer` holds none " +
      "of the four resources at all (`organization.roles.ts`).",
  },
];

/**
 * One route's path, spelled the way OpenAPI spells a path parameter.
 *
 * The map writes `:id` because that is what the router and the library write; a document
 * writes `{id}`. One function rather than a second copy of the paths, so the published
 * contract and this map cannot name different routes — which is the whole of what
 * `src/openapi/openapi.spec.ts` compares
 * ([#711](https://github.com/NobuData/ouroboros/issues/711)).
 *
 * @param route - A route from {@link AUTH_ROUTES}.
 * @returns Its path with every `:name` segment rewritten as `{name}`. A path with no
 *   parameter comes back unchanged.
 */
export function openApiPath(route: AuthRoute): string {
  return route.path.replaceAll(/:([^/]+)/g, "{$1}");
}

/**
 * Every operation the map documents, keyed the way an OpenAPI document keys one.
 *
 * A route answering two verbs is two entries, because a document describes two operations —
 * so this is directly comparable with the keys `openapi.spec.ts` flattens the published
 * paths into.
 *
 * @returns `"<METHOD> <path>"` for every method of every route, in map order.
 */
export function authOperationKeys(): string[] {
  return AUTH_ROUTES.flatMap((route) =>
    route.methods.map((method) => `${method} ${openApiPath(route)}`),
  );
}

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
