import { createHash } from "node:crypto";

import {
  authorizeUrl,
  callbackUrl,
  codeChallenge,
  GITHUB_AUTHORIZE_URL,
  GITHUB_SCOPES,
  handshakeCookieAttributes,
  HANDSHAKE_COOKIE_PATH,
  HANDSHAKE_MAX_AGE_SECONDS,
  isHandshakePayload,
  issueHandshake,
  randomHandshakeValue,
  readHandshake,
} from "./oauth";
import { issueSession } from "./session";

/**
 * The handshake — the part of sign-in that decides whether a callback is real.
 *
 * Two properties are worth more than the rest of this file put together: the `state` and
 * the verifier must be unguessable, and a session cookie must not be usable as a handshake.
 * Both are asserted directly.
 */

const SECRET = "a-development-signing-secret";
const NOW = new Date("2026-08-11T10:20:23.114Z");

describe("the random values", () => {
  it("are different every time", () => {
    const values = new Set(Array.from({ length: 64 }, () => randomHandshakeValue()));

    expect(values.size).toBe(64);
  });

  it("are 32 bytes of entropy by default", () => {
    // base64url of 32 bytes is 43 characters with no padding. The number is the point:
    // this value is the whole of what an attacker composing a callback must not guess.
    expect(randomHandshakeValue()).toHaveLength(43);
  });

  it("are URL-safe, so they survive a query string and a cookie unencoded", () => {
    expect(randomHandshakeValue()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("the PKCE challenge", () => {
  it("is the SHA-256 of the verifier, base64url — the S256 method", () => {
    const verifier = "a-verifier";

    expect(codeChallenge(verifier)).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("does not reveal the verifier", () => {
    const verifier = randomHandshakeValue();

    expect(codeChallenge(verifier)).not.toContain(verifier);
  });

  it("is stable, so the exchange can present the verifier the redirect committed to", () => {
    expect(codeChallenge("x")).toBe(codeChallenge("x"));
  });
});

describe("the authorize URL", () => {
  const url = (): URL =>
    new URL(
      authorizeUrl({
        clientId: "client-id",
        redirectUri: "http://localhost:4000/api/v1/auth/github/callback",
        state: "the-state",
        challenge: "the-challenge",
      }),
    );

  it("is GitHub's own authorize endpoint", () => {
    expect(url().origin + url().pathname).toBe(GITHUB_AUTHORIZE_URL);
    expect(GITHUB_AUTHORIZE_URL).toBe("https://github.com/login/oauth/authorize");
  });

  it("carries nothing beyond the six parameters the flow needs", () => {
    // An extra parameter here is a decision made on a person's behalf on a consent screen.
    expect([...url().searchParams.keys()].sort()).toEqual([
      "client_id",
      "code_challenge",
      "code_challenge_method",
      "redirect_uri",
      "scope",
      "state",
    ]);
  });

  it("carries the client id, the state and the S256 challenge", () => {
    const parameters = url().searchParams;

    expect(parameters.get("client_id")).toBe("client-id");
    expect(parameters.get("state")).toBe("the-state");
    expect(parameters.get("code_challenge")).toBe("the-challenge");
    expect(parameters.get("code_challenge_method")).toBe("S256");
  });

  it("asks for read:user and user:email, and nothing else", () => {
    // Every additional scope is something a person is asked to grant on the consent screen
    // and something this service is then trusted not to misuse. Repository access belongs
    // to the GitHub App installation flow, not to signing in.
    expect(url().searchParams.get("scope")).toBe("read:user user:email");
    expect([...GITHUB_SCOPES]).toEqual(["read:user", "user:email"]);
  });

  it("encodes the redirect URI rather than concatenating it", () => {
    expect(url().searchParams.get("redirect_uri")).toBe(
      "http://localhost:4000/api/v1/auth/github/callback",
    );
  });
});

describe("the callback URL", () => {
  it("is built from configuration, not from a request header", () => {
    // A `Host` header is attacker-controlled, and a callback URL taken from one is how an
    // authorization code ends up delivered somewhere else.
    expect(callbackUrl("http://localhost:4000", "/api/v1")).toBe(
      "http://localhost:4000/api/v1/auth/github/callback",
    );
  });

  it("is the same string for any caller, because GitHub compares the two it is given", () => {
    expect(callbackUrl("https://api.example", "/api/v1")).toBe(
      callbackUrl("https://api.example", "/api/v1"),
    );
  });
});

describe("a handshake token", () => {
  it("carries the state and the verifier", () => {
    const token = issueHandshake({ state: "s", verifier: "v" }, SECRET, NOW);

    expect(readHandshake(token, { secret: SECRET, now: NOW })).toMatchObject({
      state: "s",
      verifier: "v",
    });
  });

  it("is refused once the browser has taken longer than ten minutes", () => {
    const issued = new Date(NOW.getTime() - (HANDSHAKE_MAX_AGE_SECONDS + 1) * 1000);
    const token = issueHandshake({ state: "s", verifier: "v" }, SECRET, issued);

    expect(readHandshake(token, { secret: SECRET, now: NOW })).toBeUndefined();
    expect(HANDSHAKE_MAX_AGE_SECONDS).toBe(600);
  });

  it("is refused when the cookie was not sent — which is what a fabricated callback looks like", () => {
    expect(readHandshake(undefined, { secret: SECRET, now: NOW })).toBeUndefined();
  });

  it("does not accept a session cookie, which is signed with the same key", () => {
    const session = issueSession("5eed0003-0000-4000-8000-000000000001", SECRET, NOW);

    expect(readHandshake(session, { secret: SECRET, now: NOW })).toBeUndefined();
  });

  it.each([
    ["a real one", { state: "s", verifier: "v", iat: 1 }, true],
    ["one with no verifier", { state: "s", iat: 1 }, false],
    ["one with no state", { verifier: "v", iat: 1 }, false],
    ["one with an empty state", { state: "", verifier: "v", iat: 1 }, false],
  ])("recognises %s as %s", (_description, payload, expected) => {
    expect(isHandshakePayload(payload as never)).toBe(expected);
  });
});

describe("the handshake cookie's attributes", () => {
  it("is HttpOnly, so script cannot read the state it is about to be checked against", () => {
    expect(handshakeCookieAttributes(false).httpOnly).toBe(true);
  });

  it("is SameSite=Lax, which is what lets the callback carry it at all", () => {
    expect(handshakeCookieAttributes(false).sameSite).toBe("Lax");
  });

  it("is scoped to the auth routes, so it rides no other request", () => {
    expect(handshakeCookieAttributes(false).path).toBe(HANDSHAKE_COOKIE_PATH);
    expect(HANDSHAKE_COOKIE_PATH).toBe("/api/v1/auth");
  });

  it("is Secure in production and not in development", () => {
    expect(handshakeCookieAttributes(true).secure).toBe(true);
    expect(handshakeCookieAttributes(false).secure).toBe(false);
  });

  it("lasts as long as the handshake it carries", () => {
    expect(handshakeCookieAttributes(false).maxAgeSeconds).toBe(HANDSHAKE_MAX_AGE_SECONDS);
  });
});
