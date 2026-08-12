/**
 * BetterAuth, as a CommonJS test runner can hold it.
 *
 * `better-auth` is published as ES modules and this suite runs on Jest's CommonJS
 * runtime, so every spec that builds the application would fail to parse the library
 * before it asserted anything. `jest.config.mjs` maps the three specifiers the running
 * code reaches for — `better-auth`, `better-auth/node`, `better-auth/api` — at this one
 * module, which is why it exports a function for each of them rather than one thing.
 *
 * **What it is not is a mock of the code under test.** The Nest integration
 * (`@thallesp/nestjs-better-auth`) is loaded for real — `jest.esm-transform.cjs` converts
 * it — so the body parser it re-adds, the routes it excludes from the global prefix and
 * the handler it registers on the adapter are the genuine article. This stands in for the
 * *other* side of that seam: the library the integration hands requests to. That is
 * deliberate, and it is where [#701](https://github.com/NobuData/ouroboros/issues/701)
 * ends — mounting is this issue's, what the routes then *do* belongs to
 * [#702](https://github.com/NobuData/ouroboros/issues/702) and
 * [#703](https://github.com/NobuData/ouroboros/issues/703), and that the real library
 * accepts these options is proven where Jest cannot reach: by `@better-auth/cli generate`
 * building an instance from `auth.config.ts` (`README.md` § Generating the auth schema).
 *
 * {@link toNodeHandler} is written to be *faithful rather than convenient*, because one
 * property of it is the acceptance criterion: it reads the request **stream**. A bootstrap
 * that let Nest parse bodies globally would leave that stream drained, and the echo below
 * would report an empty body — which is exactly how `application.spec.ts` tells a working
 * `bodyParser: false` from a broken one.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

import type { BetterAuthOptions } from "better-auth";

/** What {@link betterAuth} answers a request with — the request itself, read back. */
export interface AuthEcho {
  /**
   * Always `true`.
   *
   * A spec asserts on this rather than on a status code, because "the request reached
   * BetterAuth" and "something answered 200" are different claims and only the first is
   * worth making about a mount.
   */
  readonly betterAuth: true;
  /** The verb, as the handler received it. */
  readonly method: string;
  /** The path, as the handler received it — the assertion that the mount is at `/api/auth`. */
  readonly path: string;
  /**
   * The request body, read from the stream.
   *
   * Empty when the request carried none — and, tellingly, also empty when something
   * upstream already consumed it. See this module's header.
   */
  readonly body: string;
}

/** The part of a BetterAuth instance the Nest integration and these specs use. */
export interface StubbedAuth {
  /** The options it was built from. The integration reads `basePath` off this. */
  readonly options: BetterAuthOptions;
  /** The library's own request handler, over the Fetch API, as the real one is. */
  handler(request: Request): Promise<Response>;
  /** The typed server-side callers. Empty here; #702 and #703 are what put routes in it. */
  readonly api: Record<string, unknown>;
}

/**
 * Stand in for `betterAuth()`.
 *
 * @param options - Whatever `authOptions` produced. Kept, not read: the integration needs
 *   `options.basePath` to know where to mount, and a spec needs the rest to assert that
 *   the service's own decisions arrived intact.
 * @returns An instance shaped like the library's, whose handler echoes what it was given.
 */
export function betterAuth(options: BetterAuthOptions): StubbedAuth {
  return {
    options,
    api: {},
    handler: async (request: Request): Promise<Response> => {
      const echo: AuthEcho = {
        betterAuth: true,
        method: request.method,
        path: new URL(request.url).pathname,
        body: await request.text(),
      };

      return new Response(JSON.stringify(echo), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
}

/**
 * Stand in for `better-auth/node`'s `toNodeHandler`.
 *
 * The real one turns the library's Fetch-API handler into a Node request listener, and so
 * does this: it reads the stream, builds a `Request`, and writes the `Response` back out.
 * Nothing here is short-circuited, because the stream read is the whole point — see this
 * module's header.
 *
 * @param auth - The instance to hand requests to.
 * @returns A Node request listener, which is what the Nest integration mounts.
 */
export function toNodeHandler(
  auth: StubbedAuth,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    // `originalUrl` first, exactly as the library does: Express rewrites `url` when a
    // handler is mounted under a path, and the auth handler needs the path the client
    // asked for rather than the remainder Express left it.
    const target = (request as IncomingMessage & { originalUrl?: string }).originalUrl;
    const url = new URL(target ?? request.url ?? "/", `http://${request.headers.host ?? "."}`);
    const body = await readBody(request);

    const answer = await auth.handler(
      new Request(url, {
        method: request.method,
        headers: fromNodeHeaders(request.headers),
        // Only when there is one: the Fetch API refuses a body on GET and HEAD, and every
        // request that reaches a mount test is one or the other until #702 lands.
        ...(body === "" ? {} : { body }),
      }),
    );

    response.statusCode = answer.status;
    answer.headers.forEach((value, name) => response.setHeader(name, value));
    response.end(await answer.text());
  };
}

/**
 * Stand in for `better-auth/node`'s `fromNodeHeaders`.
 *
 * @param headers - Node's own header bag.
 * @returns The same headers, as the Fetch API spells them.
 */
export function fromNodeHeaders(headers: IncomingHttpHeaders): Headers {
  const converted = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    // `content-length` is left behind deliberately: the body is re-encoded above, so a
    // length copied from the wire can only disagree with the one `Request` computes.
    if (value === undefined || name === "content-length") continue;

    for (const each of Array.isArray(value) ? value : [value]) converted.append(name, each);
  }

  return converted;
}

/**
 * Stand in for `better-auth/api`'s `createAuthMiddleware`.
 *
 * The Nest integration calls it only when a provider carries `@Hook` methods, and this
 * service declares none. Identity is therefore the whole of the behaviour worth having,
 * and a `@Hook` added without this being revisited would find its middleware uncomposed
 * rather than silently dropped.
 *
 * @param handler - The hook to wrap.
 * @returns The same hook.
 */
export function createAuthMiddleware<T>(handler: T): T {
  return handler;
}

/**
 * Read a request body to the end.
 *
 * @param request - The incoming request. Consumed.
 * @returns Its body as text — empty when there was none, and empty when something read it
 *   first, which are the same thing as far as a handler can tell and the reason the
 *   bootstrap must not parse these routes.
 */
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);

  return Buffer.concat(chunks).toString("utf8");
}
