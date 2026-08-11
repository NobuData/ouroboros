import {
  EXPIRED_MAX_AGE,
  expireCookie,
  parseCookies,
  serializeCookie,
  type CookieAttributes,
} from "./cookies";

/**
 * Reading and writing cookie headers.
 *
 * Small enough to be tempting to trust, and two of its behaviours are load-bearing: a
 * header that is odd must not throw — a browser sends whatever it is holding, and a
 * `URIError` escaping a parser is a `500` on a request that should have been a `401` — and
 * an attribute must not be droppable, because `HttpOnly` on the session cookie is the
 * single most valuable thing in this module.
 */

/** The attributes the session cookie really uses, as a fixture for the writing tests. */
const ATTRIBUTES: CookieAttributes = {
  maxAgeSeconds: 604_800,
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
};

describe("reading a Cookie header", () => {
  it("finds a single pair", () => {
    expect(parseCookies("ouro_session=abc")).toEqual(new Map([["ouro_session", "abc"]]));
  });

  it("finds every pair, whatever the spacing", () => {
    const cookies = parseCookies("a=1; b=2;c=3 ;  d=4");

    expect(Object.fromEntries(cookies)).toEqual({ a: "1", b: "2", c: "3", d: "4" });
  });

  it("keeps a value that contains the token separator", () => {
    // Every value this service sets is `payload.signature`, so a parser that split on the
    // dot would return half a token and every session would fail to verify.
    expect(parseCookies("ouro_session=body.signature").get("ouro_session")).toBe("body.signature");
  });

  it("decodes percent-encoding, undoing what the writer applied", () => {
    expect(parseCookies("x=a%20b").get("x")).toBe("a b");
  });

  it("unwraps a quoted value, which some clients add", () => {
    expect(parseCookies('x="quoted"').get("x")).toBe("quoted");
  });

  it("keeps the first of two cookies with one name", () => {
    // RFC 6265 sends the most specific first, so when a browser holds a host-only cookie
    // and a domain-wide one of the same name, the first is the one this service set.
    expect(parseCookies("x=host; x=domain").get("x")).toBe("host");
  });

  it.each([
    ["no header at all", undefined],
    ["an empty header", ""],
    ["a header with no pairs", "; ;"],
    ["a pair with no name", "=value"],
    ["a pair with no equals sign", "novalue"],
  ])("answers with nothing for %s", (_description, header) => {
    expect(parseCookies(header)).toEqual(new Map());
  });

  it("keeps the readable pairs when another is malformed", () => {
    // A browser sends every cookie for the origin, including ones no part of this system
    // set. One of them being odd is not this request's problem.
    expect(parseCookies("broken; ouro_session=abc").get("ouro_session")).toBe("abc");
  });

  it("does not throw on invalid percent-encoding", () => {
    // `decodeURIComponent("%")` is a URIError. The value is about to fail a signature
    // check anyway; throwing here would turn a 401 into a 500.
    expect(() => parseCookies("x=%")).not.toThrow();
    expect(parseCookies("x=%").get("x")).toBe("%");
  });

  it("reads back exactly what serializeCookie wrote", () => {
    const header = serializeCookie("ouro_session", "body.signature", ATTRIBUTES);
    const value = header.slice(0, header.indexOf(";"));

    expect(parseCookies(value).get("ouro_session")).toBe("body.signature");
  });
});

describe("writing a Set-Cookie header", () => {
  it("carries the name, the value and every attribute", () => {
    const header = serializeCookie("ouro_session", "token", ATTRIBUTES);

    expect(header).toBe(
      "ouro_session=token; Max-Age=604800; Path=/; SameSite=Lax; HttpOnly; Secure",
    );
  });

  it("omits HttpOnly and Secure when they are off, rather than writing them false", () => {
    const header = serializeCookie("x", "y", { ...ATTRIBUTES, httpOnly: false, secure: false });

    expect(header).not.toContain("HttpOnly");
    expect(header).not.toContain("Secure");
  });

  it("leaves Secure off in development, where the transport is plain HTTP on loopback", () => {
    expect(serializeCookie("x", "y", { ...ATTRIBUTES, secure: false })).not.toContain("Secure");
  });

  it("percent-encodes the value, so it cannot inject an attribute", () => {
    const header = serializeCookie("x", "a; HttpOnly=no; b", ATTRIBUTES);

    // One `;` per real attribute, and none from the value.
    expect(header.startsWith("x=a%3B%20HttpOnly%3Dno%3B%20b;")).toBe(true);
  });

  it("uses Max-Age rather than Expires, so a wrong browser clock cannot shorten a session", () => {
    expect(serializeCookie("x", "y", ATTRIBUTES)).not.toContain("Expires");
  });
});

describe("removing a cookie", () => {
  it("sends an empty value with Max-Age=0", () => {
    const header = expireCookie("ouro_session", ATTRIBUTES);

    expect(header).toContain("ouro_session=;");
    expect(header).toContain(`Max-Age=${EXPIRED_MAX_AGE}`);
    expect(EXPIRED_MAX_AGE).toBe(0);
  });

  it("repeats the attributes it was set with", () => {
    // A browser treats a differing Path as a different cookie and leaves the original in
    // place — so a logout that guessed the path would answer 204 and sign nobody out.
    const header = expireCookie("ouro_session", ATTRIBUTES);

    expect(header).toContain("Path=/");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
  });
});
