/**
 * The active workspace: how it is named on the wire, where it is kept, and what a valid
 * reference to one looks like.
 *
 * A request to `ouroboros-rest` says which workspace it means with the `X-Ouro-Tenant`
 * header, carrying either a slug (`acme`) or a uuid — the contract accepts both, because
 * a slug is what a person types (`ouroboros-rest/openapi.yaml` §
 * `components.parameters.TenantHeader`). Operations with a `{tenantId}` in the path do not
 * need it; the ones without it — and everything the epic adds after this — do, unless the
 * caller belongs to exactly one workspace.
 *
 * Everything here is framework-free so that the same constants drive three things that
 * must not disagree: the client that sends the header ({@link file://./client.ts}), the
 * server-side store that reads it from a cookie ({@link file://./server.ts}), and the
 * tests. The store's *reads and writes* live in `server.ts` because they touch
 * `next/headers`; the vocabulary lives here because nothing about it is server-only.
 *
 * The choice is persisted as a cookie rather than in `localStorage` for one reason: it is
 * read while a Server Component renders, which is where every call to the API is made
 * (see `server.ts`). Nothing on the server can read `localStorage`, so a choice kept
 * there would be a choice the first render cannot honour.
 *
 * Selecting a workspace is [#44](https://github.com/NobuData/ouroboros/issues/44)'s
 * screen; this is the store it writes into.
 */

/** The header naming the workspace a request operates in. */
export const TENANT_HEADER = "X-Ouro-Tenant";

/**
 * The cookie holding the active workspace between requests.
 *
 * `ouro_` prefixed like `ouro_session`, and named for what it is rather than for the
 * header it becomes, because the header is one of the things read from it.
 */
export const ACTIVE_TENANT_COOKIE = "ouro_tenant";

/**
 * The longest reference the contract accepts, in characters.
 *
 * `openapi.yaml` says `maxLength: 63` — the length of a DNS label, which is what a slug
 * has to be able to become.
 */
export const TENANT_REFERENCE_MAX_LENGTH = 63;

/**
 * What a workspace reference may contain: letters, digits and hyphens.
 *
 * Wide enough for both forms the contract accepts — a slug is lower-case letters, digits
 * and single hyphens; a uuid is hex and hyphens — and narrow enough to be a **safety
 * property**, not a convenience. This value arrives from a cookie, and a cookie is
 * whatever the browser was last given, so it is untrusted input on its way into an HTTP
 * header. A value carrying CR or LF would be a header-injection attempt and a value
 * carrying anything else would be rejected by the service anyway; refusing it here is
 * what makes the round trip impossible rather than merely unproductive.
 *
 * Validating rather than *escaping* is deliberate: there is no escape sequence in a
 * header value, and a client that silently rewrote what it was given would send a
 * request naming a workspace nobody chose.
 */
const TENANT_REFERENCE_PATTERN = /^[A-Za-z0-9-]+$/;

/**
 * Whether a string is a workspace reference this client is willing to send.
 *
 * @param value A candidate slug or uuid.
 * @returns `true` when it is non-empty, within the contract's length limit, and made only
 *   of letters, digits and hyphens.
 */
export function isTenantReference(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= TENANT_REFERENCE_MAX_LENGTH &&
    TENANT_REFERENCE_PATTERN.test(value)
  );
}

/**
 * Check a workspace reference on its way into a header or a cookie.
 *
 * @param value A candidate slug or uuid.
 * @returns The value, unchanged.
 * @throws {Error} If it is not a reference {@link isTenantReference} accepts. The message
 *   quotes the length rather than the value: this runs on rejected input, and a rejected
 *   value is the last thing to interpolate into a string that may reach a log.
 */
export function assertTenantReference(value: string): string {
  if (!isTenantReference(value)) {
    throw new Error(
      `${TENANT_HEADER} must be a workspace slug or uuid — letters, digits and hyphens, ` +
        `1 to ${TENANT_REFERENCE_MAX_LENGTH} characters; got ${value.length} character(s) ` +
        `that do not match.`,
    );
  }
  return value;
}
