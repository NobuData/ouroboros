/**
 * `••••Xq4A` — the only thing a list or a read is allowed to say about a credential.
 *
 * AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223)), roadmap decision **P4**.
 *
 * ---------------------------------------------------------------------------
 * **Why the mask is computed here rather than in the browser.**
 *
 * Mockup 07's key row reads `sk-ant-api03-••••••••••••Xq4A`, and the obvious implementation
 * — return the key, render the bullets — puts the credential in the page's memory, in the
 * network tab, in the browser's cache and in every error-reporting payload the page ever
 * sends. The issue is unambiguous about it: the full value *is not in the payload*. So the
 * bullets are made server-side and what crosses the wire is a string that cannot be
 * un-masked, because the characters it is hiding were never sent.
 *
 * **The visible half is a suffix, and four characters of it.** A prefix would be worse for
 * no benefit: vendor key prefixes are constant — every Anthropic key starts `sk-ant-api03-`
 * — so a prefix identifies the vendor and nothing else, while the last four characters are
 * what somebody comparing a key against their vendor dashboard actually reads. Four is what
 * every vendor console shows and it is short enough to be useless on its own: a credential
 * whose last four characters are known is not measurably closer to being guessed.
 *
 * ---------------------------------------------------------------------------
 * **It takes bytes, not a string, and that is the point.**
 *
 * `VaultService.decrypt` answers a `Buffer` the caller owns and is expected to `zeroize`.
 * Turning it into a JavaScript string first would make an immutable copy that nothing can
 * erase and only the collector can free — so this reads the **tail bytes** and decodes those,
 * and the plaintext never exists as a string at all on the list path. `TAIL_BYTES` is
 * generous enough that the last four characters survive any encoding a credential is
 * plausibly written in, and small enough that what is decoded is never the key.
 */

/** How many characters of a credential a mask shows. */
export const SUFFIX_LENGTH = 4;

/** The character the hidden half is drawn with — U+2022, the bullet mockup 07 uses. */
export const MASK_GLYPH = "•";

/** How many bullets a mask carries, whatever the credential's length. */
export const MASK_WIDTH = 4;

/**
 * How many bytes off the end of a credential are decoded to find its last characters.
 *
 * Sixteen, which is four characters even in the worst encoding UTF-8 has, and which is
 * never enough of a credential to be one. Reading the whole buffer would be simpler and
 * would defeat the reason this function takes a buffer at all — see this file's header.
 */
export const TAIL_BYTES = 16;

/**
 * The bullets, without a suffix — what a credential too short to have a readable tail masks
 * to.
 *
 * A credential of fewer than {@link SUFFIX_LENGTH} characters is not something any vendor
 * issues, and showing *all* of a three-character secret while calling it a mask would be the
 * one failure this module exists to prevent. So the answer degrades to bullets alone rather
 * than to a shorter suffix.
 */
export const MASK_ONLY = MASK_GLYPH.repeat(MASK_WIDTH);

/**
 * Mask a decrypted credential.
 *
 * @param plaintext - The credential's bytes, as `VaultService.decrypt` answered them. **Not
 *   consumed**: the caller still owns the buffer and is still the one that zeroizes it, so
 *   that a caller doing two things with one plaintext is not surprised by the first one
 *   erasing it.
 * @returns `••••Xq4A` — four bullets and the last {@link SUFFIX_LENGTH} characters — or
 *   {@link MASK_ONLY} for a credential with fewer characters than that. Never contains more
 *   of the credential than its last four characters, whatever the buffer holds.
 */
export function maskCredential(plaintext: Buffer): string {
  return `${MASK_ONLY}${credentialSuffix(plaintext)}`;
}

/**
 * The last {@link SUFFIX_LENGTH} characters of a credential.
 *
 * Exported beside {@link maskCredential} because it is the half that is worth asserting on
 * its own: a suffix that came out wrong is the one bug a mask can have that still *looks*
 * like a mask.
 *
 * The tail is decoded rather than the whole buffer, and a decode that starts mid-character
 * yields a replacement character at the front — which is discarded by the slice, because
 * only the last four characters are taken. That is why the tail is read generously.
 *
 * @param plaintext - The credential's bytes.
 * @returns The last four characters, or an empty string when there are fewer than four.
 */
export function credentialSuffix(plaintext: Buffer): string {
  const tail = plaintext.subarray(Math.max(0, plaintext.length - TAIL_BYTES)).toString("utf8");

  return tail.length < SUFFIX_LENGTH ? "" : tail.slice(-SUFFIX_LENGTH);
}
