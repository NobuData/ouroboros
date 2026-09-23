import "server-only";

/**
 * The run console's first read, on the server
 * ([#309](https://github.com/NobuData/ouroboros/issues/309)).
 *
 * What the page paints before the browser's poll has answered. Three outcomes, because the
 * page treats them three ways: a snapshot, a run that does not exist *for this workspace* (the
 * route's `notFound()` — the service answers `404 run_not_found` for another workspace's run
 * exactly as for no run at all, and `400` for an id that is not a uuid), and a failure the page
 * draws as a banner while the poll keeps asking.
 */

import { isApiError } from "@/app/api/errors";
import { type RunConsole, runs } from "@/app/api/runs";

/** What the first read found. */
export type RunReading =
  | { readonly state: "found"; readonly value: RunConsole }
  | { readonly state: "missing" }
  | { readonly state: "failed"; readonly reason: string };

/**
 * Read one run for the page.
 *
 * @param id The run's id, from the URL.
 * @param read How to read it. Replaced in tests.
 * @returns The reading. An error that is not the API's own is rethrown — a bug is not a
 *   banner.
 */
export async function readRun(
  id: string,
  read: (id: string) => Promise<RunConsole> = (asked) => runs.console(asked),
): Promise<RunReading> {
  try {
    return { state: "found", value: await read(id) };
  } catch (error) {
    if (!isApiError(error)) throw error;
    if (error.status === 404 || error.status === 400) return { state: "missing" };

    return { state: "failed", reason: error.message };
  }
}
