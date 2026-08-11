import type { User } from "../db/schema";
import { attachPrincipal, PRINCIPAL, principalOf, type PrincipalRequest } from "./principal";

/**
 * Where the caller is kept between the guard and the handler.
 *
 * One property of this file is worth asserting rather than reading: the principal is under
 * a **symbol**. A request object is a bag every piece of middleware in the process can
 * write to, and `request.user` is the most contended name in it — Passport writes it, more
 * than one logging library reads it, and a collision there is an authorization decision
 * made from somebody else's object.
 */

const USER = {
  id: "5eed0003-0000-4000-8000-000000000001",
  email: "ken@acme-robotics.dev",
  display_name: "Ken Suenobu",
  avatar_url: null,
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
} satisfies User;

describe("attaching a principal", () => {
  it("is read back by principalOf", () => {
    const request: PrincipalRequest = {};

    attachPrincipal(request, { user: USER });

    expect(principalOf(request)).toEqual({ user: USER });
  });

  it("answers with nothing on a request no guard established one for", () => {
    expect(principalOf({})).toBeUndefined();
  });

  it("is stored under a symbol, not under a name anything else could write", () => {
    const request: PrincipalRequest = {};

    attachPrincipal(request, { user: USER });

    expect(Object.keys(request)).toHaveLength(0);
    expect(Object.getOwnPropertySymbols(request)).toContain(PRINCIPAL);
  });

  it("is invisible to a serialiser, so a principal cannot be logged by accident", () => {
    const request: PrincipalRequest = { headers: { cookie: "ouro_session=token" } };

    attachPrincipal(request, { user: USER });

    // Symbol-keyed properties are skipped by JSON.stringify. A request written to a log
    // therefore carries no copy of the person it was authenticated as.
    expect(JSON.stringify(request)).not.toContain(USER.email);
  });

  it("carries the whole person, because the row was read to establish the session anyway", () => {
    const request: PrincipalRequest = {};

    attachPrincipal(request, { user: USER });

    expect(principalOf(request)?.user.email).toBe("ken@acme-robotics.dev");
    expect(principalOf(request)?.user.display_name).toBe("Ken Suenobu");
  });
});
