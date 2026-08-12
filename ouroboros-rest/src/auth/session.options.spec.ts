import {
  SESSION_COOKIE,
  SESSION_COOKIE_CACHE_SECONDS,
  SESSION_DATA_COOKIE,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  sessionOptions,
} from "./session.options";

/**
 * The session policy, pinned.
 *
 * Four numbers, and the reason each is asserted rather than read is that each is a promise
 * something outside this file depends on:
 *
 *   * **`docs/ARCHITECTURE.md` § 5.4 publishes them.** A value that changed without the
 *     document changing would make the document wrong, and there is no way to tell from
 *     reading either.
 *   * **The cookie cache is an acceptance criterion.**
 *     [#703](https://github.com/NobuData/ouroboros/issues/703) asks for *≤ 1 DB query per
 *     request with the cookie cache enabled*, and `cookieCache.enabled` is the whole of the
 *     mechanism. Off — which is BetterAuth's default — every request is a lookup, and
 *     nothing else in the suite would notice.
 *   * **The lifetime is a security property.** Seven days is the bound on a stolen cookie
 *     as much as it is a convenience, and a change to it is a change somebody should have
 *     to argue for in a diff rather than get for free by editing a literal.
 *
 * The values are stated rather than left to the library's defaults for the same reason they
 * are asserted here: what this service depends on should not be able to change under it in
 * an upgrade.
 */

describe("the numbers", () => {
  it("expires a session after seven days", () => {
    expect(SESSION_EXPIRES_IN_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it("renews one that is a day old, rather than on every request", () => {
    // Renewal writes `session.expiresAt` and re-sets the cookie. On every request that is an
    // update per request — the cost the cookie cache exists to remove, reintroduced.
    expect(SESSION_UPDATE_AGE_SECONDS).toBe(24 * 60 * 60);
  });

  it("trusts the cached snapshot for five minutes", () => {
    expect(SESSION_COOKIE_CACHE_SECONDS).toBe(5 * 60);
  });

  it("renews well before it expires, or a session in daily use would end mid-week", () => {
    // The relationship rather than the values: BetterAuth renews when a session is within
    // `expiresIn - updateAge` of issue, so an update age at or above the lifetime is a
    // session that is never renewed at all.
    expect(SESSION_UPDATE_AGE_SECONDS).toBeLessThan(SESSION_EXPIRES_IN_SECONDS);
  });

  it("caches for far less time than a session lasts", () => {
    // The window is how long a revoked session can still be honoured by a browser holding a
    // fresh snapshot. It has to be short enough that "signed out" means signed out to
    // somebody watching, which a cache anywhere near the lifetime would not be.
    expect(SESSION_COOKIE_CACHE_SECONDS).toBeLessThan(SESSION_UPDATE_AGE_SECONDS);
  });
});

describe("the options handed to the library", () => {
  it("carries the three values, and only those", () => {
    // The surface, pinned the way `auth.options.spec.ts` pins the outer one: an option
    // added here rather than in the issue that owns it fails this test.
    expect(sessionOptions()).toEqual({
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS },
    });
  });

  it("enables the cookie cache, which is the ≤ 1 query criterion", () => {
    // Named on its own because it is the one field whose *default* is the failure: with it
    // off the service still works, still passes every other test, and issues a session
    // lookup on every request in production.
    expect(sessionOptions()?.cookieCache?.enabled).toBe(true);
  });

  it("hands back a fresh object each time", () => {
    // The same rule `authOptions` follows: the caller owns what it is given, and a shared
    // literal is one caller's mutation reaching another caller's instance.
    const first = sessionOptions();
    const second = sessionOptions();

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

describe("the cookies", () => {
  it("names the library's session token cookie", () => {
    // Three things have to agree with this string: `openapi.yaml`'s `ouroSession` scheme,
    // `ouroboros-ui`'s client, and anybody reading a browser's cookie jar. It is the
    // library's default composed from its default prefix, restated so a change is visible.
    expect(SESSION_COOKIE).toBe("better-auth.session_token");
  });

  it("names the cache cookie beside it", () => {
    expect(SESSION_DATA_COOKIE).toBe("better-auth.session_data");
  });

  it("is not the cookie #33 issued, which is the whole breaking change", () => {
    // Stated as an assertion because the rename is what invalidates every live session at
    // the cut-over. If these were ever equal, a stale stateless cookie would be presented as
    // a BetterAuth token and the failure would be a decode error rather than a clean 401.
    expect(SESSION_COOKIE).not.toBe("ouro_session");
  });
});
