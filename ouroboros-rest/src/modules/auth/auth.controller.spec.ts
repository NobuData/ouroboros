import { AppConfigService } from "../config/config.service";
import { testConfiguration } from "../config/configuration.fixture";
import type { Configuration } from "../config/configuration";
import type { User } from "../db/schema";
import { AuthController, REDIRECT_STATUS } from "./auth.controller";
import type { AuthService } from "./auth.service";
import { parseCookies } from "./cookies";
import type { AuthResponse } from "./http";
import { HANDSHAKE_COOKIE } from "./oauth";
import type { PrincipalRequest } from "./principal";
import { SESSION_COOKIE } from "./session";

/**
 * The four routes, and what they write to the response.
 *
 * Three of them answer with something Nest's serialiser cannot produce — two redirects and
 * a `204` — so the assertions here are about *headers*, which is where the whole payload of
 * a sign-in lives. `http.ts` is what makes that readable: the response is an object literal
 * rather than a mocked framework class.
 */

const USER = {
  id: "5eed0003-0000-4000-8000-000000000001",
  email: "ken@acme-robotics.dev",
  display_name: "Ken Suenobu",
  avatar_url: null,
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
} satisfies User;

/** What the response recorded. */
interface Recorded extends AuthResponse {
  headers: Map<string, string | string[]>;
  redirects: { status: number; url: string }[];
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
  const redirects: { status: number; url: string }[] = [];
  const statuses: number[] = [];

  const response: Recorded = {
    headers,
    redirects,
    statuses,
    ended: false,
    setHeader: (name, value) => headers.set(name, value),
    redirect: (status, url) => redirects.push({ status, url }),
    status: (code) => {
      statuses.push(code);
      return {
        end: () => {
          response.ended = true;
        },
      };
    },
    cookies: () => {
      const value = headers.get("Set-Cookie");
      if (value === undefined) {
        return [];
      }
      return Array.isArray(value) ? value : [value];
    },
  };

  return response;
}

/**
 * A configuration service over a validated configuration.
 *
 * @param overrides - Environment variables to change.
 * @returns The accessor.
 */
function configFor(overrides: NodeJS.ProcessEnv = {}): AppConfigService {
  const configuration = testConfiguration(overrides);

  return new AppConfigService({
    getOrThrow: (key: string) => configuration[key as keyof Configuration],
    get: (key: string) => configuration[key as keyof Configuration],
  } as never);
}

/** An auth service double whose every method is a mock. */
function authDouble(): jest.Mocked<AuthService> {
  return {
    startSignIn: jest.fn().mockReturnValue({
      authorizeUrl: "https://github.com/login/oauth/authorize?x=1",
      handshake: "handshake.signature",
    }),
    completeSignIn: jest.fn().mockResolvedValue("session.signature"),
    describe: jest.fn().mockResolvedValue({ user: {}, memberships: [], tenantSuggestion: null }),
  } as unknown as jest.Mocked<AuthService>;
}

/** The controller, its double, and a fresh response. */
function harness(overrides: NodeJS.ProcessEnv = {}) {
  const auth = authDouble();

  return {
    auth,
    controller: new AuthController(auth, configFor(overrides)),
    response: recordingResponse(),
  };
}

/** The value of one named cookie among the `Set-Cookie` headers written. */
function cookieValue(response: Recorded, name: string): string | undefined {
  for (const header of response.cookies()) {
    const value = parseCookies(header.slice(0, header.indexOf(";"))).get(name);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

/** The attributes of one named cookie among the `Set-Cookie` headers written. */
function cookieHeader(response: Recorded, name: string): string {
  return response.cookies().find((header) => header.startsWith(`${name}=`)) ?? "";
}

describe("beginning a sign-in", () => {
  it("redirects to the URL the service built", () => {
    const { controller, response } = harness();

    controller.start(response);

    expect(response.redirects).toEqual([
      { status: REDIRECT_STATUS, url: "https://github.com/login/oauth/authorize?x=1" },
    ]);
    expect(REDIRECT_STATUS).toBe(302);
  });

  it("sets the handshake cookie", () => {
    const { controller, response } = harness();

    controller.start(response);

    expect(cookieValue(response, HANDSHAKE_COOKIE)).toBe("handshake.signature");
  });

  it("scopes the handshake cookie to the auth routes and hides it from script", () => {
    const { controller, response } = harness();

    controller.start(response);

    expect(cookieHeader(response, HANDSHAKE_COOKIE)).toContain("Path=/api/v1/auth");
    expect(cookieHeader(response, HANDSHAKE_COOKIE)).toContain("HttpOnly");
    expect(cookieHeader(response, HANDSHAKE_COOKIE)).toContain("SameSite=Lax");
  });

  it("builds the callback from configuration, not from the request", () => {
    const { auth, controller, response } = harness();

    controller.start(response);

    expect(auth.startSignIn).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/auth/github/callback",
    );
  });

  it("marks the cookie Secure in production and not in development", () => {
    const development = harness();
    development.controller.start(development.response);
    expect(cookieHeader(development.response, HANDSHAKE_COOKIE)).not.toContain("Secure");

    const production = harness({ NODE_ENV: "production" });
    production.controller.start(production.response);
    expect(cookieHeader(production.response, HANDSHAKE_COOKIE)).toContain("Secure");
  });
});

describe("finishing a sign-in", () => {
  const request: PrincipalRequest = { headers: { cookie: `${HANDSHAKE_COOKIE}=handshake.value` } };

  it("hands the service the code, the state and the handshake cookie", async () => {
    const { auth, controller, response } = harness();

    await controller.callback({ code: "the-code", state: "the-state" }, request, response);

    expect(auth.completeSignIn).toHaveBeenCalledWith(
      "the-code",
      "the-state",
      "handshake.value",
      "http://localhost:4000/api/v1/auth/github/callback",
    );
  });

  it("presents the same callback URL the authorize request carried", async () => {
    // GitHub compares the two, and a difference of one character is a refused exchange.
    const CALLBACK = "http://localhost:4000/api/v1/auth/github/callback";
    const { auth, controller, response } = harness();

    controller.start(response);
    await controller.callback({ code: "c", state: "s" }, request, response);

    expect(auth.startSignIn).toHaveBeenCalledWith(CALLBACK);
    expect(auth.completeSignIn).toHaveBeenCalledWith("c", "s", expect.anything(), CALLBACK);
  });

  it("lands the session cookie", async () => {
    const { controller, response } = harness();

    await controller.callback({ code: "c", state: "s" }, request, response);

    expect(cookieValue(response, SESSION_COOKIE)).toBe("session.signature");
    expect(cookieHeader(response, SESSION_COOKIE)).toContain("HttpOnly");
    expect(cookieHeader(response, SESSION_COOKIE)).toContain("Path=/");
  });

  it("clears the spent handshake in the same answer", async () => {
    // A used handshake left in the browser is a value that outlives the trip it was for.
    const { controller, response } = harness();

    await controller.callback({ code: "c", state: "s" }, request, response);

    expect(response.cookies()).toHaveLength(2);
    expect(cookieHeader(response, HANDSHAKE_COOKIE)).toContain("Max-Age=0");
  });

  it("sends the browser to the UI", async () => {
    const { controller, response } = harness();

    await controller.callback({ code: "c", state: "s" }, request, response);

    expect(response.redirects).toEqual([{ status: REDIRECT_STATUS, url: "http://localhost:3000" }]);
  });

  it("copes with a request carrying no cookies at all", async () => {
    const { auth, controller, response } = harness();

    await controller.callback({ code: "c", state: "s" }, {}, response);

    expect(auth.completeSignIn).toHaveBeenCalledWith("c", "s", undefined, expect.anything());
  });

  it("writes nothing to the response when the service refuses", async () => {
    // The failure has to reach the error filter as an envelope. A handler that had already
    // sent headers would answer a redirect *and* a 401.
    const { auth, controller, response } = harness();
    auth.completeSignIn.mockRejectedValue(new Error("refused"));

    await expect(
      controller.callback({ code: "c", state: "s" }, request, response),
    ).rejects.toThrow();

    expect(response.cookies()).toHaveLength(0);
    expect(response.redirects).toHaveLength(0);
  });
});

describe("reading the session", () => {
  it("describes the person the guard established", async () => {
    const { auth, controller } = harness();

    await controller.read(USER);

    expect(auth.describe).toHaveBeenCalledWith(USER);
  });
});

describe("signing out", () => {
  it("answers 204 with no body", () => {
    const { controller, response } = harness();

    controller.logout(response);

    expect(response.statuses).toEqual([204]);
    expect(response.ended).toBe(true);
  });

  it("removes the session cookie", () => {
    const { controller, response } = harness();

    controller.logout(response);

    expect(cookieHeader(response, SESSION_COOKIE)).toContain("Max-Age=0");
    expect(cookieValue(response, SESSION_COOKIE)).toBe("");
  });

  it("repeats the attributes the cookie was set with", () => {
    // A browser treats a differing Path as a different cookie and leaves the original in
    // place — so a logout that guessed would answer 204 and sign nobody out.
    const { controller, response } = harness();

    controller.logout(response);

    expect(cookieHeader(response, SESSION_COOKIE)).toContain("Path=/");
    expect(cookieHeader(response, SESSION_COOKIE)).toContain("SameSite=Lax");
    expect(cookieHeader(response, SESSION_COOKIE)).toContain("HttpOnly");
  });

  it("works without a session, which is the whole reason it is public", () => {
    const { controller, response } = harness();

    expect(() => controller.logout(response)).not.toThrow();
  });
});
