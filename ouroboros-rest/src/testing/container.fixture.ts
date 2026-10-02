/**
 * What every extra Testcontainer an integration suite starts shares — MinIO for the artifact
 * store (#330), mailpit for mail (#440).
 */

import type { StartedTestContainer } from "testcontainers";

/** How many times a container start that lost a port race is tried. */
const START_ATTEMPTS = 3;

/**
 * Start a container, again if Docker lost a race for its host port.
 *
 * Rootless Docker allocates a published port through its own port manager, and when several
 * suites start containers at once two can be handed the same free port — the second start fails
 * `bind: address already in use` though nothing is wrong with it. That one failure is retried; any
 * other is not.
 *
 * @param start - Starts the container.
 * @returns The started container.
 * @throws The last failure, after {@link START_ATTEMPTS}, or at once for any other failure.
 */
export async function startWithRetry(
  start: () => Promise<StartedTestContainer>,
): Promise<StartedTestContainer> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await start();
    } catch (error) {
      if (attempt >= START_ATTEMPTS || !String(error).includes("address already in use"))
        throw error;
    }
  }
}
