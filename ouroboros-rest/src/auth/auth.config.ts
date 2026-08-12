/**
 * BetterAuth, standing on its own — the file `@better-auth/cli` is pointed at.
 *
 * ```sh
 * npx @better-auth/cli@1.4.21 generate --config src/auth/auth.config.ts
 * ```
 *
 * That command is the whole reason this file exists — `README.md` § Generating the auth
 * schema is where it is written down, including why the CLI is pinned there and is not a
 * dependency of this module.
 * [#706](https://github.com/NobuData/ouroboros/issues/706) has to write a Flyway migration
 * for BetterAuth's tables, and roadmap decision **A3** says Flyway stays the only thing
 * allowed to change the schema — so the SQL is *generated* from this configuration and
 * hand-ported into `V004`, rather than transcribed from documentation into a migration
 * nothing checks. For the CLI to generate it, it has to be able to load the configuration
 * with no Nest process anywhere, which is what every "imports nothing from NestJS" in
 * `auth.options.ts` and `auth.factory.ts` is in aid of.
 *
 * **Nothing in the application imports this module**, and that is load-bearing rather
 * than incidental: {@link auth} is built the moment the file is loaded, and building it
 * opens the pool below. [#701](https://github.com/NobuData/ouroboros/issues/701) wires
 * Nest to `createAuth` in `auth.factory.ts` and hands it `DatabaseService`'s pool, so a
 * running service has exactly one pool — and this file, which is the only thing here that
 * could open a second, is reachable from no module the application loads.
 *
 * The environment is read here the way `main.ts` reads it — the repo-root `.env`, then
 * this module's, then the real process environment — so the command needs nothing
 * exported that `yarn dev` would not. A missing variable throws
 * `ConfigurationError` naming it, which is the same sentence a failed boot prints.
 */

import { Pool } from "pg";

import { loadConfiguration } from "../modules/config/configuration";
import { environmentWithDotenv } from "../modules/config/dotenv";
import { poolOptions } from "../modules/db/pool";
import { createAuth, type Auth } from "./auth.factory";

/**
 * Connections a CLI command may hold.
 *
 * One. The service's pool is sized for concurrent requests
 * (`src/modules/db/pool.ts`); a command that introspects a schema and exits issues its
 * statements one after another, and a pool that opened ten of them would take a tenth of
 * PostgreSQL's connection budget away from whatever else is running against the
 * development database at the time.
 */
export const CLI_POOL_CONNECTIONS = 1;

/**
 * Open a pool for the length of a command.
 *
 * Built from `poolOptions` rather than from a connection string alone, so the CLI reads
 * the schema on the same `search_path` the service writes it on — without which
 * `generate` would introspect `public`, find none of the Flyway-owned tables, and emit a
 * migration that recreates the lot.
 *
 * @param databaseUrl - `OURO_DATABASE_URL`, already validated.
 * @returns A pool of {@link CLI_POOL_CONNECTIONS} connections. It is not closed: the CLI
 *   ends the process when it has written its SQL, and a pool that outlives its command by
 *   milliseconds is not worth a shutdown hook the application would then have to skip.
 */
export function commandPool(databaseUrl: string): Pool {
  return new Pool({ ...poolOptions(databaseUrl), max: CLI_POOL_CONNECTIONS });
}

/**
 * The environment this command was run with, validated.
 *
 * Read once, at load: the CLI is a process that does one thing, and a second read is a
 * second chance for the two to disagree.
 */
const configuration = loadConfiguration(environmentWithDotenv(process.env));

/**
 * The instance the CLI reads.
 *
 * Exported under the name `@better-auth/cli` looks for, and as the default export, since
 * the loader accepts either and a config file that works only under one of them is a
 * command that fails with "couldn't read your auth config".
 */
export const auth: Auth = createAuth({
  configuration,
  pool: commandPool(configuration.databaseUrl),
});

export default auth;
