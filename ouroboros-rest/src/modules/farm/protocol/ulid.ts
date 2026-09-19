/**
 * The ids the runner protocol carries — minted here for the gateway's own frames, and derived
 * here from the UUIDs the database already holds.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)), against
 * [`docs/RUNNER_PROTOCOL.md` § 2](../../../../../docs/RUNNER_PROTOCOL.md#ids). Every id on the
 * wire is 26 Crockford base32 characters, and the compound ones are a prefix and an underscore
 * in front of them:
 *
 * ```
 * 01KE7NAGMYAV6AVSA6FMTM53N1        one frame     minted here, per frame
 * sess_01KE7MV3WKAG706QMDN23AJ3BE   one session   minted here, per ack
 * rnr_01KE76X95CS69B659HTXZJ0HA3    one runner    DERIVED from runners.id
 * job_01KE7J4EZ3204KQXMHJRPQPWQ6    one job       DERIVED from build_jobs.id
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Runner and job ids are the database's UUIDs, re-spelled — not a second id.** A UUID is 128
 * bits and 26 base32 characters carry 130, so every UUID has exactly one wire spelling and a
 * wire id whose first character is `0`–`7` has exactly one UUID. {@link wireId} and
 * {@link uuidOf} are that bijection, which is what lets a `job.finish` naming
 * `job_…` find its `build_jobs` row after a reconnect that changed everything else, with no
 * mapping table to keep and nothing to drift.
 *
 * What the re-spelling does *not* carry is a ULID's time prefix: `gen_random_uuid()` is a v4
 * UUID, so a `rnr_` id does not sort by enrollment time the way a frame id sorts by send time.
 * Nothing reads one that way — the protocol's time-ordering argument is about frames and
 * session logs, and those ids are minted here as real ULIDs.
 *
 * ---------------------------------------------------------------------------
 * **Frame ids are monotonic within a millisecond.** Two frames minted in the same millisecond
 * get the same time prefix, and a random suffix alone would order them arbitrarily; the
 * standard remedy — increment the previous suffix — is what the Go agent's `conn.NewID` does
 * too, so a session log read from either end sorts into the order it was written.
 */

import { randomBytes } from "node:crypto";

/** Crockford's base32 alphabet: no I, L, O or U. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A bare ULID, as `$defs/ulid` in `schemas/runner-protocol/v1.json` spells it. */
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** How many characters a ULID is. */
const ULID_LENGTH = 26;

/** The first ten characters are the millisecond; the last sixteen are 80 random bits. */
const TIME_LENGTH = 10;

/** The random half's width, in bits. */
const RANDOM_BITS = 80n;

/** The largest value the random half can hold. */
const RANDOM_MAX = (1n << RANDOM_BITS) - 1n;

/** The prefixes a compound id carries — the three the protocol names. */
export type IdPrefix = "sess" | "rnr" | "job";

/** The previous mint, so the next one in the same millisecond can follow it. */
let previous: { readonly time: number; readonly random: bigint } | undefined;

/**
 * Mint a ULID.
 *
 * @param now - The millisecond to stamp it with. Defaults to the clock; a suite passes one.
 * @returns 26 characters, strictly greater than every id this process minted before it in the
 *   same millisecond.
 * @throws {RangeError} If 2^80 ids were minted in one millisecond — which is the ULID
 *   specification's own answer, and not a condition a gateway reaches.
 */
export function newUlid(now: number = Date.now()): string {
  let random: bigint;

  if (previous && previous.time === now) {
    if (previous.random === RANDOM_MAX) throw new RangeError("ULID random space exhausted");
    random = previous.random + 1n;
  } else {
    random = BigInt(`0x${randomBytes(10).toString("hex")}`);
  }

  previous = { time: now, random };

  return encode(BigInt(now), TIME_LENGTH) + encode(random, ULID_LENGTH - TIME_LENGTH);
}

/**
 * A compound id minted fresh — `sess_…`.
 *
 * @param prefix - Which kind of id.
 * @param now - The millisecond, as for {@link newUlid}.
 * @returns The id.
 */
export function newPrefixedId(prefix: IdPrefix, now?: number): string {
  return `${prefix}_${newUlid(now)}`;
}

/**
 * The wire spelling of a database UUID.
 *
 * @param prefix - `rnr` for a runner, `job` for a build job.
 * @param uuid - The row's id, in any case, with its hyphens.
 * @returns `rnr_…` or `job_…`.
 * @throws {TypeError} If `uuid` is not a UUID — a programming error, since every caller holds
 *   a row's own id.
 */
export function wireId(prefix: IdPrefix, uuid: string): string {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new TypeError(`not a UUID: ${uuid}`);

  return `${prefix}_${encode(BigInt(`0x${hex}`), ULID_LENGTH)}`;
}

/**
 * The database UUID a wire id spells, if it spells one.
 *
 * @param prefix - The prefix the id must carry.
 * @param id - What arrived on the wire.
 * @returns The UUID in lowercase hyphenated form, or `undefined` when the id has another
 *   prefix, is not 26 base32 characters, or encodes more than 128 bits — which a well-formed
 *   `job_` id minted by somebody else may well do, and which is then simply not one of ours.
 */
export function uuidOf(prefix: IdPrefix, id: string): string | undefined {
  const marker = `${prefix}_`;
  if (!id.startsWith(marker)) return undefined;

  const body = id.slice(marker.length);
  if (!ULID_PATTERN.test(body)) return undefined;

  const value = decode(body);
  if (value >> 128n !== 0n) return undefined;

  const hex = value.toString(16).padStart(32, "0");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Write a number in base32, most significant character first.
 *
 * @param value - Non-negative.
 * @param length - How many characters; the value is left-padded with `0`.
 * @returns The characters.
 */
function encode(value: bigint, length: number): string {
  let text = "";
  let rest = value;

  for (let i = 0; i < length; i += 1) {
    text = ALPHABET[Number(rest & 31n)] + text;
    rest >>= 5n;
  }

  return text;
}

/**
 * Read base32 characters back into a number.
 *
 * @param text - Characters already checked against {@link ULID_PATTERN}.
 * @returns The number.
 */
function decode(text: string): bigint {
  let value = 0n;

  for (const character of text) value = (value << 5n) | BigInt(ALPHABET.indexOf(character));

  return value;
}
