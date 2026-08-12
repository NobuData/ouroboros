import { FIXTURE_INSTANT, FIXTURE_USER, principalFor } from "./principal.fixture";
import {
  principalOf,
  principalUser,
  SESSION_PROPERTY,
  userRow,
  type PrincipalRequest,
  type SessionUser,
} from "./principal";

/**
 * How the session the library resolved reaches the code that was written before it existed.
 *
 * Three things are worth asserting rather than reading, and each replaces something
 * [#33](https://github.com/NobuData/ouroboros/issues/33) checked here:
 *
 *   * **The property is the library's**, so a guard that reads the request directly reads
 *     what the library wrote rather than what this service wishes it had written.
 *   * **The adaptation is exact.** `userRow` is the whole of the `"user"` → `users`
 *     translation, and the day it drops a field is the day `/auth/me` starts answering with
 *     a blank display name.
 *   * **An absent session fails loudly.** #33's `@CurrentUser()` threw rather than handing a
 *     handler `undefined` typed as a person; this keeps that, because the failure it catches
 *     — `@Session()` on a route somebody also marked `@AllowAnonymous()` — is a mistake a
 *     type cannot catch.
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

describe("the session's user as a users row", () => {
  it("maps every field the tenancy code reads", () => {
    expect(userRow(FIXTURE_USER)).toEqual({
      id: "5eed0003-0000-4000-8000-000000000001",
      email: "ken@acme-robotics.dev",
      display_name: "Ken Suenobu",
      avatar_url: null,
      created_at: FIXTURE_INSTANT,
      updated_at: FIXTURE_INSTANT,
    });
  });

  it("keeps the id, which is what makes tenant_members still resolve", () => {
    // V004 back-filled `users` into `"user"` preserving ids. If this ever stopped being an
    // identity, every membership lookup would quietly find nothing and the API would answer
    // "you belong to no workspaces" to somebody who belongs to several.
    expect(userRow(FIXTURE_USER).id).toBe(FIXTURE_USER.id);
  });

  it("renders a missing avatar as null rather than undefined", () => {
    // The column is nullable and the resource publishes `null`; an `undefined` would
    // serialise the field away, which is a different answer for a client to parse.
    const withoutImage: SessionUser = { ...FIXTURE_USER, image: undefined };

    expect(userRow(withoutImage).avatar_url).toBeNull();
  });

  it("carries an avatar the provider supplied", () => {
    const withImage: SessionUser = { ...FIXTURE_USER, image: "https://example.test/a.png" };

    expect(userRow(withImage).avatar_url).toBe("https://example.test/a.png");
  });
});

describe("the person a handler is entitled to", () => {
  it("is the session's user, adapted", () => {
    expect(principalUser(principalFor())).toEqual(userRow(FIXTURE_USER));
  });

  it.each([
    ["null, as an anonymous route hands it", null],
    ["undefined, as a handler with no guard at all would", undefined],
  ])("refuses %s loudly rather than passing it on", (_description, absent) => {
    // The mistake this catches is @Session() on a route somebody also marked
    // @AllowAnonymous(). Failing here names it; failing three layers down is a 500 about a
    // query filtered by undefined.
    expect(() => principalUser(absent)).toThrow(/@AllowAnonymous/);
  });
});
