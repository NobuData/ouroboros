/**
 * The suite's webhook receiver, as a client
 * ([#496](https://github.com/NobuData/ouroboros/issues/496), the settings leg).
 *
 * `fixtures/webhook-receiver/server.mjs` is an https endpoint on the compose network that keeps
 * every `POST` it is sent. The leg creates a webhook that points at it, presses **Test ping**,
 * and then asks *the receiving end* what arrived — which is what makes the delivery log's row a
 * delivery rather than a row. This module is the three things the leg asks of it: forget what
 * you have seen, tell me what you were sent, and (for `scripts/verify-settings.sh` alone) refuse
 * the next one.
 *
 * The controls take no credential, for `support/sandbox.ts`'s reason: they are the fixture's,
 * published on loopback, and hold nothing but what this suite sent.
 *
 * ## The signature is checked here, not there
 *
 * The receiver does not hold the endpoint's secret and is not handed it. A signing secret is
 * shown **once**, in the browser's one-time dialog, so the only party that can verify
 * `X-Ouro-Signature` is the one that read that dialog — the leg. {@link signatureOf} restates
 * `ouroboros-rest/src/modules/webhooks/webhook.signing.ts`'s scheme rather than importing it,
 * because nothing here may import service source (`eslint.config.mjs`), and because a receiver
 * written by a customer restates it too: `v1=` and the hex HMAC-SHA256 of
 * `<timestamp>.<raw body>`.
 */

import { createHmac } from "node:crypto";

import { RECEIVER_URL } from "./stack";

/** The host and port `rest` delivers to — the receiver's name on the compose network. */
export const RECEIVER_ORIGIN = "https://webhook-receiver:8443";

/** The headers every delivery carries, lower-cased as Node hands them over. */
export const DELIVERY_HEADERS = {
  signature: "x-ouro-signature",
  timestamp: "x-ouro-timestamp",
  event: "x-ouro-event",
  delivery: "x-ouro-delivery",
} as const;

/** One `POST` the receiver was sent. */
export interface ReceivedDelivery {
  /** When it arrived, by the receiver's clock. */
  readonly receivedAt: string;
  readonly method: string;
  /** The path and query it was sent to. */
  readonly path: string;
  /** The request's headers, names lower-cased. */
  readonly headers: Readonly<Record<string, string | undefined>>;
  /** The raw body — what the signature is over. */
  readonly body: string;
}

/**
 * Ask one of the receiver's controls.
 *
 * @param method - `GET` or `POST`.
 * @param path - The control, under `/__receiver/`.
 * @param body - A JSON body, for the fault.
 * @returns The parsed answer.
 * @throws {Error} Naming the fixture when it does not answer — the marker
 *   `scripts/verify-failure-modes.sh` looks for with the receiver stopped.
 */
async function control<Answer>(
  method: "GET" | "POST",
  path: string,
  body?: Readonly<Record<string, unknown>>,
): Promise<Answer> {
  let response: Response;

  try {
    response = await fetch(`${RECEIVER_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (reason) {
    throw new Error(
      `the webhook receiver is not answering at ${RECEIVER_URL} — the settings leg reads a ` +
        `delivery back from it (fixtures/webhook-receiver). ${String(reason)}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `the webhook receiver answered ${method} ${path} with ${response.status}: ` +
        (await response.text()),
    );
  }

  return (await response.json()) as Answer;
}

/**
 * Forget every delivery, and clear any fault.
 *
 * @returns When the receiver has.
 */
export async function resetReceiver(): Promise<void> {
  await control("POST", "/__receiver/reset");
}

/**
 * Everything the receiver was sent at one path since the last reset, oldest first.
 *
 * @param path - The path the leg's endpoint names — unique to the run, so another endpoint's
 *   traffic is never mistaken for this one's.
 * @returns The deliveries.
 */
export async function deliveriesTo(path: string): Promise<readonly ReceivedDelivery[]> {
  const { deliveries } = await control<{ deliveries: readonly ReceivedDelivery[] }>(
    "GET",
    "/__receiver/deliveries",
  );

  return deliveries.filter((delivery) => delivery.path === path);
}

/**
 * Make the receiver answer every delivery with a failure, until the next reset.
 *
 * For `scripts/verify-settings.sh` alone: the leg must go red when the receiving end refuses.
 *
 * @param status - The status to answer with, 400–599.
 * @returns When the receiver has taken it.
 */
export async function faultReceiver(status: number): Promise<void> {
  await control("POST", "/__receiver/fault", { status });
}

/**
 * The signature a delivery must carry — `webhook.signing.ts`'s scheme, restated.
 *
 * @param secret - The endpoint's signing secret, as the one-time dialog showed it.
 * @param timestamp - The delivery's `X-Ouro-Timestamp`.
 * @param body - The raw body received.
 * @returns `v1=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`.
 */
export function signatureOf(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}
