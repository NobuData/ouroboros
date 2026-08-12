import type { AuthService as BetterAuth } from "@thallesp/nestjs-better-auth";

import type { Auth } from "../../auth/auth.factory";
import { SESSION_COOKIE, SESSION_DATA_COOKIE } from "../../auth/session.options";
import { AuthController } from "./auth.controller";
import type { AuthService } from "./auth.service";
import { SET_COOKIE, type AuthResponse } from "./http";
import { principalFor, FIXTURE_USER } from "./principal.fixture";
import { userRow } from "./principal";

/**
 * The two routes, and what each of them hands on.
 *
 * `GET me` is now a question about the *session* rather than about a row this service read,
 * and `POST logout` is a forward to the library rather than a cookie this service composed
 * — so the assertions here are about what leaves the controller: which person reaches the
 * service, which headers reach the browser, and the `204` that says there is nothing else.
 *
 * **Two routes and their suites left with #33's OAuth flow.** `GET auth/github` and
 * `GET auth/github/callback` were the browser-facing halves of a handshake this service no
 * longer performs, and [#702](https://github.com/NobuData/ouroboros/issues/702) removed
 * them rather than forwarding them. BetterAuth serves the replacement at `/api/auth/*`,
 * outside Nest's router altogether, so there is no controller here to assert about.
 */

/** What the response recorded. */
interface Recorded extends AuthResponse {
  statuses: number[];
  ended: boolean;
  /** Every `Set-Cookie` value, however many headers were written at once. */
  cookies(): string[];
}

/**
 * A response that writes everything down.
 *
 * @returns The recorder, satisfying {@link AuthResponse} structurally — exactly as
 *   Express's own `Response` does.
 */
function recordingResponse(): Recorded {
  const headers = new Map<string, string | string[]>();
  const statuses: number[] = [];

  const response: Recorded = {
    statuses,
    ended: false,
    getHeader: (name) => headers.get(name),
    setHeader: (name, value) => headers.set(name, value),
    status: (code) => {
      statuses.push(code);
      return {
        end: () => {
          response.ended = true;
        },
      };
    },
    cookies: () => {
      const value = headers.get(SET_COOKIE);
      if (value === undefined) {
        return [];
      }
      return Array.isArray(value) ? value : [value];
    },
  };

  return response;
}

/** An auth service double whose every method is a mock. */
function authDouble(): jest.Mocked<AuthService> {
  return {
    describe: jest.fn().mockResolvedValue({ user: {}, memberships: [], tenantSuggestion: null }),
  } as unknown as jest.Mocked<AuthService>;
}

/**
 * A stand-in for the library's `AuthService`, answering sign-out as the real one does.
 *
 * The real `signOut` deletes the session row and answers with the two cookie removals; this
 * records what it was asked and answers with the same shape, because what the controller is
 * responsible for is *forwarding the request and copying the answer*, and that is what can
 * go wrong here.
 */
function betterAuthDouble() {
  const signOut = jest.fn((request: { headers: Headers }): Promise<Response> => {
    const headers = new Headers();
    headers.append("set-cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly`);
    headers.append("set-cookie", `${SESSION_DATA_COOKIE}=; Path=/; Max-Age=0; HttpOnly`);

    return Promise.resolve(
      new Response(JSON.stringify({ success: true, saw: request.headers.get("cookie") }), {
        status: 200,
        headers,
      }),
    );
  });

  return { double: { api: { signOut } } as unknown as BetterAuth<Auth>, signOut };
}

/** The controller, its doubles, and a fresh response. */
function harness() {
  const auth = authDouble();
  const { double, signOut } = betterAuthDouble();

  return {
    auth,
    signOut,
    controller: new AuthController(auth, double),
    response: recordingResponse(),
  };
}

describe("reading the session", () => {
  it("describes the person the guard resolved", async () => {
    const { auth, controller } = harness();

    await controller.read(principalFor());

    expect(auth.describe).toHaveBeenCalledWith(userRow(FIXTURE_USER));
  });

  it("refuses a route with no session rather than describing nobody", () => {
    // Reachable only by somebody adding @AllowAnonymous() to this handler. It is a
    // programming mistake, and it fails here by name rather than as a 500 about a query.
    const { controller } = harness();

    expect(() => controller.read(null)).toThrow(/@AllowAnonymous/);
  });
});

describe("signing out", () => {
  it("answers 204 with no body", async () => {
    const { controller, response } = harness();

    await controller.logout({ headers: {} }, response);

    expect(response.statuses).toEqual([204]);
    expect(response.ended).toBe(true);
  });

  it("asks the library to end the session, which is what deletes the row", async () => {
    // The whole of #703's revocation criterion at this layer: this route does not compose
    // a cookie, it calls `signOut`. What that does to `ouroboros.session` is asserted where
    // there is a database — `auth.integration-spec.ts`.
    const { controller, response, signOut } = harness();

    await controller.logout({ headers: { cookie: "better-auth.session_token=abc" } }, response);

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut.mock.calls[0][0].headers.get("cookie")).toBe("better-auth.session_token=abc");
  });

  it("copies every cookie removal the library wrote, as separate headers", async () => {
    // `Headers.forEach` folds repeated values into one comma-joined string, and a browser
    // reads that as a single malformed cookie and sets none of them. Two cookies have to
    // arrive as two headers or signing out leaves the cache cookie in place.
    const { controller, response } = harness();

    await controller.logout({ headers: {} }, response);

    expect(response.cookies()).toHaveLength(2);
    expect(response.cookies()[0]).toContain(SESSION_COOKIE);
    expect(response.cookies()[1]).toContain(SESSION_DATA_COOKIE);
  });

  it("keeps a Set-Cookie something else already wrote", async () => {
    // The legacy `ouro_session` eviction runs as middleware, before this. A `setHeader`
    // here would discard it on precisely the route where a stale cookie is most likely.
    const { controller, response } = harness();
    response.setHeader(SET_COOKIE, ["ouro_session=; Max-Age=0"]);

    await controller.logout({ headers: {} }, response);

    expect(response.cookies()[0]).toBe("ouro_session=; Max-Age=0");
    expect(response.cookies()).toHaveLength(3);
  });

  it("works without a session, which is the whole reason it is anonymous", async () => {
    const { controller, response } = harness();

    await expect(controller.logout({}, response)).resolves.toBeUndefined();
    expect(response.statuses).toEqual([204]);
  });
});
