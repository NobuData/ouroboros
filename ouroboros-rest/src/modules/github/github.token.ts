/**
 * What a GitHub token looks like, and the only thing this product will say about one out
 * loud.
 *
 * K.3 ([#101](https://github.com/NobuData/ouroboros/issues/101)). Two jobs, and they are
 * here together because they are the same knowledge: the prefixes GitHub issues its tokens
 * under are what {@link classifyToken} recognises on the way in, and what
 * {@link maskToken} keeps visible on the way out.
 *
 * ---------------------------------------------------------------------------
 * **Why the shape is checked at all.**
 *
 * The service could accept any non-empty string and let GitHub decide. It does not, because
 * the failure that check catches is not a forged token — it is a **paste error**, and a
 * paste error is the single most likely thing to arrive at this endpoint. An administrator
 * who pastes a repository URL, an org name, their own username, or a token with a newline
 * and half a shell prompt attached gets a `422` naming the field, immediately, instead of a
 * credential that is stored, encrypted, and then fails every sync from now on with a `401`
 * the intake page has to render as *"sync paused (unauthorized)"*. The second outcome is
 * indistinguishable from a revoked token, which is the thing this check buys: **a stored
 * credential that does not work is a real state, and it should only ever mean the token
 * stopped working, never that it was never a token.**
 *
 * ---------------------------------------------------------------------------
 * **Why legacy tokens are accepted, and stated rather than assumed.**
 *
 * GitHub has issued prefixed tokens since 2021, and {@link TOKEN_PREFIXES} is that list. It
 * is not the whole population: a classic token minted before the change is forty
 * lowercase hexadecimal characters with no prefix, those were never invalidated, and an
 * installation with one still working is an installation whose administrator would be told
 * their own credential is not a credential. So {@link LEGACY_TOKEN} admits them, narrowly —
 * forty characters, hex, anchored — which is specific enough that none of the paste errors
 * above can pass as one.
 *
 * The cost of the check is the case it cannot know about: a prefix GitHub introduces after
 * this file was written is refused until this list grows. That is a one-line change made by
 * whoever hits it, and it is the trade this file chooses deliberately — a refusal that
 * names the field beats a credential that is quietly wrong.
 *
 * ---------------------------------------------------------------------------
 * **The mask keeps the prefix, and `provider-connections`' does not.**
 *
 * `provider-connections/masking.ts` renders `••••Xq4A` and argues, correctly for its case,
 * that a vendor prefix *"identifies the vendor and nothing else"*. Here the prefix
 * identifies the **token kind**, which is the first thing anybody debugging a `403` needs:
 * a fine-grained `github_pat_` with the wrong repository selected and a classic `ghp_`
 * missing the `repo` scope fail in ways that look identical from the sync's side and are
 * fixed in completely different places. So the mask is `ghp_••••abcd` — the issue's own
 * `ghp_…abcd`, drawn with mockup 07's bullet.
 *
 * What is *shared* rather than restated is the part that is genuinely the same operation:
 * the bullet, its width, how many trailing characters are readable, and the tail decode
 * that finds them without turning the whole credential into a string. Those come from
 * `masking.ts`, which is a leaf file with no imports of its own.
 */

import { MASK_ONLY, credentialSuffix } from "../provider-connections/masking";

/**
 * The prefixes GitHub issues tokens under, longest first.
 *
 * Order matters: {@link tokenPrefix} returns the first match, and `github_pat_` must be
 * tried before any shorter prefix that could be a prefix of it. None currently is, and the
 * ordering is what keeps that from becoming a silent bug when the list grows.
 *
 *   * `github_pat_` — a fine-grained personal access token, scoped to chosen repositories.
 *   * `ghp_` — a classic personal access token. Decision **K1**'s MVP credential.
 *   * `gho_` — an OAuth access token, what an OAuth app holds for a user.
 *   * `ghu_` — a GitHub App's user-to-server token.
 *   * `ghs_` — a GitHub App's installation token. What O.1
 *     ([#122](https://github.com/NobuData/ouroboros/issues/122)) will mint per hour, listed
 *     here so a paste of one during that work is not refused by this file.
 *   * `ghr_` — a GitHub App's refresh token.
 */
export const TOKEN_PREFIXES = ["github_pat_", "ghp_", "gho_", "ghu_", "ghs_", "ghr_"] as const;

/** One of {@link TOKEN_PREFIXES}. */
export type TokenPrefix = (typeof TOKEN_PREFIXES)[number];

/**
 * A classic token minted before GitHub prefixed them — forty lowercase hex characters.
 *
 * Anchored at both ends, so nothing with a prefix, a suffix or an embedded newline matches.
 * See this file's header on why these are admitted at all.
 */
export const LEGACY_TOKEN = /^[0-9a-f]{40}$/;

/**
 * The shortest string this module will treat as a token.
 *
 * Every prefixed token GitHub issues is far longer; the bound exists so that a value which
 * is *only* a prefix — the state a half-completed paste leaves — is refused by the length
 * rule with a message about length, rather than passing the prefix rule and being stored.
 */
export const MIN_TOKEN_LENGTH = 20;

/**
 * The longest string this module will treat as a token.
 *
 * Fine-grained tokens are the long ones and sit near 93 characters. This is generous enough
 * to absorb whatever GitHub adds and small enough that the endpoint is not a place to post a
 * file. It bounds what reaches the vault, and therefore what one row of an encrypted column
 * can cost.
 */
export const MAX_TOKEN_LENGTH = 255;

/**
 * Which prefix a token carries, if any.
 *
 * @param token - The token, already trimmed.
 * @returns The matching entry of {@link TOKEN_PREFIXES}, or `undefined` for a token that
 *   carries none — which includes both a legacy token and something that is not a token.
 *   The caller distinguishes those with {@link isWellFormedToken}.
 */
export function tokenPrefix(token: string): TokenPrefix | undefined {
  return TOKEN_PREFIXES.find((prefix) => token.startsWith(prefix));
}

/**
 * Is this a value GitHub could plausibly have issued?
 *
 * Deliberately *not* "is this token valid" — nothing but GitHub can answer that, and
 * `GithubClient` finds out on the first call. This answers the weaker question the header
 * argues is worth asking: could a paste error have produced it?
 *
 * @param token - The candidate, already trimmed.
 * @returns `true` for a token carrying a known prefix at a plausible length, or for a legacy
 *   forty-character hex token. `false` for everything else.
 */
export function isWellFormedToken(token: string): boolean {
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) {
    return false;
  }

  // No whitespace anywhere, including inside — a token with a newline in the middle is a
  // paste that picked up a line break, and it would be sent to GitHub as a header value.
  if (/\s/.test(token)) {
    return false;
  }

  return tokenPrefix(token) !== undefined || LEGACY_TOKEN.test(token);
}

/**
 * How many bytes off the front of a token are decoded to find its prefix.
 *
 * The longest entry of {@link TOKEN_PREFIXES}, which is all {@link tokenPrefix} can need —
 * every prefix is ASCII, so a byte is a character here and no multi-byte sequence can be
 * split. Computed rather than written down, so the list is the only place the answer lives.
 */
export const LONGEST_PREFIX_BYTES = Math.max(...TOKEN_PREFIXES.map((prefix) => prefix.length));

/**
 * What a settings surface is allowed to say about a stored token.
 *
 * @param plaintext - The token's bytes, as `VaultService.decrypt` answered them. **Not
 *   consumed** — the caller still owns the buffer and is still the one that zeroizes it.
 * @returns `ghp_••••abcd` for a prefixed token, `••••abcd` for a legacy one, and
 *   {@link MASK_ONLY} for anything too short to have a readable tail. Never contains more of
 *   the token than its prefix and the last characters `masking.ts`'s `SUFFIX_LENGTH` allows —
 *   and the prefix is a value from {@link TOKEN_PREFIXES}, so it is a constant of this file
 *   rather than characters copied out of the credential.
 */
export function maskToken(plaintext: Buffer): string {
  const suffix = credentialSuffix(plaintext);

  if (suffix === "") {
    return MASK_ONLY;
  }

  // Only the prefix is decoded from the head, and only far enough to recognise the longest
  // entry in the list. The middle of the token is never turned into a string on this path.
  const head = plaintext.subarray(0, LONGEST_PREFIX_BYTES).toString("utf8");

  return `${tokenPrefix(head) ?? ""}${MASK_ONLY}${suffix}`;
}
