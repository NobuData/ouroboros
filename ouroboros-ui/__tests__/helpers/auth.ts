import type { Membership } from "@/app/api/membership";

/**
 * The auth family, stubbed — what `app/api/session.ts` calls, and what it hears back.
 *
 * Every suite that exercises something behind `currentAccess()` has to answer three
 * requests rather than one since [#711](https://github.com/NobuData/ouroboros/issues/711)
 * deleted `GET /api/v1/auth/me`: the session, the organization listing, and the caller's
 * role in each organization. Written once here so a suite whose subject is a Server Action
 * or a screen states *who is signed in and what they hold* and nothing about how many
 * requests that takes — which is also what keeps those suites unchanged when
 * [#714](https://github.com/NobuData/ouroboros/issues/714) collapses the three into one.
 *
 * It answers over `fetch` because that is what the auth client uses. The generated client's
 * own stub is `helpers/api.ts`, and the two do not overlap: they are the two families, and a
 * suite covering both wires both.
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
 * Whether a URL names one of the auth routes.
 *
 * @param url The request's URL.
 * @returns `true` for anything under `/api/auth`.
 */
export function isAuthUrl(url: string): boolean {
  return url.includes("/api/auth/");
}

/**
 * What the auth family answers, for a person holding the given memberships.
 *
 * @param url The request's URL. Must be one {@link isAuthUrl} admits.
 * @param memberships What this person belongs to, or `null` for nobody signed in.
 * @returns The body to answer with. `null` from the session route is what BetterAuth
 *   answers for a request carrying no session, and is why a signed-out visitor is a
 *   `200` here rather than a `401`.
 */
export function authAnswer(url: string, memberships: readonly Membership[] | null): unknown {
  if (url.includes("/get-session")) {
    return memberships === null
      ? null
      : { session: { activeOrganizationId: memberships[0]?.tenantId ?? null }, user: AUTH_USER };
  }

  if (url.includes("/organization/list")) {
    // Organizations, without roles — the listing's real shape. The role is the third call.
    return (memberships ?? []).map((one) => ({
      id: one.tenantId,
      name: one.displayName,
      slug: one.slug,
    }));
  }

  const asked = new URL(url).searchParams.get("organizationId");
  const held = (memberships ?? []).find((one) => one.tenantId === asked);

  return held === undefined ? null : { role: held.role };
}
