/**
 * What `yarn test:integration` does before the first suite: make sure there is a database.
 *
 * Jest's `globalSetup` runs once per run, in the parent process, before any test environment
 * exists — which is the only place a container can be started without every suite starting
 * one of its own. It publishes the connection string as `OURO_DATABASE_URL`, and Jest copies
 * the environment into each test environment as it creates them, so a suite reads the
 * variable exactly as it would read one an operator had exported.
 *
 * That is what makes the change invisible to the suites. `db.integration-spec.ts`,
 * `auth.integration-spec.ts` and `tenancy.integration-spec.ts` were written against a
 * database somebody else started and still are; the only difference is that "somebody else"
 * is now this file when nothing has volunteered.
 *
 * **An `OURO_DATABASE_URL` already in the environment wins, and nothing is started.** A
 * developer with `docker compose up -d` running gets their own stack — inspectable
 * afterwards, and seeded — and CI could pin the suite to a service container by exporting
 * one. What is gone is the *requirement* to do either.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import { rememberDatabase } from "./global.state.fixture";
import { DISPOSABLE, IS_DISPOSABLE } from "./integration.fixture";
import { startMigratedPostgres } from "./postgres.fixture";

/**
 * Start and migrate the database the run will use, unless one was supplied.
 *
 * A container this process started is also declared *disposable* — see {@link DISPOSABLE},
 * which is what lets the harness empty it between tests without risking a database somebody
 * wanted to keep.
 *
 * @returns When the suites may begin.
 * @throws {Error} When Docker cannot be reached or the migrations fail — see
 *   `postgres.fixture.ts`, which is where the reason comes from. Failing here fails the
 *   whole run before a single suite is loaded, which is the right shape: a suite that
 *   skipped itself for want of a database would report "the constraints are mapped" having
 *   mapped nothing.
 */
export default async function setUp(): Promise<void> {
  const supplied = process.env.OURO_DATABASE_URL;

  if (supplied !== undefined && supplied !== "") {
    return;
  }

  const database = await startMigratedPostgres();

  process.env.OURO_DATABASE_URL = database.url;
  process.env[DISPOSABLE] = IS_DISPOSABLE;
  rememberDatabase(database);
}
