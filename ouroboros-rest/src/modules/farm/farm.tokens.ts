/**
 * `orb_enroll_…` — what the install one-liner carries, and the three properties its shape is
 * chosen for.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)), decision **B3**. Mockup
 * 08's enroll card renders `--token orb_enroll_••••`; this is the value behind the bullets.
 *
 * ```
 * orb_enroll_ 7f3a9c1e4b0d4e2a8f6b5c3d1e0f2a4b . s0mEb4sE64url…43chars
 * └─ prefix ┘ └──────── the row's id, hex ────┘ └──── the secret ────┘
 *              a lookup key, public                 32 random bytes
 * ```
 *
 * **It names its own row.** V040's header says why there is no lookup column on
 * `enrollment_tokens`: the sealed value is not searchable, and adding a hash beside it would
 * be a second place for the secret to leak from. So the token carries the row's id in the
 * clear and the secret is what verifies it — one indexed primary-key read, then one
 * comparison. The id being public costs nothing: it is a UUID that names a row an
 * unauthenticated caller can do nothing with.
 *
 * **It is verified in constant time.** {@link verifySecret} compares with
 * `timingSafeEqual` over fixed-width buffers. The attack it forecloses is not a realistic
 * one against a 256-bit secret behind a network — it is the habit: the day somebody shortens
 * a secret or adds a second comparison, the constant-time one is already the pattern in the
 * file.
 *
 * **It is masked from its id, never from its value.** {@link maskToken} takes a row id and
 * nothing else, so *the full value is returned exactly once, at mint* is a property of the
 * type system rather than a rule about call sites — there is no function here that could
 * produce a mask from a secret, because after the mint request the secret does not exist
 * outside its envelope.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";

import { TOKEN_SECRET_BYTES } from "./farm.policy";

/** What every enrollment token begins with. The mockup's `orb_enroll_`. */
export const TOKEN_PREFIX = "orb_enroll_";

/** What separates the row id from the secret. A dot, as AD.1's own envelopes use. */
const SEPARATOR = ".";

/** The bullet a mask is drawn with — U+2022, as `provider-connections/masking.ts` uses. */
export const MASK_GLYPH = "•";

/** How many bullets a mask carries, whatever the token's length. */
export const MASK_WIDTH = 4;

/** How many characters of a token's id a mask shows, so two masks in a list are distinct. */
export const MASK_SUFFIX = 4;

/** A minted token: the value, once, and the row it belongs to. */
export interface MintedToken {
  /** The row's id — the `uuid` primary key. */
  readonly id: string;
  /** The secret, for sealing. Never stored, logged or returned on its own. */
  readonly secret: string;
  /** The whole `orb_enroll_…` value. Returned to the operator exactly once. */
  readonly value: string;
}

/** A presented token, taken apart. */
export interface PresentedToken {
  /** Which row it claims to be. */
  readonly id: string;
  /** The secret to verify against that row's envelope. */
  readonly secret: string;
}

/**
 * Compose a token for a row that is about to be created.
 *
 * @param id - The row's id, minted by the caller so the value and the row agree — the
 *   database's `gen_random_uuid()` default cannot be used here, because the value has to
 *   exist before the insert that seals it.
 * @param secret - The secret. Injected only so a test can assert an exact value; production
 *   passes nothing and gets {@link TOKEN_SECRET_BYTES} of randomness.
 * @returns The token.
 */
export function mintToken(id: string, secret: string = randomSecret()): MintedToken {
  return { id, secret, value: `${TOKEN_PREFIX}${id.replace(/-/g, "")}${SEPARATOR}${secret}` };
}

/**
 * A fresh secret, base64url.
 *
 * @returns {@link TOKEN_SECRET_BYTES} bytes, encoded without padding — so the token is one
 *   word a shell will not quote and a URL will not escape.
 */
export function randomSecret(bytes: number = TOKEN_SECRET_BYTES): string {
  return randomBytes(bytes).toString("base64url");
}

/** The id as it appears inside a token: a UUID with its dashes removed. */
const PACKED_ID = /^[0-9a-f]{32}$/;

/** What a secret may contain. Base64url, and long enough to be one. */
const SECRET_SHAPE = /^[A-Za-z0-9_-]{22,}$/;

/**
 * Take a presented token apart.
 *
 * Deliberately total rather than throwing: the caller answers every failure of an enrollment
 * with one refusal, and a token that is the wrong *shape* and a token that names no row have
 * to be indistinguishable from outside. See `registration.service.ts`.
 *
 * @param value - Whatever arrived in the request body.
 * @returns The id and the secret, or `undefined` if the value is not a token at all.
 */
export function parseToken(value: string): PresentedToken | undefined {
  if (!value.startsWith(TOKEN_PREFIX)) return undefined;

  const [packed, secret, ...rest] = value.slice(TOKEN_PREFIX.length).split(SEPARATOR);

  if (rest.length > 0 || !packed || !secret) return undefined;
  if (!PACKED_ID.test(packed) || !SECRET_SHAPE.test(secret)) return undefined;

  return { id: unpackId(packed), secret };
}

/**
 * Put a packed id back in UUID form.
 *
 * @param packed - Thirty-two hex characters.
 * @returns The `8-4-4-4-12` form PostgreSQL's `uuid` type parses.
 */
function unpackId(packed: string): string {
  return [
    packed.slice(0, 8),
    packed.slice(8, 12),
    packed.slice(12, 16),
    packed.slice(16, 20),
    packed.slice(20),
  ].join("-");
}

/**
 * Compare a presented secret against the one that was sealed.
 *
 * @param presented - From the request.
 * @param sealed - The plaintext the vault just opened.
 * @returns Whether they match. Length is compared first because `timingSafeEqual` throws on
 *   a mismatch rather than answering `false`, and a length difference is not a secret — the
 *   width is a constant published in this file.
 */
export function verifySecret(presented: string, sealed: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(sealed, "utf8");

  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * What a token looks like after the mint response — everywhere, forever.
 *
 * @param id - The row's id. **Not** the token's value: there is no parameter here a secret
 *   could be passed to, which is what makes *returned exactly once* a property the compiler
 *   keeps rather than a convention.
 * @returns `orb_enroll_••••a4b7` — the mockup's bullets, with enough of the public id that
 *   two tokens in a list are distinguishable.
 */
export function maskToken(id: string): string {
  const packed = id.replace(/-/g, "");

  return `${TOKEN_PREFIX}${MASK_GLYPH.repeat(MASK_WIDTH)}${packed.slice(-MASK_SUFFIX)}`;
}
