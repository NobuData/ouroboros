import { AppConfigService } from "../config/config.service";
import { testConfiguration } from "../config/configuration.fixture";
import type { Configuration } from "../config/configuration";
import { SET_COOKIE, type AuthResponse } from "./http";
import {
  carriesLegacyCookie,
  expiredLegacyCookie,
  LEGACY_SESSION_COOKIE,
  LegacySessionCookieMiddleware,
} from "./legacy.cookie";

/**
 * Telling a browser to drop the cookie #33 issued.
 *
 * The acceptance criterion this covers is *a stale `ouro_session` cookie is rejected
 * cleanly (401 + clear-cookie), not 500*. The `401` is the guard's and is asserted where
 * the guard is; this is the clear-cookie half, and the two properties worth pinning are
 * that it fires **only** when the cookie was actually sent, and that it does not eat a
 * `Set-Cookie` somebody else has already written.
 */

/** A response that writes everything down, satisfying {@link AuthResponse} structurally. */
function recordingResponse(): AuthResponse & { headers: Map<string, string | string[]> } {
  const headers = new Map<string, string | string[]>();

  return {
    headers,
    getHeader: (name) => headers.get(name),
    setHeader: (name, value) => headers.set(name, value),
    status: () => ({ end: () => undefined }),
  };
}

/**
 * The middleware, over a configuration.
 *
 * @param overrides - Environment variables to change — `NODE_ENV` is the one that matters.
 * @returns The middleware under test.
 */
function middlewareFor(overrides: NodeJS.ProcessEnv = {}): LegacySessionCookieMiddleware {
  const configuration = testConfiguration(overrides);
  const config = new AppConfigService({
    getOrThrow: (key: string) => configuration[key as keyof Configuration],
    get: (key: string) => configuration[key as keyof Configuration],
  } as never);

  return new LegacySessionCookieMiddleware(config);
}

/** Every `Set-Cookie` the response ended up with. */
function cookies(response: { headers: Map<string, string | string[]> }): string[] {
  const value = response.headers.get(SET_COOKIE);

  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

describe("recognising the cookie", () => {
  it.each([
    ["on its own", "ouro_session=abc"],
    ["after another cookie", "theme=dark; ouro_session=abc"],
    ["before another cookie", "ouro_session=abc; theme=dark"],
    ["with no value at all", "ouro_session="],
  ])("finds it %s", (_description, header) => {
    expect(carriesLegacyCookie(header)).toBe(true);
  });

  it.each([
    ["a request with no cookies", undefined],
    ["a jar that does not hold it", "theme=dark; better-auth.session_token=abc"],
    ["a cookie whose name merely ends with it", "not_ouro_session=abc"],
    ["a cookie whose name merely starts with it", "ouro_session_backup=abc"],
  ])("does not find it in %s", (_description, header) => {
    expect(carriesLegacyCookie(header)).toBe(false);
  });
});

describe("the removal", () => {
  it("empties the cookie and expires it immediately", () => {
    const header = expiredLegacyCookie(false);

    expect(header.startsWith(`${LEGACY_SESSION_COOKIE}=;`)).toBe(true);
    expect(header).toContain("Max-Age=0");
  });

  it("repeats the attributes it was set with, or the browser leaves it in place", () => {
    // A removal on a different Path names a different cookie, and the original survives.
    const header = expiredLegacyCookie(false);

    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });

  it.each([
    ["is Secure in production", true, true],
    ["is not, on a development machine serving plain HTTP over loopback", false, false],
  ])("%s", (_description, isProduction, expected) => {
    expect(expiredLegacyCookie(isProduction).includes("Secure")).toBe(expected);
  });
});

describe("the middleware", () => {
  it("removes the cookie from a request that carried one", () => {
    const response = recordingResponse();
    const next = jest.fn();

    middlewareFor().use({ headers: { cookie: "ouro_session=stale" } }, response, next);

    expect(cookies(response)).toEqual([expiredLegacyCookie(false)]);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("writes nothing at all for a request that did not", () => {
    // Every response carrying a header it does not need is a header somebody has to
    // explain, and a browser being told to drop a cookie it never had is noise on the wire.
    const response = recordingResponse();

    middlewareFor().use({ headers: { cookie: "theme=dark" } }, response, jest.fn());

    expect(cookies(response)).toEqual([]);
  });

  it("writes nothing for a request with no headers at all", () => {
    const response = recordingResponse();

    middlewareFor().use({}, response, jest.fn());

    expect(cookies(response)).toEqual([]);
  });

  it("adds to the Set-Cookie already on the answer rather than replacing it", () => {
    // Sign-out writes BetterAuth's own removals after this has run. A `setHeader` would
    // discard one of the two, and which one would depend on the order two lines execute.
    const response = recordingResponse();
    response.setHeader(SET_COOKIE, ["something=else"]);

    middlewareFor().use({ headers: { cookie: "ouro_session=stale" } }, response, jest.fn());

    expect(cookies(response)).toEqual(["something=else", expiredLegacyCookie(false)]);
  });

  it("carries Secure in production", () => {
    const response = recordingResponse();

    middlewareFor({ NODE_ENV: "production" }).use(
      { headers: { cookie: "ouro_session=stale" } },
      response,
      jest.fn(),
    );

    expect(cookies(response)[0]).toContain("Secure");
  });

  it("refuses nothing — the 401 is the guard's to answer", () => {
    const next = jest.fn();

    middlewareFor().use({ headers: { cookie: "ouro_session=stale" } }, recordingResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
