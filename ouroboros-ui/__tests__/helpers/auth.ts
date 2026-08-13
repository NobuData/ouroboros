import type { Membership } from "@/app/api/membership";

/**
 * The two families a session is composed from, stubbed — what `app/api/auth-server.ts`
 * calls, and what it hears back.
 *
 * Every suite that exercises something behind `currentAccess()` has to answer two requests:
 * BetterAuth's `GET /api/auth/get-session`, and `GET /api/v1/orgs` — the workspace rows,
 * which [#719](https://github.com/NobuData/ouroboros/issues/719) made the source of a
 * session's memberships. Written once here so a suite whose subject is a Server Action or a
 * screen states *who is signed in and what they belong to* and nothing about how many
 * requests that takes.
 *
 * It used to be three, and one of them was per workspace: `organization/list` returns the
 * organizations without roles, so a role cost a `get-active-member-role` each. The row model
 * carries roles, counts, the monogram and the `personal` flag together, so the fan-out is
 * gone and so is the branch of this helper that answered it.
 *
 * Both stubs answer over `fetch`, because that is what both clients use — BetterAuth's own,
 * and the generated one built by `app/api/client.ts`. A suite that only needs the *generated*
 * family without a session has `helpers/api.ts` instead, which hands back a client rather
 * than replacing the global.
 *
 * **What reaches the stub is not a string**, and that is
 * [#716](https://github.com/NobuData/ouroboros/issues/716)'s doing rather than a detail of
 * the helper: BetterAuth's client composes a `URL` and hands `fetch` that, where the
 * generated client hands it a `Request`. {@link requestedUrl} is the one place that
 * difference is absorbed, so a suite goes on answering by path.
 */

/** The signed-in person, in BetterAuth's own vocabulary — `name` and `image`. */
export const AUTH_USER = {
  id: "5eed0003-0000-4000-8000-000000000001",
  email: "ken@acme-robotics.dev",
  name: "Ken Suenobu",
  image: null,
  createdAt: "2026-08-11T10:20:23.114Z",
  updatedAt: "2026-08-11T10:20:23.114Z",
};

/**
 * The URL a stubbed `fetch` was called with, whichever shape it arrived in.
 *
 * Three callers compose requests in this module and each hands `fetch` something different:
 * the generated client a `Request`, BetterAuth's client a `URL`, and
 * `app/api/health.ts` a plain string. A suite that unwrapped only the shape it expected would
 * pass for the wrong reason the moment another family's call landed in the same stub.
 *
 * @param input Whatever `fetch` was called with.
 * @returns The absolute URL as a string.
 */
export function requestedUrl(input: Request | URL | string): string {
  return input instanceof Request ? input.url : String(input);
}

/**
 * Whether a URL names one of the auth routes.
 *
 * @param url The request's URL.
 * @returns `true` for anything under `/api/auth`.
 */
export function isAuthUrl(url: string): boolean {
  return url.includes("/api/auth/");
}

/**
 * Whether a URL names the workspace listing.
 *
 * @param url The request's URL.
 * @returns `true` for `GET /api/v1/orgs` — and not for the GitHub-organisation routes
 *   nested under it, which carry a further segment.
 */
export function isOrgsUrl(url: string): boolean {
  return /\/api\/v1\/orgs(\?|$)/.test(url);
}

/**
 * What the auth family answers, for a person holding the given memberships.
 *
 * @param url The request's URL. Must be one {@link isAuthUrl} admits.
 * @param memberships What this person belongs to, or `null` for nobody signed in.
 * @param activeOrganizationId Where the session is acting. Defaults to the first membership,
 *   which is what `ouroboros-rest` stamps a new session with; pass `null` for a session
 *   acting nowhere, or an id for one pointing somewhere specific.
 * @returns The body to answer with. `null` from the session route is what BetterAuth
 *   answers for a request carrying no session, and is why a signed-out visitor is a
 *   `200` here rather than a `401`.
 */
export function authAnswer(
  url: string,
  memberships: readonly Membership[] | null,
  activeOrganizationId: string | null = memberships?.[0]?.id ?? null,
): unknown {
  if (url.includes("/get-session")) {
    return memberships === null ? null : { session: { activeOrganizationId }, user: AUTH_USER };
  }

  // `set-active` and `sign-out` are writes whose answer nothing in this module reads.
  return {};
}

/**
 * What `GET /api/v1/orgs` answers — one page of workspace rows.
 *
 * @param memberships The rows, or `null` for nobody signed in, which is an empty page: the
 *   listing is scoped to the caller and a caller with no session never gets this far.
 * @param total How many exist in total. Defaults to the number given, which is the case
 *   every suite but the truncation one is about.
 * @returns The page body.
 */
export function orgsAnswer(
  memberships: readonly Membership[] | null,
  total?: number,
): unknown {
  const items = memberships ?? [];

  return { items, total: total ?? items.length, limit: 100, offset: 0 };
}
