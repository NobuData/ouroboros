import "server-only";

/**
 * Everything the planning frame reads (AM.1, [#283](https://github.com/NobuData/ouroboros/issues/283)).
 *
 * One call today — the roadmap, for its region's head — composed here for the reason every screen's
 * `data.ts` exists: the route stays thin, and the screen is handed one object. AM.2 and AM.3
 * ([#284](https://github.com/NobuData/ouroboros/issues/284),
 * [#285](https://github.com/NobuData/ouroboros/issues/285)) add their reads beside it.
 *
 * The read is an {@link attempt}, so a refusal is one degraded region rather than a blank page.
 */

import type { Workspace } from "@/app/api/access";
import { planning } from "@/app/api/planning";
import { attempt } from "@/app/api/reading";

import type { PlanningReadings } from "./view";

/**
 * Read the planning frame.
 *
 * @param access The workspace the gate returned — a precondition made visible in the type rather
 *   than a source of values: the call is scoped to the session's own active organization.
 * @returns What the screen draws, each part either read or explained.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function readPlanning(access: Workspace): Promise<PlanningReadings> {
  // Held, not read — see the parameter's note.
  void access;

  return { roadmap: await attempt(() => planning.roadmap()) };
}
