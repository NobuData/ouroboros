/**
 * Credentials that are not credentials — assembled at run time, so none is ever written into
 * this repository as a literal.
 *
 * Two reasons for the indirection. A literal `AKIA…` in a spec is exactly what this ruleset (and
 * GitHub's push protection) exists to refuse, so committing one would make this repository fail
 * its own guardrail. And a sample built from a prefix and a deterministic filler states *which
 * part of the shape a rule keys on*, which a pasted example does not.
 *
 * Nothing here ships: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

/**
 * A deterministic string of `length` characters drawn from an alphabet.
 *
 * @param alphabet - The characters to draw from, in order.
 * @param length - How many.
 * @param seed - Where in the alphabet to start, so two fillers of one shape differ.
 * @returns The filler — cycling with a stride coprime to most alphabets, so it is neither a
 *   run of one character nor an obvious sequence a placeholder filter would discard.
 */
export function filler(alphabet: string, length: number, seed = 0): string {
  let out = "";

  for (let index = 0; index < length; index += 1) {
    out += alphabet[(seed + index * 7) % alphabet.length];
  }

  return out;
}

/** Upper-case base-32, AWS's key-id alphabet. */
export const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** Lower-case hexadecimal. */
export const HEX = "0123456789abcdef";
/** Letters and digits. */
export const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** Letters, digits, `_` and `-`. */
export const URLSAFE = `${ALNUM}_-`;

/** An AWS access key id: `AKIA` and sixteen base-32 characters. */
export const AWS_ACCESS_KEY_ID = ["AK", "IA", filler(BASE32, 16, 3)].join("");

/** A GitHub classic personal access token. */
export const GITHUB_PAT = ["gh", "p_", filler(ALNUM, 36, 5)].join("");

/** A Slack bot token. */
export const SLACK_BOT_TOKEN = [
  "xo",
  "xb-",
  filler("0123456789", 12, 1),
  "-",
  filler("0123456789", 12, 4),
  "-",
  filler(ALNUM, 24, 9),
].join("");

/** A Stripe live secret key. */
export const STRIPE_SECRET_KEY = ["sk", "_live_", filler(ALNUM, 24, 2)].join("");

/** A PEM private key header. */
export const PRIVATE_KEY_HEADER = ["-----BEGIN RSA ", "PRIVATE KEY-----"].join("");

/** A Datadog API key: 32 hex characters, which only counts beside its keyword. */
export const DATADOG_VALUE = filler(HEX, 32, 11);

/** A 40-character base64-ish value, the shape of an AWS secret access key. */
export const AWS_SECRET_VALUE = filler(`${ALNUM}/+`, 40, 13);
