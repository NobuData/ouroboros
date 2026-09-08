/**
 * Row → resource, for the GitHub token surface.
 *
 * K.3 ([#101](https://github.com/NobuData/ouroboros/issues/101)). The row is the database's
 * (snake_case, `Date`s, a ciphertext); the resource is the contract's (camelCase, exactly
 * what `openapi.yaml`'s `GithubToken` schema promises) — and the ciphertext is not in it,
 * nor is anything derived from it beyond four characters and a prefix.
 *
 * **There is one mapper and it cannot be given a token.** {@link githubTokenResource} takes a
 * mask and a stamp, never a row and never a plaintext, so the only way to build this resource
 * is to have already reduced the credential to something safe to send. A mapper that took the
 * row would be a mapper one careless spread away from returning `token_encrypted`, and the
 * acceptance criterion — *the token is absent from every API response* — would then rest on
 * every future edit of this file rather than on its shape.
 *
 * **Absence is a state, not a 404.** A workspace with no token reads `configured: false` with
 * null stamps. The settings surface always has something to render, and the intake page's
 * no-token guidance (N.6, [#120](https://github.com/NobuData/ouroboros/issues/120)) is that
 * `false` rather than a missing resource it would have to interpret.
 */

/** What every route on this surface answers — the contract's `GithubToken` schema. */
export interface GithubTokenResource {
  /** Whether this workspace has a GitHub token stored. */
  readonly configured: boolean;
  /**
   * `ghp_••••abcd` — the prefix, four bullets, and the token's last four characters. Null
   * when nothing is stored.
   *
   * **This is the whole of what the API will ever say about a stored token.** The bullets are
   * drawn here rather than in the browser, for `provider-connections/masking.ts`'s reason:
   * a masked-in-the-page credential is a credential in the page's memory, in the network
   * tab, in the browser's cache and in every error report the page sends.
   */
  readonly masked: string | null;
  /** When the token was first stored, ISO 8601, or null when none is. */
  readonly createdAt: string | null;
  /**
   * When it was last written, ISO 8601, or null when none is.
   *
   * Past {@link createdAt} means it has been rotated at least once — which is the surface's
   * honest answer to *"is this still the token I set in March"* without a column that would
   * have to be maintained to say so.
   */
  readonly updatedAt: string | null;
}

/** The stamps a stored credential carries. */
export interface CredentialStamps {
  /** When the row was created. */
  readonly created_at: Date;
  /** When it was last written. */
  readonly updated_at: Date;
}

/**
 * The resource for a workspace that has a token.
 *
 * @param masked - The mask, from `maskToken`. Never a token, and this function cannot check
 *   that for you — which is why the only caller is the service that produced it two lines
 *   earlier from a buffer it then erased.
 * @param stamps - The stored row's timestamps.
 * @returns The resource.
 */
export function githubTokenResource(masked: string, stamps: CredentialStamps): GithubTokenResource {
  return {
    configured: true,
    masked,
    createdAt: stamps.created_at.toISOString(),
    updatedAt: stamps.updated_at.toISOString(),
  };
}

/**
 * The resource for a workspace with no token.
 *
 * A constant rather than a builder: there is exactly one way to have no token, and a function
 * would invite a second.
 *
 * @returns The resource — `configured: false` and nothing else to say.
 */
export function noGithubToken(): GithubTokenResource {
  return { configured: false, masked: null, createdAt: null, updatedAt: null };
}
