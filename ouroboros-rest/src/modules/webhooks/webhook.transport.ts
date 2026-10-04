/**
 * The one place a webhook leaves this process (BR.3, [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * ```
 * POST url ──▶ lookup: guardedAddresses(host)  ← the SSRF policy, at connect time
 *          ──▶ TLS to the approved address (SNI + certificate check against the hostname)
 *          ──▶ read ≤ READ_LIMIT_BYTES, then hang up · timeout · no redirects
 * ```
 *
 * **The policy is the lookup.** Node lets a request supply its own `lookup`, and this one is
 * {@link guardedAddresses}: the address the socket connects to is the address the policy just
 * approved, so a DNS answer that changes between "is this safe?" and "connect" (rebinding) has no
 * window to land in. An IP-literal URL never reaches `lookup`, so the shape check runs first.
 *
 * **No redirects.** Node's client does not follow them, and a `3xx` is recorded as the failure it
 * is — following one would be a second, unchecked target.
 */

import { request as httpsRequest, type RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress, LookupOneOptions } from "node:dns";

import { READ_LIMIT_BYTES } from "./webhook.capture";
import {
  checkUrlShape,
  guardedAddresses,
  hostOf,
  SsrfBlockedError,
  type HostResolver,
  type InternalAllowlist,
} from "./webhook.ssrf";

/** How long one attempt may take, connect to last byte read: ten seconds. */
export const DELIVERY_TIMEOUT_MS = 10_000;

/** One attempt, as the dispatcher hands it over. */
export interface WebhookRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** What came back — any status, 2xx or not. */
export interface WebhookResponse {
  readonly status: number;
  /** At most {@link READ_LIMIT_BYTES} of the body, as text. Unredacted: the caller redacts. */
  readonly body: string;
}

/** An attempt that got no HTTP answer: refused by policy, timed out, or failed to connect. */
export class WebhookTransportError extends Error {
  /**
   * @param kind - `blocked` (the SSRF policy), `timeout` or `network`.
   * @param message - What happened, for the delivery log.
   */
  constructor(
    readonly kind: "blocked" | "timeout" | "network",
    message: string,
  ) {
    super(message);
    this.name = "WebhookTransportError";
  }
}

/** Sends one attempt. The dispatcher's only way out of the process. */
export interface WebhookTransport {
  /**
   * @param request - The attempt.
   * @returns The response, whatever its status.
   * @throws {WebhookTransportError} When there was no HTTP answer.
   */
  send(request: WebhookRequest): Promise<WebhookResponse>;
}

/** The DI token for the transport. */
export const WEBHOOK_TRANSPORT = "ouroboros:webhooks:transport";

/** The DI token for the resolver both the save-time check and the transport use. */
export const WEBHOOK_RESOLVER = "ouroboros:webhooks:resolver";

/** The system resolver: every address a name has. */
export const systemResolver: HostResolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map(({ address, family }) => ({
    address,
    family,
  }));

/** Node's request function, injectable so a test can drive the real lookup over plain HTTP. */
export type Requester = (
  options: RequestOptions,
  callback: (res: IncomingMessage) => void,
) => ClientRequest;

/** The callback shape Node's `lookup` option expects. */
type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** The production transport: HTTPS, SSRF-guarded at connect time. */
export class HttpsWebhookTransport implements WebhookTransport {
  /**
   * @param allowlist - The operator's internal-host override.
   * @param resolve - The resolver the guard judges.
   * @param requester - `https.request`; a test passes `http.request` to reach a local server.
   * @param timeoutMs - The attempt's budget.
   */
  constructor(
    private readonly allowlist: InternalAllowlist,
    private readonly resolve: HostResolver = systemResolver,
    private readonly requester: Requester = httpsRequest,
    private readonly timeoutMs: number = DELIVERY_TIMEOUT_MS,
  ) {}

  /** @inheritdoc */
  async send(request: WebhookRequest): Promise<WebhookResponse> {
    let url: URL;

    try {
      url = checkUrlShape(request.url, this.allowlist);
    } catch (error) {
      throw blocked(error);
    }

    return new Promise<WebhookResponse>((resolve, reject) => {
      let settled = false;
      const finish = (outcome: () => void): void => {
        if (!settled) {
          settled = true;
          outcome();
        }
      };

      const req = this.requester(
        {
          method: "POST",
          protocol: url.protocol,
          hostname: hostOf(url),
          port: url.port === "" ? undefined : Number(url.port),
          path: `${url.pathname}${url.search}`,
          headers: {
            ...request.headers,
            "Content-Length": String(Buffer.byteLength(request.body)),
          },
          lookup: this.lookup(),
          timeout: this.timeoutMs,
          agent: false,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let read = 0;

          res.on("data", (chunk: Buffer) => {
            if (read >= READ_LIMIT_BYTES) return;
            chunks.push(chunk.subarray(0, READ_LIMIT_BYTES - read));
            read += chunk.length;
            if (read >= READ_LIMIT_BYTES) {
              // Enough for the log: stop reading and hang up.
              finish(() => resolve(answer(res, chunks)));
              res.destroy();
            }
          });
          res.on("end", () => finish(() => resolve(answer(res, chunks))));
          res.on("error", (error) =>
            finish(() => reject(new WebhookTransportError("network", error.message))),
          );
        },
      );

      req.on("timeout", () => {
        finish(() =>
          reject(
            new WebhookTransportError("timeout", `no answer within ${String(this.timeoutMs)} ms`),
          ),
        );
        req.destroy();
      });
      req.on("error", (error) =>
        finish(() =>
          reject(
            error instanceof SsrfBlockedError
              ? blocked(error)
              : new WebhookTransportError("network", error.message),
          ),
        ),
      );
      req.end(request.body);
    });
  }

  /**
   * Node's `lookup` option, answered by the SSRF guard.
   *
   * @returns A lookup that approves every address before handing one to the socket.
   */
  private lookup() {
    return (
      hostname: string,
      options: LookupOneOptions | { all: true },
      callback: LookupCallback,
    ) => {
      guardedAddresses(hostname, this.resolve, this.allowlist).then(
        (addresses) => {
          if ("all" in options && options.all === true) {
            callback(null, addresses);
          } else {
            callback(null, addresses[0].address, addresses[0].family);
          }
        },
        (error: unknown) => callback(error as NodeJS.ErrnoException, "", 0),
      );
    };
  }
}

/**
 * A response as the dispatcher reads it.
 *
 * @param res - Node's response.
 * @param chunks - What was read.
 * @returns The status and the text.
 */
function answer(res: IncomingMessage, chunks: Buffer[]): WebhookResponse {
  return { status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") };
}

/**
 * The transport error for a policy refusal.
 *
 * @param error - What the policy threw.
 * @returns A `blocked` transport error naming the refusal.
 */
function blocked(error: unknown): WebhookTransportError {
  return new WebhookTransportError(
    "blocked",
    error instanceof SsrfBlockedError ? `blocked by URL policy: ${error.message}` : String(error),
  );
}
