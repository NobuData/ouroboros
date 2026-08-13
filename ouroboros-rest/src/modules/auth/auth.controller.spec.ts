import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import type { AuthService as BetterAuth } from "@thallesp/nestjs-better-auth";

import type { Auth } from "../../auth/auth.factory";
import { SESSION_COOKIE, SESSION_DATA_COOKIE } from "../../auth/session.options";
import { ALLOW_ANONYMOUS } from "./anonymous";
import { AuthController } from "./auth.controller";
import type { DiscoverBody } from "./discovery.dto";
import { NO_SSO_MESSAGE, type DiscoveryResource, type DiscoveryService } from "./discovery.service";
import { SET_COOKIE, type AuthResponse } from "./http";

/**
 * The two routes, and what each of them hands on.
 *
 * `POST logout` is a forward to the library rather than a cookie this service composed, so
 * the assertions here are about what leaves the controller: which headers reach the
 * library, which reach the browser, and the `204` that says there is nothing else.
 *
 * `POST discover` ([#712](https://github.com/NobuData/ouroboros/issues/712)) is a forward
 * too, one layer down: the rules that make it safe to serve anonymously live in
 * `discovery.service.ts` and are asserted beside it. What is asserted *here* is the part
 * that is genuinely the route's — that it is exempt from the session guard, that it answers
 * `200` rather than a `POST`'s default `201`, and that it changes nothing about the body on
 * its way past.
 *
 * **Three routes and their suites have left this controller.** `GET auth/github` and
 * `GET auth/github/callback` were the browser-facing halves of a handshake this service no
 * longer performs, and [#702](https://github.com/NobuData/ouroboros/issues/702) removed
 * them rather than forwarding them. `GET me` went in
 * [#711](https://github.com/NobuData/ouroboros/issues/711), which published BetterAuth's
 * own session routes and deleted the second answer to the same question. BetterAuth serves
 * all three replacements at `/api/auth/*`, outside Nest's router altogether, so there is no
 * controller here to assert about — `src/openapi/openapi.spec.ts` is where the published
 * surface is held to the route map instead.
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

/**
 * A discovery service that answers as the real one does, and records what it was asked.
 *
 * Its rules — the uniform answer, the timing floor, the lookup that happens anyway — are
 * asserted in `discovery.service.spec.ts`, where they belong. What the controller is
 * responsible for is handing the validated body over and returning what came back, and that
 * is all this double is here to observe.
 */
function discoveryDouble() {
  const answer: DiscoveryResource = { ssoAvailable: false, message: NO_SSO_MESSAGE };
  const discover = jest.fn((_body: DiscoverBody) => Promise.resolve(answer));

  return { double: { discover } as unknown as DiscoveryService, discover, answer };
}

/** The controller, its doubles, and a fresh response. */
function harness() {
  const { double, signOut } = betterAuthDouble();
  const { double: discovery, discover, answer } = discoveryDouble();

  return {
    signOut,
    discover,
    answer,
    controller: new AuthController(double, discovery),
    response: recordingResponse(),
  };
}

describe("the controller's surface", () => {
  it("serves signing out and domain discovery, and nothing else", () => {
    // #711 deleted `GET me` and nothing under `/api/v1` replaced it. A *third* handler
    // appearing here is the failure this guards: the session question belongs to
    // BetterAuth's routes, and a route added here would be the duplicate the issue's
    // acceptance criterion forbids. `openapi.spec.ts` asserts the same thing about the
    // published contract; this asserts it about the class.
    //
    // `discover` is the one addition since, and it is not that duplicate: it answers *is
    // there a workspace at this domain*, from this service's own `tenant_domains`, for a
    // caller who has no session to ask about.
    const handlers = Object.getOwnPropertyNames(AuthController.prototype).filter(
      (name) => name !== "constructor",
    );

    expect(handlers.toSorted()).toEqual(["discover", "logout"]);
  });
});

describe("discovering a domain", () => {
  it("hands the validated body to the service and answers with what it returned", async () => {
    const { controller, discover, answer } = harness();

    await expect(controller.discover({ domain: "acme.ouroboros.dev" })).resolves.toBe(answer);
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("passes the domain through untouched", async () => {
    // The controller normalises nothing. `discovery.dto.ts` has already done it, and doing
    // it twice is how two rules drift apart.
    const { controller, discover } = harness();

    await controller.discover({ domain: "acme.ouroboros.dev" });

    expect(discover.mock.calls[0][0]).toEqual({ domain: "acme.ouroboros.dev" });
  });

  it("answers 200 rather than the 201 a POST would default to", () => {
    // Nothing is created — this is a question, and the verb is protecting the domain from
    // the request line and from a shared cache rather than describing a write.
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, AuthController.prototype.discover)).toBe(200);
  });

  it("is reachable without a session", () => {
    // The one property of this route that is not the service's: its caller is a browser on
    // the login page, which by definition holds no session. `guard.surface.spec.ts` is where
    // the same fact is asserted across the whole route table.
    expect(Reflect.getMetadata(ALLOW_ANONYMOUS, AuthController.prototype.discover)).toBe(true);
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
