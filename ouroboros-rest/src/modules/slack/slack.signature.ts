/**
 * Verifying that a request came from Slack (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535)) — pure, so the whole matrix is a
 * unit test.
 *
 * ```
 * basestring  v0:{x-slack-request-timestamp}:{raw body}
 * signature   v0=hex(HMAC-SHA256(signing secret, basestring))   → x-slack-signature
 * window      |now − timestamp| ≤ 5 minutes
 * ```
 *
 * The interactivity URL accepts a POST that says *Maya pressed Allow once*. Acting on that
 * without this check means anyone who learns the URL can resume a paused build. Three things
 * make the check worth having:
 *
 * - it is computed over the **raw bytes** (`slack.raw-body.ts`), never a re-serialised body;
 * - the timestamp is inside a replay window in **both** directions, so a captured request stops
 *   working and a clock set ahead does not widen the window;
 * - the comparison is constant-time, and of equal-length digests, so it leaks nothing about how
 *   much of a forged signature was right.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** The signature scheme's version, as Slack prefixes it. */
export const SLACK_SIGNATURE_VERSION = "v0";

/** The header carrying the signature. */
export const SLACK_SIGNATURE_HEADER = "x-slack-signature";

/** The header carrying when Slack sent the request, in epoch seconds. */
export const SLACK_TIMESTAMP_HEADER = "x-slack-request-timestamp";

/** How far from now a request's timestamp may be, either way. Slack's own figure. */
export const SLACK_REPLAY_WINDOW_SECONDS = 5 * 60;

/** Why a request was refused — for the security log, never for the response. */
export type SlackSignatureProblem =
  | "missing_signature"
  | "missing_timestamp"
  | "malformed_timestamp"
  | "stale_timestamp"
  | "future_timestamp"
  | "missing_body"
  | "signature_mismatch";

/** What {@link verifySlackSignature} decided. */
export type SlackSignatureVerdict =
  { readonly valid: true } | { readonly valid: false; readonly problem: SlackSignatureProblem };

/** What a request presents. */
export interface SlackSignedRequest {
  /** `x-slack-signature`, as received. */
  readonly signature: string | undefined;
  /** `x-slack-request-timestamp`, as received. */
  readonly timestamp: string | undefined;
  /** The body's bytes exactly as they arrived, or undefined when none were kept. */
  readonly rawBody: Buffer | undefined;
}

/**
 * Sign a body the way Slack does.
 *
 * @param signingSecret - The app's signing secret.
 * @param timestamp - Epoch seconds, as the header carries them.
 * @param rawBody - The body's bytes.
 * @returns `v0=<hex>` — what `x-slack-signature` should hold.
 */
export function slackSignature(signingSecret: string, timestamp: string, rawBody: Buffer): string {
  const mac = createHmac("sha256", signingSecret);

  mac.update(`${SLACK_SIGNATURE_VERSION}:${timestamp}:`);
  mac.update(rawBody);

  return `${SLACK_SIGNATURE_VERSION}=${mac.digest("hex")}`;
}

/**
 * Decide whether a request was signed by Slack, recently.
 *
 * @param request - The signature, the timestamp and the raw body.
 * @param signingSecret - The app's signing secret.
 * @param now - The current time.
 * @returns Valid, or the first problem found. The checks run cheapest first, and the HMAC is
 *   computed only for a request whose timestamp is inside the window.
 */
export function verifySlackSignature(
  request: SlackSignedRequest,
  signingSecret: string,
  now: Date,
): SlackSignatureVerdict {
  if (request.signature === undefined || request.signature === "") {
    return { valid: false, problem: "missing_signature" };
  }
  if (request.timestamp === undefined || request.timestamp === "") {
    return { valid: false, problem: "missing_timestamp" };
  }
  // Digits only: `Number("1e9")` and `Number(" 12 ")` are numbers, and neither is a timestamp.
  if (!/^[0-9]{1,12}$/.test(request.timestamp)) {
    return { valid: false, problem: "malformed_timestamp" };
  }

  const skew = Math.floor(now.getTime() / 1000) - Number(request.timestamp);

  if (skew > SLACK_REPLAY_WINDOW_SECONDS) {
    return { valid: false, problem: "stale_timestamp" };
  }
  if (skew < -SLACK_REPLAY_WINDOW_SECONDS) {
    return { valid: false, problem: "future_timestamp" };
  }
  if (request.rawBody === undefined) {
    return { valid: false, problem: "missing_body" };
  }

  const expected = Buffer.from(slackSignature(signingSecret, request.timestamp, request.rawBody));
  const presented = Buffer.from(request.signature);

  // `timingSafeEqual` throws on unequal lengths, and the length of a well-formed signature is
  // public, so the length check leaks nothing.
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
    return { valid: false, problem: "signature_mismatch" };
  }

  return { valid: true };
}
