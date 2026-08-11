import { serializeCookie } from "./cookies";
import { isHandshakePayload, issueHandshake } from "./oauth";
import {
  isSessionPayload,
  issueSession,
  readSession,
  sessionCookieAttributes,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "./session";
import { epochSeconds } from "./signing";

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

  it("does not accept a handshake cookie, which is signed with the same key", () => {
    const handshake = issueHandshake({ state: "s", verifier: "v" }, SECRET, NOW);

    expect(readSession(handshake, { secret: SECRET, now: NOW })).toBeUndefined();
  });
});

describe("recognising a session payload", () => {
  it.each([
    ["a real one", { sub: USER, iat: 1 }, true],
    ["one with an empty subject", { sub: "", iat: 1 }, false],
    ["one with no subject", { iat: 1 }, false],
    ["one whose subject is not a string", { sub: 7, iat: 1 }, false],
    ["a handshake", { state: "s", verifier: "v", iat: 1 }, false],
  ])("says %s is %s", (_description, payload, expected) => {
    expect(isSessionPayload(payload as never)).toBe(expected);
  });

  it("is the mirror of the handshake's own check, so neither accepts the other", () => {
    const session = { sub: USER, iat: 1 };
    const handshake = { state: "s", verifier: "v", iat: 1 };

    expect(isSessionPayload(session)).toBe(true);
    expect(isHandshakePayload(session as never)).toBe(false);
    expect(isSessionPayload(handshake as never)).toBe(false);
    expect(isHandshakePayload(handshake)).toBe(true);
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
