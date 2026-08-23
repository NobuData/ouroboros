/**
 * A resolved session, for the suites that assert about one.
 *
 * The library's `AuthGuard` writes `{session, user}` onto every request, and three
 * different kinds of test need to stand in for it: a controller called directly, a guard
 * called directly, and a spec asserting the adaptation in `principal.ts`. One builder,
 * so the shape they all assume is the shape one file describes.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import type { Principal, SessionUser } from "./principal";

/** The instant every fixture person was created and last updated at. */
export const FIXTURE_INSTANT = new Date("2026-08-11T10:20:23.114Z");

/**
 * A person, as BetterAuth holds them.
 *
 * The id is a uuid rather than one of the library's own ids, deliberately: V004 preserved
 * `users.id` into `"user".id`, so a real session names a uuid spelled as text, and a
 * fixture that used something else would let a mistake about that pass.
 */
export const FIXTURE_USER: SessionUser = {
  id: "5eed0003-0000-4000-8000-000000000001",
  name: "Ken Suenobu",
  email: "ken@acme-robotics.dev",
  emailVerified: true,
  image: null,
  createdAt: FIXTURE_INSTANT,
  updatedAt: FIXTURE_INSTANT,
};

/**
 * The workspace a fixture session is acting in — `session."activeOrganizationId"` (V005).
 *
 * A uuid spelled as text, because that is what a real pointer holds: V006 carried
 * `tenants.id` into `organization."id"` unchanged. `tenancy/organization.fixture.ts` builds
 * its workspace with this same value, so a session and the row it points at agree across the
 * two suites that use both — which is the thing a resolver test would otherwise assert by
 * coincidence.
 */
export const FIXTURE_ACTIVE_ORGANIZATION = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

/**
 * A session, as the guard resolved it.
 *
 * @param user - Whose. Defaults to {@link FIXTURE_USER}.
 * @param activeOrganizationId - Where it is acting. Defaults to
 *   {@link FIXTURE_ACTIVE_ORGANIZATION}; pass `null` for the signed-in-and-acting-nowhere
 *   session that [#713](https://github.com/NobuData/ouroboros/issues/713) answers `400` for.
 * @param createdAt - When the sign-in happened. Defaults to {@link FIXTURE_INSTANT}, which
 *   is a fixed instant in the past — so a fixture session is *not* fresh unless a suite
 *   says so, which is the polarity AD.2's step-up
 *   ([#223](https://github.com/NobuData/ouroboros/issues/223)) needs: a check that passed by
 *   default would pass in every test that never thought about it.
 * @returns The principal a `@Session()` parameter would be handed.
 */
export function principalFor(
  user: SessionUser = FIXTURE_USER,
  activeOrganizationId: string | null = FIXTURE_ACTIVE_ORGANIZATION,
  createdAt: Date = FIXTURE_INSTANT,
): Principal {
  return {
    session: {
      id: "5e551000-0000-4000-8000-000000000001",
      token: "a-session-token",
      userId: user.id,
      expiresAt: new Date("2026-08-18T10:20:23.114Z"),
      createdAt,
      activeOrganizationId,
    },
    user,
  };
}
