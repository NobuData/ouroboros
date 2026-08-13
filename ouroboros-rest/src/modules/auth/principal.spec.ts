import { FIXTURE_ACTIVE_ORGANIZATION, FIXTURE_USER, principalFor } from "./principal.fixture";
import {
  activeOrganizationOf,
  principalOf,
  SESSION_PROPERTY,
  type PrincipalRequest,
} from "./principal";

/**
 * How the session the library resolved reaches the code that reads it.
 *
 * Two things are worth asserting rather than reading:
 *
 *   * **The property is the library's**, so a guard that reads the request directly reads
 *     what the library wrote rather than what this service wishes it had written.
 *   * **"Acting nowhere" has one answer**, however the library spelled it — the plugin's
 *     pointer is nullable *and* absent where the plugin is not configured, and
 *     [#713](https://github.com/NobuData/ouroboros/issues/713) resolves a request's workspace
 *     from it.
 *
 * There was a third until [#714](https://github.com/NobuData/ouroboros/issues/714) — that the
 * `"user"` → `users` adaptation was exact — and it went with `userRow`, whose destination
 * table V006 dropped.
 */

describe("reading the session off a request", () => {
  it("reads the property the library's guard writes", () => {
    const principal = principalFor();
    const request: PrincipalRequest = { [SESSION_PROPERTY]: principal };

    expect(principalOf(request)).toBe(principal);
  });

  it("answers with nothing on an anonymous route, where the library writes null", () => {
    expect(principalOf({ [SESSION_PROPERTY]: null })).toBeUndefined();
  });

  it("answers with nothing when no guard ran at all", () => {
    expect(principalOf({})).toBeUndefined();
  });
});

describe("the workspace a session is acting in", () => {
  it("is the pointer the organization plugin keeps on the session row", () => {
    // The primary source of a request's tenant since
    // [#713](https://github.com/NobuData/ouroboros/issues/713), and server state: only
    // `setActiveOrganization` and session creation write it.
    expect(activeOrganizationOf(principalFor())).toBe(FIXTURE_ACTIVE_ORGANIZATION);
  });

  it("is nothing for a session that is signed in and acting nowhere", () => {
    // A valid session, and the state V005 made the column nullable to hold: somebody who
    // belongs to no workspace, or whose workspace was deleted out from under them.
    expect(activeOrganizationOf(principalFor(FIXTURE_USER, null))).toBeUndefined();
  });

  it("is nothing when the field is absent, which is the same thing to every caller", () => {
    // The library writes no such field where the plugin is not configured. "Absent" and
    // "null" have one consequence everywhere they are asked about, so they get one answer —
    // code that branched on which it got would be branching on nothing.
    const principal = principalFor();
    const withoutField = { ...principal, session: { ...principal.session } };
    delete (withoutField.session as { activeOrganizationId?: string | null }).activeOrganizationId;

    expect(activeOrganizationOf(withoutField)).toBeUndefined();
  });

  it("is nothing on an anonymous route, where there is no session at all", () => {
    expect(activeOrganizationOf(null)).toBeUndefined();
    expect(activeOrganizationOf(undefined)).toBeUndefined();
  });
});

describe("the signed-in person", () => {
  it("is the session's own user, with no row read to confirm it", () => {
    // The property the tenant context stores and `member."userId"` is matched against. It is
    // the library's shape rather than an adaptation of it since #714 — one shape for "the
    // signed-in person", so there is nothing to keep in step.
    expect(principalOf({ [SESSION_PROPERTY]: principalFor() })?.user).toBe(FIXTURE_USER);
  });
});
