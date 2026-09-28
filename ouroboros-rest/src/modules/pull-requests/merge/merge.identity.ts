/**
 * Who a merge is recorded as — identity honesty, decision **V3**.
 *
 * AX.4 ([#360](https://github.com/NobuData/ouroboros/issues/360)). Mockup 12's footer promises
 * *"Merges as `ouroboros-app[bot]`"*, but until the GitHub App exists (AZ.4,
 * [#374](https://github.com/NobuData/ouroboros/issues/374)) every merge is made with the workspace's
 * configured token, which belongs to a real person. `merged_result.identity_used` records who the
 * host says merged — the token's owner — and V058's `pr_merge_plans_identity_not_bot` refuses any
 * `[bot]` claim while merges are token-based.
 *
 * So the rule here is the schema's, applied before the write rather than discovered by it:
 *
 * ```
 * host says ken-s              → "ken-s"
 * host says nothing            → "configured token"      the host did not name the merger
 * host says some-app[bot]      → "configured token"      a token-based merge cannot be a bot's
 * ```
 *
 * A `[bot]` answer from a token-based merge would mean the host attributed our merge to an App we
 * do not have — recording it would be the lie V3 forbids, and the CHECK would refuse it after the
 * merge had already landed. The fallback names what is certainly true.
 *
 * Pure.
 */

/** What is recorded when the host's answer cannot be. */
export const TOKEN_IDENTITY = "configured token";

/** The longest identity V058 stores. */
export const MAX_IDENTITY = 255;

/**
 * Whether an identity claims to be a bot — V058's `position('[bot]' in lower(identity))`.
 *
 * @param identity - A host login.
 * @returns `true` for any `[bot]`, in any case.
 */
export function claimsBot(identity: string): boolean {
  return identity.toLowerCase().includes("[bot]");
}

/**
 * The identity a token-based merge is recorded as.
 *
 * @param mergedBy - The login the host reports merged the PR, or null.
 * @returns The login, trimmed and bounded — or {@link TOKEN_IDENTITY} when it is missing, blank or
 *   a `[bot]` claim.
 */
export function identityUsed(mergedBy: string | null): string {
  const login = (mergedBy ?? "").trim();

  if (login === "" || claimsBot(login)) {
    return TOKEN_IDENTITY;
  }

  return login.slice(0, MAX_IDENTITY);
}
