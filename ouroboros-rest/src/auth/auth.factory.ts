/**
 * Where the library is reached for: options in, a BetterAuth instance out.
 *
 * It is one function and its own file for a reason that is entirely about *where* the
 * import lands. `better-auth` ships as ES modules only, and this service compiles to
 * CommonJS (`tsconfig.json`, because Nest's dependency injection needs the decorator
 * metadata that setting emits). Node 24 bridges the two with `require(esm)`, which is why
 * the service runs; Jest's CommonJS runtime does not, which is why every suite that
 * reaches this file substitutes the library. So the module that names `better-auth` as a
 * *value* is kept to these few lines, and everything worth asserting about the
 * configuration lives next door in `auth.options.ts` — which imports the library's types
 * only, and is therefore ordinary TypeScript any runner can load.
 *
 * That the real library accepts these options is proven where it cannot be faked: by
 * `@better-auth/cli generate` reading `auth.config.ts`, building a genuine instance and
 * emitting the schema (`README.md` § Generating the auth schema).
 *
 * @see auth.options.ts — the options, and the decisions in them.
 * @see auth.config.ts — the standalone instance `@better-auth/cli` loads.
 */

import { betterAuth } from "better-auth";

import { authOptions, type AuthDependencies } from "./auth.options";

/**
 * A configured BetterAuth instance.
 *
 * Inferred from `betterAuth()` rather than written out, because the type carries the
 * plugins' endpoints with it: once
 * [#704](https://github.com/NobuData/ouroboros/issues/704) adds the organization plugin,
 * `auth.api` gains its routes here without this line changing.
 */
export type Auth = ReturnType<typeof createAuth>;

/**
 * Build the service's BetterAuth instance.
 *
 * Nothing is opened here: `betterAuth()` assembles routes and reads options, and the
 * adapter's first statement is issued on the first request that needs one — so a process
 * that never signs anybody in never touches the database on this account.
 *
 * @param dependencies - The validated configuration and the connection pool to share.
 *   [#701](https://github.com/NobuData/ouroboros/issues/701) passes `DatabaseService`'s;
 *   `auth.config.ts` passes one it opened for the length of a CLI command.
 * @returns The instance: its handler, its `api`, and the options it was built from.
 */
export function createAuth(dependencies: AuthDependencies) {
  return betterAuth(authOptions(dependencies));
}
