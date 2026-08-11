/**
 * What `yarn test:integration` does after the last suite: stop what it started.
 *
 * Jest runs `globalTeardown` once, in the parent process, whether the run was green or red —
 * so a failing suite does not leave a PostgreSQL behind. Testcontainers' reaper would collect
 * it eventually, and eventually is not the same as by the time the developer runs `docker ps`.
 *
 * A run that was handed a database stops nothing: `global.state.fixture.ts` holds a value
 * only when this process started one, so a developer's `docker compose` stack survives the
 * suite exactly as it survived it before the harness existed.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import { takeDatabase } from "./global.state.fixture";

/**
 * Stop the database this run started, if it started one.
 *
 * @returns When the container and its network are gone.
 */
export default async function tearDown(): Promise<void> {
  await takeDatabase()?.stop();
}
