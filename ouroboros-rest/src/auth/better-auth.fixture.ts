/**
 * BetterAuth, as a CommonJS test runner can hold it.
 *
 * `better-auth` is published as ES modules and this suite runs on Jest's CommonJS
 * runtime, so every spec that builds the application would fail to parse the library
 * before it asserted anything. `jest.config.mjs` maps the four specifiers the running
 * code reaches for — `better-auth`, `better-auth/node`, `better-auth/api` and, since
 * [#704](https://github.com/NobuData/ouroboros/issues/704), `better-auth/plugins` — at this
 * one module, which is why it exports a function for each of them rather than one thing.
 *
 * **Not every subpath is replaced.** `better-auth/plugins/access` and
 * `better-auth/plugins/organization/access` are *converted* and loaded for real — they are
 * small, and #704's role model has to be assertable against the library rather than against
 * this file. See `jest.config.mjs`'s `transformIgnorePatterns` for where that line is drawn.
 *
 * **What it is not is a mock of the code under test.** The Nest integration
 * (`@thallesp/nestjs-better-auth`) is loaded for real — `jest.esm-transform.cjs` converts
 * it — so the body parser it re-adds, the routes it excludes from the global prefix, the
 * handler it registers on the adapter and, since
 * [#703](https://github.com/NobuData/ouroboros/issues/703), **the global `AuthGuard` that
 * decides every request** are the genuine article. This stands in for the *other* side of
 * that seam: the library the integration hands requests to. That the real library accepts
 * these options is proven where Jest cannot reach: by `@better-auth/cli generate` building
 * an instance from `auth.config.ts` (`README.md` § Generating the auth schema).
 *
 * ## Two things it implements rather than fakes
 *
 * {@link toNodeHandler} is written to be *faithful rather than convenient*, because one
 * property of it is the acceptance criterion: it reads the request **stream**. A bootstrap
 * that let Nest parse bodies globally would leave that stream drained, and the echo below
 * would report an empty body — which is exactly how `application.spec.ts` tells a working
 * `bodyParser: false` from a broken one.
 *
 * {@link sessionApi} is #703's counterpart, and it exists for the same reason: **the
 * session is a row**, and answering revocation out of a map would make every assertion
 * about it an assertion about this file. So `getSession` reads `ouroboros.session` joined
 * to `ouroboros."user"` over the pool the application was configured with, and `signOut`
 * deletes the row — which is what lets the integration suite assert the acceptance criteria
 * as behaviour: sign out, present the same cookie, get `401`.
 *
 * There *is* a map, {@link grantSession}, and it is for the suite that has no database at
 * all rather than an alternative to the row. It is checked first, so a spec that granted
 * nothing behaves exactly as though it were not there; see its own comment for the bound
 * on what a granted session can be used to claim.
 *
 * Two simplifications, both stated because they bound what these suites prove:
 *
 *   * **The cookie's signature is not verified.** The real library signs the token —
 *     `token.signature` — and this reads everything before the first `.` as the token.
 *     Forgery is the library's problem and is not what any suite here asserts; what they
 *     assert is which routes need a session and what deleting one does.
 *   * **The cookie cache is not implemented.** Every call is the lookup, which is the
 *     *worst* case for the query-count criterion rather than the best, so a suite counting
 *     statements is counting the ceiling. The cache itself is asserted where it is decided,
 *     in `session.options.spec.ts`.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

import type { BetterAuthOptions } from "better-auth";

import { SESSION_COOKIE, SESSION_DATA_COOKIE } from "./session.options";

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

/** A session and the person it belongs to, as `getSession` answers. */
export interface StubbedSession {
  /** The `ouroboros.session` row, in the library's vocabulary. */
  readonly session: {
    readonly id: string;
    readonly token: string;
    readonly userId: string;
    readonly expiresAt: Date;
  };
  /** The `ouroboros."user"` row it names. */
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly emailVerified: boolean;
    readonly image: string | null;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  };
}

/** The server-side callers this stand-in offers — the two #703's code reaches for. */
export interface StubbedApi {
  /** Resolve the caller's session, or `null`. What the global `AuthGuard` calls. */
  getSession(request: { headers: Headers }): Promise<StubbedSession | null>;
  /** End it: delete the row, and answer with the cookie removals. */
  signOut(request: { headers: Headers; asResponse: true }): Promise<Response>;
}

/** The part of a BetterAuth instance the Nest integration and these specs use. */
export interface StubbedAuth {
  /** The options it was built from. The integration reads `basePath` off this. */
  readonly options: BetterAuthOptions;
  /** The library's own request handler, over the Fetch API, as the real one is. */
  handler(request: Request): Promise<Response>;
  /** The server-side callers — see {@link sessionApi}. */
  readonly api: StubbedApi;
}

/**
 * The one thing this stand-in needs of a `pg` pool, named structurally.
 *
 * `BetterAuthOptions["database"]` is a union of everything the real library accepts and a
 * pool is one member of it; narrowing to "something that can run a statement" is what lets
 * a spec that never configured a database hand this an object literal, and what keeps the
 * fixture from importing `pg` for a type.
 */
interface Queryable {
  query<T>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Stand in for `betterAuth()`.
 *
 * @param options - Whatever `authOptions` produced. Kept, and — since #703 — partly read:
 *   the integration needs `options.basePath` to know where to mount, a spec needs the rest
 *   to assert that the service's own decisions arrived intact, and `options.database` is
 *   the pool {@link sessionApi} issues its statements over.
 * @returns An instance shaped like the library's, whose handler echoes what it was given
 *   and whose `api` reads and deletes real session rows.
 */
export function betterAuth(options: BetterAuthOptions): StubbedAuth {
  return {
    options,
    api: sessionApi(options.database as Queryable | undefined),
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

/** A plugin, as much of one as anything here reads: an id and the options it was built from. */
export interface StubbedPlugin {
  /** The plugin's id — `"organization"`, which is what the library keys it by. */
  readonly id: string;
  /** The options it was given. What `auth.factory.spec.ts` asserts about. */
  readonly options: unknown;
}

/**
 * Stand in for `better-auth/plugins`' `organization`.
 *
 * The real one builds some forty endpoints, a schema and an access-control layer, and it
 * reaches `better-auth/api` to do it — which is the whole library, and the reason this
 * subpath is replaced rather than converted like the two access-control modules beside it.
 *
 * What a spec can usefully assert here is *which options this service decided on*, and that
 * is preserved exactly. The options themselves are asserted directly, without this file, in
 * `organization.plugin.spec.ts`; that the real plugin accepts them is proven where Jest
 * cannot reach, by `@better-auth/cli generate` building a genuine instance from
 * `auth.config.ts` with this plugin registered — which is how `V005` was generated
 * ([#707](https://github.com/NobuData/ouroboros/issues/707)).
 *
 * @param options - Whatever `organizationOptions()` produced.
 * @returns A plugin-shaped object carrying them.
 */
export function organization(options: unknown): StubbedPlugin {
  return { id: "organization", options };
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
 * Sessions a suite granted by hand, keyed by token.
 *
 * The unit suite starts no database — its pool can never connect — and several of its
 * specs still need a signed-in caller: "the engine route answers somebody who is signed
 * in", "the tenant guard runs after the auth guard", "this route is not open to
 * strangers". Before [#703](https://github.com/NobuData/ouroboros/issues/703) those suites
 * replaced `AuthService` with an object; there is no such provider to replace now, because
 * the guard asks the library.
 *
 * So the stand-in keeps a map, checked before the pool. A token in it resolves with no
 * statement at all — which is also, not coincidentally, exactly what the real library does
 * when its cookie cache is fresh.
 *
 * Module-level state in a fixture is worth being uneasy about; two things bound it. Jest
 * gives every spec file its own module registry, so this is per-file rather than global,
 * and {@link revokeGrantedSessions} exists for a file that grants more than one.
 */
const grantedSessions = new Map<string, StubbedSession>();

/**
 * Sign a caller in, for a suite with no database.
 *
 * @param user - Whatever the suite cares about the person. Everything else is filled in.
 * @returns The `Cookie` header value, ready for Supertest's `.set("Cookie", …)`.
 */
export function grantSession(user: Partial<StubbedSession["user"]> = {}): string {
  const token = `granted-${grantedSessions.size + 1}`;
  const now = new Date("2026-08-11T10:20:23.114Z");
  const resolved: StubbedSession["user"] = {
    id: "5eed0003-0000-4000-8000-000000000001",
    name: "Ken Suenobu",
    email: "ken@acme-robotics.dev",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
    ...user,
  };

  grantedSessions.set(token, {
    session: {
      id: `granted-session-${grantedSessions.size + 1}`,
      token,
      userId: resolved.id,
      expiresAt: new Date("2026-08-18T10:20:23.114Z"),
    },
    user: resolved,
  });

  return `${SESSION_COOKIE}=${token}`;
}

/** Forget every session {@link grantSession} handed out. */
export function revokeGrantedSessions(): void {
  grantedSessions.clear();
}

/**
 * The two server-side callers, over the session tables.
 *
 * A closure over the pool rather than a class, because the only state is the pool and the
 * only reason it is a factory at all is that a spec with no database must still be able to
 * build an instance — which is what {@link Queryable} being optional buys.
 *
 * @param pool - The connection pool the application was configured with, or `undefined` in
 *   a spec that configured none.
 * @returns The `api` half of a stand-in instance.
 */
function sessionApi(pool: Queryable | undefined): StubbedApi {
  return {
    async getSession({ headers }) {
      const token = sessionTokenFrom(headers);

      // No cookie, no statement — which is the real library's behaviour too, and the reason
      // a unit suite whose pool can never connect can still exercise anonymous routes
      // through the guard.
      if (token === undefined) {
        return null;
      }

      const granted = grantedSessions.get(token);

      if (granted !== undefined || pool === undefined) {
        return granted ?? null;
      }

      const { rows } = await pool.query<SessionRow>(
        `select s."id"            as "sessionId",
                s."token"         as "token",
                s."userId"        as "userId",
                s."expiresAt"     as "expiresAt",
                u."name"          as "name",
                u."email"         as "email",
                u."emailVerified" as "emailVerified",
                u."image"         as "image",
                u."createdAt"     as "createdAt",
                u."updatedAt"     as "updatedAt"
           from session s
           join "user" u on u."id" = s."userId"
          where s."token" = $1 and s."expiresAt" > now()`,
        [token],
      );

      const row = rows[0];

      return row === undefined
        ? null
        : {
            session: {
              id: row.sessionId,
              token: row.token,
              userId: row.userId,
              expiresAt: row.expiresAt,
            },
            user: {
              id: row.userId,
              name: row.name,
              email: row.email,
              emailVerified: row.emailVerified,
              image: row.image,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            },
          };
    },

    async signOut({ headers }) {
      const token = sessionTokenFrom(headers);

      if (token !== undefined) {
        grantedSessions.delete(token);

        if (pool !== undefined) {
          await pool.query(`delete from session where "token" = $1`, [token]);
        }
      }

      // Both cookies, always — the token and the cache — because signing out has to work
      // for a browser whose session had already expired, which is the whole reason the
      // route is anonymous.
      const answer = new Headers({ "content-type": "application/json" });
      answer.append("set-cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
      answer.append(
        "set-cookie",
        `${SESSION_DATA_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
      );

      return new Response(JSON.stringify({ success: true }), { status: 200, headers: answer });
    },
  };
}

/** The join `getSession` selects, flattened as `pg` returns it. */
interface SessionRow {
  sessionId: string;
  token: string;
  userId: string;
  expiresAt: Date;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The session token out of a request's cookies.
 *
 * @param headers - The request's headers, as the guard converted them.
 * @returns The token, or `undefined` when the cookie is absent or empty. The value is split
 *   at the first `.` because the real library stores `token.signature`; this reads the
 *   token half and does not verify the other — see this module's header on what that bounds.
 */
function sessionTokenFrom(headers: Headers): string | undefined {
  const header = headers.get("cookie");

  if (header === null) {
    return undefined;
  }

  for (const entry of header.split(";")) {
    const [name, ...rest] = entry.trim().split("=");

    if (name === SESSION_COOKIE) {
      const token = rest.join("=").split(".")[0];
      return token === "" ? undefined : token;
    }
  }

  return undefined;
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
