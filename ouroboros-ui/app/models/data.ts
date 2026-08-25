import "server-only";

/**
 * Everything the `/models` frame reads.
 *
 * Two calls — the provider health strip and the matrix — composed here for the reason
 * `app/dashboard/data.ts` exists: the route stays three lines, the composition is a function
 * that can be tested against a stub, and the screen is handed one object rather than issuing
 * calls of its own. The property the second read had to preserve is the one AA.1 established
 * with the first — **one failed read is one degraded region, never a blank page** — which is
 * why the two are attempted independently and neither can take the other down.
 *
 * ### The two reads are concurrent, and that is not an optimisation
 *
 * `Promise.all` over two {@link attempt}s, not two awaits in a row. Sequential reads would
 * make the page as slow as the sum of them for no gain, and — because the second would not
 * even start until the first had answered — a slow health check would delay a matrix that had
 * nothing to do with it. `attempt` has already turned a refusal into a value by the time
 * `Promise.all` sees it, so the *one region degraded* rule survives the concurrency: there is
 * no rejection left for `Promise.all` to short-circuit on except the ones that must travel.
 *
 * {@link attempt} is `app/api/reading.ts`'s, shared with the dashboard since
 * [#200](https://github.com/NobuData/ouroboros/issues/200). It catches an `ApiError` and
 * nothing else, deliberately: a `401` reaches this layer as Next.js's redirect signal rather
 * than as an error (`app/api/server.ts`), and a `catch` wide enough to hold it would swallow
 * the navigation to the login screen and draw a routing page captioned with the framework's
 * internal message.
 *
 * ### Nothing here asks for a check to be run
 *
 * `GET /api/v1/routing/providers` reads snapshots the service's own scheduler wrote. There
 * is no *check now* on this page and no function here that would back one — see
 * `app/api/routing.ts` for why that is a decision rather than an omission.
 */

import type { Workspace } from "@/app/api/access";
import { attempt } from "@/app/api/reading";
import { routing } from "@/app/api/routing";

import type { ModelsReadings } from "./view";

/**
 * Read the routing page.
 *
 * @param access The workspace the gate returned. **A precondition made visible in the type
 *   rather than a source of values**: none of its fields is read, because the strip is
 *   scoped to the session's own active organization and this client sends no tenant header
 *   (`app/api/server.ts`). Taking it anyway is what makes the page's authorization and the
 *   page's data one decision — there is no way to reach this read without having been
 *   through the gate, which is the property `app/(app)/layout.tsx` argues a layout cannot
 *   provide.
 * @returns Everything the screen draws, each part either read or explained.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all, which is how
 *   a session that expired between the gate and this call still reaches the login screen.
 */
export async function readModels(access: Workspace): Promise<ModelsReadings> {
  // Held, not read — see the parameter's note. The statement is what says so in code, so
  // nobody deletes an argument that is carrying a proof.
  void access;

  const [providers, matrix] = await Promise.all([
    attempt(async () => (await routing.providers()).providers),
    attempt(async () => routing.matrix()),
  ]);

  return {
    providers,
    matrix,
    // Zero until there is something on this page that can *change* a route. The matrix
    // (AA.2, #201) draws routes and selects one; editing them is chain editing's (AA.3,
    // #202), and a figure above zero arrives with it. The figure is carried rather than
    // assumed so that `saveRoutesReason` stays the one rule deciding the control's state.
    pending: 0,
  };
}
