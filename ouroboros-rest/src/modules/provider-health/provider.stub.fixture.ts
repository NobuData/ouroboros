/**
 * A provider that answers on loopback, and remembers what it was asked.
 *
 * Written for Z.3 ([#196](https://github.com/NobuData/ouroboros/issues/196)) and lifted out of
 * `provider-health.integration-spec.ts` unchanged by Z.6
 * ([#199](https://github.com/NobuData/ouroboros/issues/199)), which needs the same stub to make
 * the opposite claim about the same code.
 *
 * The two claims are worth stating together, because the stub is what makes each of them
 * evidence rather than assertion:
 *
 *   * **Z.3** points a sweep at one of these and reads {@link ProviderStub.received} to show
 *     that every request it issues is a `GET` for a *listing* — no completion, ever, for any of
 *     the five kinds.
 *   * **Z.6** points a *resolution* at one and reads the same array to show that it issues
 *     **nothing at all**. A resolution's view of a provider is `provider_connections.status`
 *     and the `health` column, and a routing decision that reached for a socket would put an
 *     outbound request on the path of every run while still reading a number that was true a
 *     moment ago.
 *
 * A stub that answers `200` to everything is deliberate for both. A refusing stub would let a
 * request go unnoticed as a failure the caller swallowed; this one succeeds, records, and
 * therefore has no way to hide a call that happened.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** One request a provider stub received. */
export interface Received {
  method: string | undefined;
  url: string | undefined;
  body: string;
  headers: NodeJS.Dict<string | string[]>;
}

/** A provider that answers on loopback, and remembers what it was asked. */
export class ProviderStub {
  private constructor(
    private readonly server: Server,
    readonly baseUrl: string,
    /** Every request this stub was sent, in order — what the no-completions claim is read off. */
    readonly received: readonly Received[],
  ) {}

  /**
   * Start a stub answering every path with one JSON body.
   *
   * @param body - What to answer with, or a function of the path for a stub that serves two
   *   routes.
   * @returns The started stub.
   */
  static async start(body: (url: string) => unknown): Promise<ProviderStub> {
    const received: Received[] = [];
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];

      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.push({
          method: request.method,
          url: request.url,
          body: Buffer.concat(chunks).toString("utf8"),
          headers: request.headers,
        });

        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(body(request.url ?? "")));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const { port } = server.address() as AddressInfo;

    return new ProviderStub(server, `http://127.0.0.1:${port.toString()}`, received);
  }

  /** Stop answering — a daemon somebody turned off. */
  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
