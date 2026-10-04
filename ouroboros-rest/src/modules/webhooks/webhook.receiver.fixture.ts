/**
 * A receiver that verifies deliveries exactly as `docs/WEBHOOKS.md` tells customers to (BR.3,
 * [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * Deliberately written from the documentation's recipe rather than from `webhook.signing.ts`:
 * it imports no signing code, only the header names and the window, so a change to how the sender
 * signs that the documented recipe does not follow fails the signing suite instead of passing
 * because both halves moved together.
 *
 * The recipe, step by step:
 *
 * 1. Read `X-Ouro-Timestamp`; reject when it is not a whole number, or is more than
 *    {@link REPLAY_WINDOW_SECONDS} away from the receiver's clock (a replay).
 * 2. Compute `HMAC-SHA256(secret, "<timestamp>.<raw body>")` as lower-case hex.
 * 3. Compare it, in constant time, with every `v1=` value in `X-Ouro-Signature`; reject on no match.
 * 4. Only then parse the body; drop it when `X-Ouro-Delivery` was already processed (at-least-once).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  DELIVERY_HEADER,
  REPLAY_WINDOW_SECONDS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from "./webhook.signing";

/** Why the fixture receiver refused a request. */
export type RejectionReason =
  "missing_headers" | "bad_timestamp" | "outside_replay_window" | "bad_signature" | "duplicate";

/** The fixture receiver's verdict. */
export type Verdict =
  | { readonly accepted: true; readonly event: Record<string, unknown> }
  | { readonly accepted: false; readonly reason: RejectionReason };

/** One received request: header names lower-cased, the body as the raw text that arrived. */
export interface ReceivedRequest {
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
}

/**
 * The documented receiver. Remembers the delivery keys it accepted, so a redelivered event is
 * recognised as a duplicate — the at-least-once half of the contract.
 */
export class FixtureReceiver {
  /** Delivery keys already processed. */
  private readonly seen = new Set<string>();

  /**
   * @param secret - The endpoint's signing secret, as shown once at create or rotate.
   * @param clock - The receiver's own clock.
   */
  constructor(
    private readonly secret: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Verify one request.
   *
   * @param request - What arrived.
   * @returns Accepted with the parsed event, or the first reason it was refused.
   */
  verify(request: ReceivedRequest): Verdict {
    const timestamp = request.headers[TIMESTAMP_HEADER.toLowerCase()];
    const signature = request.headers[SIGNATURE_HEADER.toLowerCase()];
    const delivery = request.headers[DELIVERY_HEADER.toLowerCase()];

    if (timestamp === undefined || signature === undefined || delivery === undefined) {
      return { accepted: false, reason: "missing_headers" };
    }

    if (!/^\d+$/.test(timestamp)) {
      return { accepted: false, reason: "bad_timestamp" };
    }

    const now = Math.floor(this.clock().getTime() / 1000);

    if (Math.abs(now - Number(timestamp)) > REPLAY_WINDOW_SECONDS) {
      return { accepted: false, reason: "outside_replay_window" };
    }

    const expected = Buffer.from(
      createHmac("sha256", this.secret).update(`${timestamp}.${request.body}`).digest("hex"),
    );
    const matches = signature
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.startsWith("v1="))
      .map((part) => Buffer.from(part.slice("v1=".length)))
      .some((given) => given.length === expected.length && timingSafeEqual(given, expected));

    if (!matches) {
      return { accepted: false, reason: "bad_signature" };
    }

    if (this.seen.has(delivery)) {
      return { accepted: false, reason: "duplicate" };
    }

    this.seen.add(delivery);

    return { accepted: true, event: JSON.parse(request.body) as Record<string, unknown> };
  }
}

/**
 * Header names lower-cased, as an HTTP server hands them over.
 *
 * @param headers - The headers as sent.
 * @returns The same headers keyed in lower case.
 */
export function receivedHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
}
