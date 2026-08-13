/**
 * How a workspace is named on the wire, and what a valid reference to one looks like.
 *
 * A request to `ouroboros-rest` may say which workspace it means with the `X-Ouro-Tenant`
 * header, carrying either a slug (`acme`) or an id — the contract accepts both, because
 * a slug is what a person types (`ouroboros-rest/openapi.yaml` §
 * `components.parameters.TenantHeader`).
 *
 * **Nothing in this application sends it since
 * [#719](https://github.com/NobuData/ouroboros/issues/719).** The header is an *override* of
 * the session's active organization ([#713](https://github.com/NobuData/ouroboros/issues/713))
 * rather than the way a request names a workspace, and an override this application never
 * means to exercise is one it should not be sending — `app/api/server.ts` says what a stale
 * one costs. `app/api/client.ts` keeps the capability, and this is the vocabulary it would
 * use.
 *
 * Everything here is framework-free so that the same constants drive three things that
 * must not disagree: the client that *can* send the header ({@link file://./client.ts}), the
 * server-side cookie that carries a workspace reference ({@link file://./server.ts}), and the
 * tests. The reads and writes live in `server.ts` because they touch `next/headers`; the
 * vocabulary lives here because nothing about it is server-only.
 *
 * {@link isTenantReference} still guards a real boundary in both places: a value on its way
 * into an HTTP header, and a value on its way into a cookie this application writes.
 */

/** The header naming the workspace a request operates in. */
export const TENANT_HEADER = "X-Ouro-Tenant";

/**
 * The cookie carrying a workspace reference between requests.
 *
 * `ouro_` prefixed like `ouro_session`. It held the *active* workspace until
 * [#719](https://github.com/NobuData/ouroboros/issues/719) and is a note about the login
 * flow now — see `app/api/server.ts`'s `workspaceHint`, which is the only thing that reads
 * it. The name is unchanged because it is a value already in browsers, and renaming it would
 * ask every one of them to be asked step 2 again for nothing.
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
