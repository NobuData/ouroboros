import { serializeCookie } from "./cookies";
import {
  isSessionPayload,
  issueSession,
  readSession,
  sessionCookieAttributes,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "./session";
import { epochSeconds, signToken } from "./signing";

/**
 * The session cookie: what it carries, how long it lasts, and what it is set with.
 *
 * `signing.spec.ts` already covers forgery. What is left here is the part specific to a
 * session — that the payload is an id rather than a copy of the person, that the lifetime
 * is the only bound on a stolen cookie and therefore not a week and a half, and that the
 * attributes the issue names are actually on the header.
 */

const SECRET = "a-development-signing-secret";
const USER = "5eed0003-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-11T10:20:23.114Z");

/**
 * A token of a different shape, signed with the same key.
 *
 * It was the OAuth handshake cookie until
 * [#702](https://github.com/NobuData/ouroboros/issues/702) deleted `oauth.ts`, and the
 * property it exercises outlives it: `OURO_SESSION_SECRET` signs whatever is handed to
 * `signToken`, so a valid signature says only that *this service* wrote the value — never
 * what it wrote it for. `isSessionPayload` is the second half of that check, and it is what
 * stops a token minted for one purpose from being spent as another.
 */
function otherShapedToken(now: Date): string {
  return signToken({ state: "s", verifier: "v", iat: epochSeconds(now) }, SECRET);
}

describe("a session token", () => {
  it("names the user and when it was issued, and nothing else", () => {
    // Not a copy of the person: a cookie carrying an email and a display name is a cache
    // with no invalidation, and a revoked membership in it would keep being honoured.
    expect(readSession(issueSession(USER, SECRET, NOW), { secret: SECRET, now: NOW })).toEqual({
      sub: USER,
      iat: epochSeconds(NOW),
    });
  });

  it("is refused once it is older than seven days", () => {
    const issued = new Date(NOW.getTime() - (SESSION_MAX_AGE_SECONDS + 1) * 1000);

    expect(
      readSession(issueSession(USER, SECRET, issued), { secret: SECRET, now: NOW }),
    ).toBeUndefined();
  });

  it("is still good the moment before that", () => {
    const issued = new Date(NOW.getTime() - (SESSION_MAX_AGE_SECONDS - 1) * 1000);

    expect(
      readSession(issueSession(USER, SECRET, issued), { secret: SECRET, now: NOW }),
    ).toBeDefined();
  });

  it("lasts a week — long enough to work through, short enough to bound a theft", () => {
    // A stateless session cannot be revoked, so this number is the *only* thing that ends
    // a copied cookie. It is a constant rather than a variable for that reason.
    expect(SESSION_MAX_AGE_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it("is refused when the cookie was not sent", () => {
    expect(readSession(undefined, { secret: SECRET, now: NOW })).toBeUndefined();
  });

  it("does not accept a token of another shape signed with the same key", () => {
    expect(readSession(otherShapedToken(NOW), { secret: SECRET, now: NOW })).toBeUndefined();
  });
});

describe("recognising a session payload", () => {
  it.each([
    ["a real one", { sub: USER, iat: 1 }, true],
    ["one with an empty subject", { sub: "", iat: 1 }, false],
    ["one with no subject", { iat: 1 }, false],
    ["one whose subject is not a string", { sub: 7, iat: 1 }, false],
    ["a payload of another shape", { state: "s", verifier: "v", iat: 1 }, false],
  ])("says %s is %s", (_description, payload, expected) => {
    expect(isSessionPayload(payload as never)).toBe(expected);
  });

  it("is what a valid signature is not, so a token minted elsewhere cannot be spent here", () => {
    // The signature says this service wrote the value; only the shape check says what it
    // wrote it *for*. That mattered while `oauth.ts` signed handshakes with the same key,
    // and it matters again the moment a second purpose is given to
    // `OURO_SESSION_SECRET` — so it is asserted rather than left to the absence of one.
    const wrongShape = otherShapedToken(NOW);

    expect(() => signToken({ sub: USER, iat: epochSeconds(NOW) }, SECRET)).not.toThrow();
    expect(readSession(wrongShape, { secret: SECRET, now: NOW })).toBeUndefined();
    expect(isSessionPayload({ state: "s", verifier: "v", iat: 1 } as never)).toBe(false);
  });
});

describe("the session cookie's attributes", () => {
  it("is HttpOnly, whatever the environment", () => {
    // The one attribute that is not conditional on anything: it is what stops a cross-site
    // scripting bug in the UI from being able to read a session at all.
    expect(sessionCookieAttributes(true).httpOnly).toBe(true);
    expect(sessionCookieAttributes(false).httpOnly).toBe(true);
  });

  it("is SameSite=Lax, so the OAuth callback still carries it", () => {
    // Strict would withhold the cookie on a top-level navigation from github.com, which is
    // exactly what the callback is — and every sign-in would fail on the last hop.
    expect(sessionCookieAttributes(false).sameSite).toBe("Lax");
  });

  it("is Secure in production and not in development", () => {
    expect(sessionCookieAttributes(true).secure).toBe(true);
    expect(sessionCookieAttributes(false).secure).toBe(false);
  });

  it("is sent for every path this service serves", () => {
    expect(sessionCookieAttributes(false).path).toBe("/");
  });

  it("lasts as long as the token it carries", () => {
    // A cookie that outlived its token would be a browser sending a value that can only be
    // refused; one that expired first would sign a person out early for no reason.
    expect(sessionCookieAttributes(false).maxAgeSeconds).toBe(SESSION_MAX_AGE_SECONDS);
  });

  it("produces the header a browser is meant to store", () => {
    const header = serializeCookie(SESSION_COOKIE, "token", sessionCookieAttributes(true));

    expect(header).toBe(
      "ouro_session=token; Max-Age=604800; Path=/; SameSite=Lax; HttpOnly; Secure",
    );
  });
});
