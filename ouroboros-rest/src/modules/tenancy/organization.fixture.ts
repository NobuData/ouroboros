/**
 * A workspace and a membership in it, for the suites that assert about one.
 *
 * Five specs in this module need the same two rows — the tenant context, the two decorators,
 * the role guard and the resolver — and before
 * [#713](https://github.com/NobuData/ouroboros/issues/713) each of them declared its own copy
 * of a `tenants` row. That was survivable while the shape was V001's and stable; it stopped
 * being so the moment the shape changed, because five identical literals is five edits and
 * one of them is always missed. One builder instead, so what the suites assume is what one
 * file describes.
 *
 * The ids are uuids spelled as text, which is what a real row holds: V006 carried
 * `tenants.id` into `organization."id"` unchanged rather than minting new ones, so a fixture
 * using one of the library's own id formats would let a mistake about that pass.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import { FIXTURE_ACTIVE_ORGANIZATION } from "../auth/principal.fixture";
import type { Organization, OrganizationRole } from "../db/schema";
import type { ActiveMembership } from "./tenant.context";

/** The instant every fixture row was created at. */
export const FIXTURE_INSTANT = new Date("2026-08-11T10:20:23.114Z");

/**
 * The workspace a request under test is operating in.
 *
 * Its id is the one {@link FIXTURE_ACTIVE_ORGANIZATION} puts on a fixture session, so a
 * spec that resolves the session's workspace finds *this* row rather than agreeing with it by
 * coincidence.
 */
export const FIXTURE_ORGANIZATION: Organization = {
  id: FIXTURE_ACTIVE_ORGANIZATION,
  name: "Acme, Inc.",
  slug: "acme",
  logo: null,
  createdAt: FIXTURE_INSTANT,
  metadata: null,
};

/**
 * A second workspace, for the tests that need two.
 *
 * A mismatch between a path and a header, and two requests in flight at once, are both
 * questions about *telling one workspace from another* — so the second one differs in the two
 * fields that address it and in nothing else.
 */
export const FIXTURE_OTHER_ORGANIZATION: Organization = {
  ...FIXTURE_ORGANIZATION,
  id: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
  name: "Globex Corporation",
  slug: "globex",
};

/**
 * The membership a resolved request carries.
 *
 * @param roles - What the caller holds. One role is the ordinary case; the parameter is a
 *   list because `member.role` is (V005).
 * @param organization - Which workspace. Defaults to {@link FIXTURE_ORGANIZATION}.
 * @returns The membership, as the guard would have written it into the context.
 */
export function membershipIn(
  roles: readonly OrganizationRole[],
  organization: Organization = FIXTURE_ORGANIZATION,
): ActiveMembership {
  return { tenant: organization, roles };
}
