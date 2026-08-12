import { createHmac } from "node:crypto";

import { epochSeconds, readToken, signToken, TOKEN_SEPARATOR, type Issued } from "./signing";

/**
 * The signature, and every way a token can fail to be one.
 *
 * This is the file where a mistake is worth the most to an attacker: everything above it —
 * the session cookie, and #33's OAuth handshake until #702 deleted it — is a payload
 * wrapped in whatever this promises. So the suite is written as a list of forgeries rather
 * than as a round trip, and the round trip is one test at the top.
 */

const SECRET = "a-development-signing-secret";
const OTHER_SECRET = "a-different-signing-secret";
const NOW = new Date("2026-08-11T10:20:23.114Z");
const HOUR = 60 * 60;

/** A payload with one field of its own, so shape rejection has something to reject. */
interface Payload extends Issued {
  sub: string;
}

/** Accepts anything carrying a string `sub`. */
function isPayload(payload: Issued): payload is Payload {
  return typeof (payload as Payload).sub === "string";
}

/** The terms every test below reads a token under, unless it is testing one of them. */
function terms(overrides: Partial<{ secret: string; maxAgeSeconds: number; now: Date }> = {}) {
  return { secret: SECRET, maxAgeSeconds: HOUR, now: NOW, ...overrides };
}

/** A token signed now, for the given subject. */
function tokenFor(sub: string, at: Date = NOW, secret: string = SECRET): string {
  return signToken({ sub, iat: epochSeconds(at) } satisfies Payload, secret);
}

describe("epochSeconds", () => {
  it("is whole seconds, not milliseconds", () => {
    expect(epochSeconds(NOW)).toBe(Math.floor(NOW.getTime() / 1000));
    expect(Number.isInteger(epochSeconds(NOW))).toBe(true);
  });

  it("rounds down, so a token is never dated in the future by a millisecond", () => {
    expect(epochSeconds(new Date(1_775_000_000_999))).toBe(1_775_000_000);
  });
});

describe("a token this service signed", () => {
  it("reads back as the payload it was given", () => {
    const payload = readToken(tokenFor("ada"), terms(), isPayload);

    expect(payload).toEqual({ sub: "ada", iat: epochSeconds(NOW) });
  });

  it("is payload and signature, separated by a dot", () => {
    const parts = tokenFor("ada").split(TOKEN_SEPARATOR);

    expect(parts).toHaveLength(2);
    expect(parts[0]).not.toBe("");
    expect(parts[1]).not.toBe("");
  });

  it("is base64url, so it survives a cookie and a URL unencoded", () => {
    // `+`, `/` and `=` are what would need escaping. base64url uses none of them.
    expect(tokenFor("ada")).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("carries the payload in the clear, deliberately", () => {
    // Signed, not encrypted: the browser holding it is entitled to know its own user id,
    // and pretending otherwise would hide the one thing worth reading in a bug report.
    const [body] = tokenFor("ada").split(TOKEN_SEPARATOR);

    expect(JSON.parse(Buffer.from(body, "base64url").toString("utf8"))).toEqual({
      sub: "ada",
      iat: epochSeconds(NOW),
    });
  });

  it("signs two different payloads differently", () => {
    expect(tokenFor("ada")).not.toBe(tokenFor("grace"));
  });
});

describe("a token that is not this service's", () => {
  it("is refused when it was never sent at all", () => {
    expect(readToken(undefined, terms(), isPayload)).toBeUndefined();
  });

  it("is refused when the payload was edited", () => {
    const [, signature] = tokenFor("ada").split(TOKEN_SEPARATOR);
    const forged = Buffer.from(JSON.stringify({ sub: "root", iat: epochSeconds(NOW) })).toString(
      "base64url",
    );

    expect(readToken(`${forged}.${signature}`, terms(), isPayload)).toBeUndefined();
  });

  it("is refused when the signature was edited", () => {
    const [body, signature] = tokenFor("ada").split(TOKEN_SEPARATOR);
    const flipped = signature.startsWith("A") ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;

    expect(readToken(`${body}.${flipped}`, terms(), isPayload)).toBeUndefined();
  });

  it("is refused when it carries no signature at all", () => {
    const [body] = tokenFor("ada").split(TOKEN_SEPARATOR);

    expect(readToken(body, terms(), isPayload)).toBeUndefined();
    expect(readToken(`${body}.`, terms(), isPayload)).toBeUndefined();
    expect(readToken(`.${body}`, terms(), isPayload)).toBeUndefined();
  });

  it("is refused when it was signed with a different key — which is how a rotation ends every session", () => {
    expect(readToken(tokenFor("ada", NOW, OTHER_SECRET), terms(), isPayload)).toBeUndefined();
  });

  it.each([
    ["empty", ""],
    ["a dot on its own", "."],
    ["not base64url", "not a token"],
    ["base64url that is not JSON", `${Buffer.from("nonsense").toString("base64url")}.x`],
  ])("is refused when it is %s", (_description, token) => {
    expect(readToken(token, terms(), isPayload)).toBeUndefined();
  });

  it("never lets an unverified string reach the JSON parser", () => {
    // A body that would throw on parse, with a signature that does not match it: if the
    // order were the other way round, this would be an exception rather than `undefined`,
    // and that parser would be reachable by anyone with a browser.
    const body = Buffer.from("{ not json").toString("base64url");

    expect(() => readToken(`${body}.wrong`, terms(), isPayload)).not.toThrow();
  });
});

describe("a token that is genuine and no longer good", () => {
  it("is refused once it is older than the maximum age", () => {
    const issued = new Date(NOW.getTime() - (HOUR + 1) * 1000);

    expect(readToken(tokenFor("ada", issued), terms(), isPayload)).toBeUndefined();
  });

  it("is accepted at exactly the maximum age", () => {
    const issued = new Date(NOW.getTime() - HOUR * 1000);

    expect(readToken(tokenFor("ada", issued), terms(), isPayload)).toBeDefined();
  });

  it("is refused when it was issued in the future", () => {
    // A clock that moved backwards, or a key shared with a host whose clock is wrong.
    // Treating it as fresh would be treating it as having no lifetime at all.
    const issued = new Date(NOW.getTime() + 60_000);

    expect(readToken(tokenFor("ada", issued), terms(), isPayload)).toBeUndefined();
  });
});

describe("a token of the wrong shape", () => {
  it("is refused even with a perfect signature", () => {
    // The case this exists for: two cookies signed with one key, and one replayed where
    // the other is expected. The signature is real; the fields are somebody else's.
    const wrongShape = signToken({ state: "x", iat: epochSeconds(NOW) } as never, SECRET);

    expect(readToken(wrongShape, terms(), isPayload)).toBeUndefined();
  });

  it.each([
    ["a payload that is not an object", JSON.stringify("ada")],
    ["a payload with no iat", JSON.stringify({ sub: "ada" })],
    ["a payload whose iat is a string", JSON.stringify({ sub: "ada", iat: "now" })],
    ["a payload whose iat is not finite", JSON.stringify({ sub: "ada", iat: null })],
  ])("is refused for %s", (_description, json) => {
    // Genuinely signed, so the only thing wrong with it is its shape. The HMAC is computed
    // here rather than taken from `signToken`, which will not serialise a payload this
    // malformed — which is the point: the rejection has to happen on the way *in*.
    expect(readToken(sign(json), terms(), isPayload)).toBeUndefined();
  });
});

/**
 * Sign an arbitrary body the way this module does.
 *
 * @param json - The payload, already serialised — including in ways `signToken` would not
 *   produce.
 * @returns A token whose signature is correct.
 */
function sign(json: string): string {
  const body = Buffer.from(json, "utf8").toString("base64url");
  const signature = createHmac("sha256", SECRET).update(body).digest("base64url");

  return `${body}${TOKEN_SEPARATOR}${signature}`;
}
