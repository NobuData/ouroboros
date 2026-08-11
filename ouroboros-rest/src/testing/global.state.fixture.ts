/**
 * The one thing `globalSetup` has to tell `globalTeardown`: which container to stop.
 *
 * It cannot be a module-level variable. Jest loads the two hooks through separate module
 * registries, so each would get its own copy of this file and teardown would find nothing to
 * stop — a container left running after every `yarn test:integration`, which is the failure
 * mode this file exists to avoid rather than a theoretical one.
 *
 * `globalThis` survives that, because both hooks run in the same Node process. It is used
 * for exactly one value, under a name nothing else would choose, and reading it hands the
 * value over rather than copying it: teardown takes the database and leaves the slot empty,
 * so a second call stops nothing instead of stopping a container twice.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import type { IntegrationDatabase } from "./postgres.fixture";

/** The property the database is parked on. Namespaced, because `globalThis` is shared. */
const SLOT = "__ouroborosIntegrationDatabase__";

/** `globalThis`, as the one property this module puts on it. */
interface DatabaseSlot {
  [SLOT]?: IntegrationDatabase;
}

/**
 * `globalThis`, typed as the slot.
 *
 * @returns The global object, with the one property this module owns.
 */
function slot(): DatabaseSlot {
  return globalThis as unknown as DatabaseSlot;
}

/**
 * Park the database the run started, for teardown to find.
 *
 * @param database - What `startMigratedPostgres` returned.
 */
export function rememberDatabase(database: IntegrationDatabase): void {
  slot()[SLOT] = database;
}

/**
 * Take the database back, leaving nothing behind.
 *
 * @returns The database the run started, or `undefined` when the run was handed one — in
 *   which case there is nothing to stop, because nothing was started.
 */
export function takeDatabase(): IntegrationDatabase | undefined {
  const database = slot()[SLOT];
  delete slot()[SLOT];

  return database;
}
