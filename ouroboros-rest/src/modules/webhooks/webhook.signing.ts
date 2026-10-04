/**
 * How a delivery is signed (BR.3, [#487](https://github.com/NobuData/ouroboros/issues/487)) — the
 * sender's half of the contract `docs/WEBHOOKS.md` documents for receivers.
 *
 * ```
 * X-Ouro-Timestamp: 1791100800                         unix seconds, when the attempt was signed
 * X-Ouro-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
 * X-Ouro-Event:     audit.provider.rotated
 * X-Ouro-Delivery:  5f0c…                               the idempotency key — same on every retry
 * ```
 *
 * **The timestamp is inside the MAC.** A signature over the body alone would let anybody who
 * captured one request replay it forever with a fresh `X-Ouro-Timestamp`; signing
 * `<timestamp>.<body>` means changing the header breaks the signature, so a receiver that rejects
 * timestamps outside {@link REPLAY_WINDOW_SECONDS} rejects every replay older than that.
 *
 * **A fresh timestamp per attempt.** A retry an hour later is signed again, so a receiver's
 * replay window never refuses a legitimate retry; `X-Ouro-Delivery` is what tells the receiver it
 * has seen the event before.
 *
 * The secret is `whsec_` + 32 random bytes in base64url. It exists in the clear only here, in the
 * create and rotate answers, and in the vault's hands — never in a log, an audit row or an error.
 */

import { createHmac, randomBytes } from "node:crypto";

/** The signature header. */
export const SIGNATURE_HEADER = "X-Ouro-Signature";
/** The signing-time header, unix seconds. */
export const TIMESTAMP_HEADER = "X-Ouro-Timestamp";
/** The event-type header. */
export const EVENT_HEADER = "X-Ouro-Event";
/** The idempotency-key header. */
export const DELIVERY_HEADER = "X-Ouro-Delivery";

/** The signature scheme's version prefix — `v1=` — so a later scheme can be sent beside it. */
export const SIGNATURE_SCHEME = "v1";

/**
 * How far a receiver should let `X-Ouro-Timestamp` stray from its own clock, either way: five
 * minutes. Wide enough for clock skew and a slow network, narrow enough that a captured request
 * is worthless soon after.
 */
export const REPLAY_WINDOW_SECONDS = 300;

/** The secret's prefix — marks the value as a webhook signing secret wherever it is pasted. */
export const SECRET_PREFIX = "whsec_";

/** Random bytes in a secret. */
const SECRET_BYTES = 32;

/**
 * A new signing secret.
 *
 * @param bytes - The randomness; a fresh 32 bytes by default. Injectable for tests only.
 * @returns `whsec_<base64url>`.
 */
export function mintSigningSecret(bytes: Buffer = randomBytes(SECRET_BYTES)): string {
  return `${SECRET_PREFIX}${bytes.toString("base64url")}`;
}

/**
 * The signature of one attempt.
 *
 * @param secret - The endpoint's signing secret.
 * @param timestamp - Unix seconds, as sent in {@link TIMESTAMP_HEADER}.
 * @param body - The exact bytes sent as the request body.
 * @returns `v1=<lower-case hex>`.
 */
export function signatureOf(secret: string, timestamp: number, body: string): string {
  const mac = createHmac("sha256", secret)
    .update(`${String(timestamp)}.${body}`)
    .digest("hex");

  return `${SIGNATURE_SCHEME}=${mac}`;
}

/**
 * Every header a signed attempt carries.
 *
 * @param input - The secret, the event type, the delivery key, the body and the signing instant.
 * @returns The headers, content type included.
 */
export function signedHeaders(input: {
  readonly secret: string;
  readonly eventType: string;
  readonly deliveryKey: string;
  readonly body: string;
  readonly at: Date;
}): Record<string, string> {
  const timestamp = Math.floor(input.at.getTime() / 1000);

  return {
    "Content-Type": "application/json",
    "User-Agent": "Ouroboros-Webhooks/1",
    [EVENT_HEADER]: input.eventType,
    [DELIVERY_HEADER]: input.deliveryKey,
    [TIMESTAMP_HEADER]: String(timestamp),
    [SIGNATURE_HEADER]: signatureOf(input.secret, timestamp, input.body),
  };
}
