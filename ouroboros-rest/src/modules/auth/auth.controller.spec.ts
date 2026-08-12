import { AppConfigService } from "../config/config.service";
import { testConfiguration } from "../config/configuration.fixture";
import type { Configuration } from "../config/configuration";
import type { User } from "../db/schema";
import { AuthController } from "./auth.controller";
import type { AuthService } from "./auth.service";
import { parseCookies } from "./cookies";
import type { AuthResponse } from "./http";
import { SESSION_COOKIE } from "./session";

/**
 * The two routes, and what they write to the response.
 *
 * One of them answers with something Nest's serialiser cannot produce — a `204` whose whole
 * payload is a `Set-Cookie` — so the assertions here are about *headers*. `http.ts` is what
 * makes that readable: the response is an object literal rather than a mocked framework
 * class.
 *
 * **Two routes and their suites left with #33's OAuth flow.** `GET auth/github` and
 * `GET auth/github/callback` were the browser-facing halves of a handshake this service no
 * longer performs, and [#702](https://github.com/NobuData/ouroboros/issues/702) removed
 * them rather than forwarding them — see `auth.controller.ts`, which is where that decision
 * is argued. BetterAuth serves the replacement at `/api/auth/*`, outside Nest's router
 * altogether, so there is no controller here to assert about.
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
