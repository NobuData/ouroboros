/**
 * The page reader's socket — one GET, its bytes capped, its address held to the SSRF policy.
 *
 * A URL the research loop asks for is a URL a model chose, so it is treated as hostile: the same
 * policy webhooks are held to (`webhooks/webhook.ssrf.ts`, BR.3 #487) decides which addresses may be
 * reached — loopback, link-local (the cloud metadata endpoint), RFC 1918, CGNAT and unique-local
 * IPv6 are refused unless an operator lists them in `OURO_RESEARCH_FETCH_INTERNAL_ALLOWLIST` — and
 * the connection is made to the address the policy approved, so DNS cannot answer differently
 * between the check and the connect. Unlike a webhook, a page may be plain `http:`.
 *
 * Redirects are **not** followed here: the fetcher follows them one hop at a time, so each hop is
 * re-checked against robots.txt and this policy, and the hop count is bounded.
 */

import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupAddress, LookupOneOptions } from "node:dns";
import { isIP } from "node:net";

import {
  InternalAllowlist,
  SsrfBlockedError,
  guardedAddresses,
  hostOf,
  type HostResolver,
} from "../../../../webhooks/webhook.ssrf";
import { systemResolver } from "../../../../webhooks/webhook.transport";

/** One GET. */
export interface PageRequest {
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  /** How long the whole exchange may take. */
  readonly timeoutMs: number;
  /** The most body bytes to read; the rest is left unread. */
  readonly maxBytes: number;
}

/** What came back. */
export interface PageResponse {
  readonly status: number;
  /** Header names lower-cased; a repeated header joined with `, `. */
  readonly headers: Readonly<Record<string, string>>;
  /** At most `maxBytes` of the body. */
  readonly body: Buffer;
  /** Whether the body was longer than `maxBytes`. */
  readonly truncated: boolean;
}

/** Why a request produced no response. */
export type PageTransportFailure = "timeout" | "network" | "blocked";

/** A request that produced no response. */
export class PageTransportError extends Error {
  /**
   * @param failure - Which way it failed.
   * @param detail - What happened, for the error detail — never a header.
   */
  constructor(
    readonly failure: PageTransportFailure,
    readonly detail: string,
  ) {
    super(`${failure}: ${detail}`);
    this.name = "PageTransportError";
  }
}

/** Anything that can make one GET. Tests use a recorded site. */
export interface PageTransport {
  /**
   * @param request - The request.
   * @returns The response, whatever its status.
   * @throws {PageTransportError} When there was no response.
   */
  get(request: PageRequest): Promise<PageResponse>;
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** The production transport: node's http/https, pinned to the approved address. */
export class GuardedPageTransport implements PageTransport {
  /**
   * @param allowlist - Internal hosts an operator allowed, from
   *   `OURO_RESEARCH_FETCH_INTERNAL_ALLOWLIST`.
   * @param resolve - How a hostname is resolved; the system resolver by default.
   */
  constructor(
    private readonly allowlist: InternalAllowlist,
    private readonly resolve: HostResolver = systemResolver,
  ) {}

  async get(page: PageRequest): Promise<PageResponse> {
    const { url } = page;

    // Node does not consult `lookup` for an address literal, so a literal is held to the policy
    // here — `http://169.254.169.254/` must not slip past it for want of a DNS name.
    if (isIP(hostOf(url)) !== 0) {
      try {
        await guardedAddresses(hostOf(url), this.resolve, this.allowlist);
      } catch (error) {
        throw blockedError(error);
      }
    }

    return this.send(page);
  }

  private send(page: PageRequest): Promise<PageResponse> {
    const { url } = page;

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return Promise.reject(
        new PageTransportError("blocked", `scheme ${url.protocol} is not read`),
      );
    }
    if (url.username !== "" || url.password !== "") {
      return Promise.reject(
        new PageTransportError("blocked", "a URL carrying credentials is not read"),
      );
    }

    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const options: RequestOptions = {
      method: "GET",
      protocol: url.protocol,
      hostname: hostOf(url),
      port: url.port === "" ? undefined : Number(url.port),
      path: `${url.pathname}${url.search}`,
      headers: { ...page.headers },
      lookup: this.lookup(),
      timeout: page.timeoutMs,
      agent: false,
    };

    return new Promise<PageResponse>((resolve, reject) => {
      let settled = false;
      const finish = (outcome: () => void): void => {
        if (!settled) {
          settled = true;
          outcome();
        }
      };
      const deadline = setTimeout(() => {
        finish(() =>
          reject(
            new PageTransportError("timeout", `no answer within ${String(page.timeoutMs)} ms`),
          ),
        );
        req.destroy();
      }, page.timeoutMs);

      const req = send(options, (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        let read = 0;
        let truncated = false;

        const done = (): void => {
          clearTimeout(deadline);
          finish(() =>
            resolve({
              status: res.statusCode ?? 0,
              headers: flatten(res),
              body: Buffer.concat(chunks),
              truncated,
            }),
          );
        };

        res.on("data", (chunk: Buffer) => {
          if (read >= page.maxBytes) return;
          const room = page.maxBytes - read;
          chunks.push(chunk.subarray(0, room));
          read += Math.min(chunk.length, room);
          if (chunk.length > room) {
            truncated = true;
            done();
            res.destroy();
          }
        });
        res.on("end", done);
        res.on("error", (error) => {
          clearTimeout(deadline);
          finish(() => reject(new PageTransportError("network", error.message)));
        });
      });

      req.on("error", (error) => {
        clearTimeout(deadline);
        finish(() =>
          reject(
            error instanceof SsrfBlockedError
              ? blockedError(error)
              : new PageTransportError("network", error.message),
          ),
        );
      });
      req.end();
    });
  }

  private lookup() {
    return (
      hostname: string,
      options: LookupOneOptions | { all: true },
      callback: LookupCallback,
    ): void => {
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
 * A policy refusal, as the transport reports it.
 *
 * @param error - What the policy threw.
 * @returns A `blocked` failure naming the host or address — never a path.
 */
function blockedError(error: unknown): PageTransportError {
  return error instanceof SsrfBlockedError
    ? new PageTransportError(
        "blocked",
        `refused by the URL policy (${error.reason}): ${error.detail}`,
      )
    : new PageTransportError("blocked", "refused by the URL policy");
}

/**
 * A response's headers as one flat, lower-cased record.
 *
 * @param res - The response.
 * @returns Header name to value.
 */
function flatten(res: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [name, value] of Object.entries(res.headers)) {
    if (value === undefined) continue;
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}
