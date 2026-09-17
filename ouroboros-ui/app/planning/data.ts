import "server-only";

/**
 * Everything the planning page reads (AM.1, [#283](https://github.com/NobuData/ouroboros/issues/283);
 * AM.2, [#284](https://github.com/NobuData/ouroboros/issues/284)).
 *
 * The roadmap, for its region's head; the workspace's ticket sources and the source catalog, which
 * the generator card builds its capability-gated tracker segment from; and, when the address names
 * one, the batch the card opens on. Composed here for the reason every screen's `data.ts` exists:
 * the route stays thin, and the screen is handed one object. AM.3
 * ([#285](https://github.com/NobuData/ouroboros/issues/285)) adds its reads beside these.
 *
 * Every read is an {@link attempt}, made concurrently, so a refusal is one degraded region rather
 * than a blank page.
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
 * @returns What the screen draws, each part either read or explained.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function readPlanning(
  access: Workspace,
  batchId: string | null = null,
): Promise<PlanningReadings> {
  // Held, not read — see the parameter's note.
  void access;

  const [roadmap, sourcePage, catalog, batch] = await Promise.all([
    attempt(() => planning.roadmap()),
    attempt(() => sources.list()),
    attempt(() => sources.catalog()),
    batchId === null ? Promise.resolve(null) : attempt(() => planning.batch(batchId)),
  ]);

  return { roadmap, sources: sourcePage, catalog, batch };
}
