import "server-only";

/**
 * Everything the planning page reads (AM.1, [#283](https://github.com/NobuData/ouroboros/issues/283);
 * AM.2, [#284](https://github.com/NobuData/ouroboros/issues/284)).
 *
 * The roadmap, for its region's head; the workspace's ticket sources and the source catalog, which
 * both the generator card's capability-gated tracker segment and AM.3's tracker-sync rows are built
 * from; the backlog health figures the health card's meters are; and, when the address names one,
 * the batch the generator card opens on. Composed here for the reason every screen's `data.ts`
 * exists: the route stays thin, and the screen is handed one object.
 *
 * Every read is an {@link attempt}, made concurrently, so a refusal is one degraded region rather
 * than a blank page.
 *
 * ### `now` is taken once, here
 *
 * The health card's footnote says how long ago the nightly job last ran, and the sources page took
 * the same decision for its *synced 40s ago* (`app/sources/data.ts`): one instant, taken on the
 * server and handed down, so every relative phrase on the page agrees with the others and a
 * hydration pass renders what the server rendered.
 */

import type { Workspace } from "@/app/api/access";
import { planning } from "@/app/api/planning";
import { attempt } from "@/app/api/reading";
import { sources } from "@/app/api/sources";

import type { PlanningReadings } from "./view";

/**
 * Read the planning page.
 *
 * @param access The workspace the gate returned — a precondition made visible in the type rather
 *   than a source of values: every call is scoped to the session's own active organization.
 * @param batchId The batch the address names (`generator.ts`'s `parseBatchParam`), or `null`.
 * @param now The instant to measure the health footnote's *ago* from. Defaults to the clock; a
 *   suite passes one to hold the arithmetic still.
 * @returns What the screen draws, each part either read or explained.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function readPlanning(
  access: Workspace,
  batchId: string | null = null,
  now: Date = new Date(),
): Promise<PlanningReadings> {
  // Held, not read — see the parameter's note.
  void access;

  const [roadmap, sourcePage, catalog, health, batch] = await Promise.all([
    attempt(() => planning.roadmap()),
    attempt(() => sources.list()),
    attempt(() => sources.catalog()),
    attempt(() => planning.health()),
    batchId === null ? Promise.resolve(null) : attempt(() => planning.batch(batchId)),
  ]);

  return { roadmap, sources: sourcePage, catalog, health, batch, now: now.toISOString() };
}
