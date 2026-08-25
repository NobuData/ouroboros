"use server";

/**
 * The server hop for **Simulate routing**
 * ([#203](https://github.com/NobuData/ouroboros/issues/203)) — the one call the panel's
 * Client Component cannot make itself.
 *
 * `app/models/route-actions.ts` is the same seam for **Save routes**, and the reason is the
 * same: the browser cannot reach REST — `OURO_REST_URL` has no `NEXT_PUBLIC_` prefix and the
 * session cookie is `HttpOnly` — so a Client Component that needs an answer calls a Server
 * Action that asks for it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in the call and no person.** The question is asked of *the
 *   workspace the caller's own session is acting in*, resolved by `ouroboros-rest` from the
 *   cookie this request carries. A body that could name a workspace would be a body that
 *   could simulate somebody else's routes, and the contract has no such field.
 * - **There is no role gate to duplicate.** Any member may simulate, viewers included:
 *   looking at which model would answer a piece of work changes nothing.
 * - **The validation is the service's.** A context carrying a fact no rule could read is its
 *   `422`, and the sentence comes back here as the reason the panel prints.
 *
 * ### Failure posture: a refusal is a sentence, a `fail_run` is an answer
 *
 * The one thing this module must not do is treat `outcome: "fail_run"` as a failure. It
 * arrives as a `200` carrying a reason, because the caller asked a well-formed question
 * about a route that exists and is entitled to know what the route did; it travels through
 * here as a resolution like any other, and the panel draws it as the outcome it is. Only a
 * refusal — a `404` for a kind with no route, a `422`, a `503` — becomes a reason, and only
 * the gate's own redirect signal travels as a throw.
 */

import { isApiError } from "@/app/api/errors";
import { type RoutingSimulationRequest, routing } from "@/app/api/routing";

import { SIMULATE_FAILURE, type SimulationReading } from "./simulation";

/**
 * Ask what would run.
 *
 * @param request The question — a task kind and what is known about the work, as
 *   `app/models/simulation.ts`'s `composeSimulation` forms it.
 * @returns The resolution, `fail_run` included; or the sentence to show for a refusal.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all, which is how a
 *   session that expired since the page rendered still reaches the login screen.
 */
export async function simulateRoute(request: RoutingSimulationRequest): Promise<SimulationReading> {
  try {
    return { ok: true, resolution: await routing.simulate(request) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: error.message === "" ? SIMULATE_FAILURE : error.message };
  }
}
