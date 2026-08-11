/**
 * Reading a `Cookie` header and writing a `Set-Cookie` one, without a dependency.
 *
 * The issue asks for this module to be light — *bare `fetch`, no passport* — and the same
 * argument applies one layer down. `cookie-parser` is middleware that parses every header
 * on every request into an object most handlers never read; this service sets exactly two
 * cookies and reads exactly two, and the whole of what it needs is below. Writing it here
 * also means the attributes that matter are named in one place with the reasons attached,
 * rather than being options passed to somebody else's serialiser.
 *
 * What it deliberately does not do: signing. A cookie's *value* is signed by
 * `signing.ts` before it ever reaches this file, so nothing here has to know a secret,
 * and a bug here cannot forge one.
 *
 * The grammar handled is RFC 6265's, minus the parts a server never has to read: this
 * parses `name=value` pairs separated by `; `, and ignores anything malformed rather than
 * failing, because a browser will happily send third-party cookies this service has never
 * heard of and one of them being odd is not this request's problem.
 */

/** How the pairs in a `Cookie` header are separated. */
const PAIR_SEPARATOR = ";";

/** What a cookie is sent back with when it is being cleared. */
export const EXPIRED_MAX_AGE = 0;

/** `SameSite` values this service uses. */
export type SameSite = "Lax" | "Strict" | "None";

/** The attributes a `Set-Cookie` header may carry here. */
export interface CookieAttributes {
  /**
   * How long the browser should keep it, in seconds. `0` deletes it.
   *
   * `Max-Age` rather than `Expires`: it is relative, so it does not depend on the
   * browser's clock agreeing with the server's — and a laptop with a wrong clock is a
   * session that ends immediately or never.
   */
  maxAgeSeconds: number;
  /** The path prefix it is sent for. Always set explicitly; see {@link serializeCookie}. */
  path: string;
  /** Whether script can read it. Always `true` here. */
  httpOnly: boolean;
  /** Whether it travels over plain HTTP. False only in development. */
  secure: boolean;
  /** Whether it travels on cross-site requests. */
  sameSite: SameSite;
}

/**
 * Parse a `Cookie` header.
 *
 * @param header - The header, or `undefined` when the browser sent none.
 * @returns One entry per readable pair. A later duplicate does not replace an earlier one:
 *   RFC 6265 says the most specific cookie is sent first, so when a browser holds both a
 *   host-only and a domain-wide cookie of the same name, the first is the one this service
 *   set for itself.
 */
export function parseCookies(header: string | undefined): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>();

  if (header === undefined || header === "") {
    return cookies;
  }

  for (const pair of header.split(PAIR_SEPARATOR)) {
    const equals = pair.indexOf("=");
    if (equals <= 0) {
      continue;
    }

    const name = pair.slice(0, equals).trim();
    const value = pair.slice(equals + 1).trim();

    if (name === "" || cookies.has(name)) {
      continue;
    }

    cookies.set(name, decodeValue(value));
  }

  return cookies;
}

/**
 * Undo the encoding {@link serializeCookie} applied.
 *
 * @param value - The raw value from the header, quotes and all.
 * @returns The decoded value. A percent sequence that is not valid encoding is left as it
 *   arrived rather than throwing — the value is about to fail a signature check anyway,
 *   and a `URIError` escaping a header parser is a `500` on a request that should be a
 *   `401`.
 */
function decodeValue(value: string): string {
  const unquoted = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;

  try {
    return decodeURIComponent(unquoted);
  } catch {
    return unquoted;
  }
}

/**
 * Render a `Set-Cookie` header.
 *
 * Every attribute is required rather than defaulted, and that is the point of the type: a
 * cookie holding a session is exactly the object whose `httpOnly` should never be left to
 * a default somebody can change later, and `path` decides which requests carry it at all.
 * The two call sites each state all five, so what a cookie is is readable where it is set.
 *
 * @param name - The cookie's name.
 * @param value - Its value, normally a token from `signing.ts`. Percent-encoded, so a
 *   value carrying a separator cannot inject an attribute.
 * @param attributes - See {@link CookieAttributes}.
 * @returns The header value.
 */
export function serializeCookie(name: string, value: string, attributes: CookieAttributes): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${attributes.maxAgeSeconds}`,
    `Path=${attributes.path}`,
    `SameSite=${attributes.sameSite}`,
  ];

  if (attributes.httpOnly) {
    parts.push("HttpOnly");
  }

  if (attributes.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

/**
 * Render the header that removes a cookie.
 *
 * `Max-Age=0` with an empty value. The attributes have to match the ones it was set with —
 * a browser treats a differing `Path` as a different cookie and leaves the original in
 * place — which is why this takes them rather than assuming.
 *
 * @param name - The cookie to remove.
 * @param attributes - The attributes it was set with. `maxAgeSeconds` is ignored.
 * @returns The header value.
 */
export function expireCookie(name: string, attributes: CookieAttributes): string {
  return serializeCookie(name, "", { ...attributes, maxAgeSeconds: EXPIRED_MAX_AGE });
}
