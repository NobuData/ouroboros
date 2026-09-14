"use server";

/**
 * The server hop for the **resolution chain** card
 * ([#595](https://github.com/NobuData/ouroboros/issues/595)) — the one read its Client
 * Component cannot make itself.
 *
 * The card follows the table's selection, which is client state, so the chain is read when a
 * row is selected rather than with the page. `app/models/simulate-actions.ts` is the same seam
 * for the Simulate panel, and the reason is the same: the browser cannot reach REST —
 * `OURO_REST_URL` has no `NEXT_PUBLIC_` prefix and the session cookie is `HttpOnly`.
 *
 * ### The source, in order — and the order is the honesty
 *
 * 1. **The latest persisted snapshot touching the alias** (CH.6,
 *    [#589](https://github.com/NobuData/ouroboros/issues/589)). A run happened; draw it.
 * 2. Otherwise **Simulate** (Z.4, [#197](https://github.com/NobuData/ouroboros/issues/197)) for
 *    the alias's primary task kind, which the card labels as simulated.
 * 3. Otherwise — no route names the alias — *nothing to simulate*, which the card explains.
 *
 * A routes read that failed is not step 3: without the routes nobody knows whether the alias is
 * routed, so the card is told the page's own reason instead of a guess.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in the call and no person.** Both reads are asked of the workspace
 *   the caller's own session is acting in, resolved by `ouroboros-rest` from the cookie; an
 *   alias from another workspace simply has no snapshot and names no route there.
 * - **There is no role gate to duplicate.** Any member may read a snapshot or simulate: looking
 *   at how a name resolves changes nothing.
 * - **The task kind is only ever a question.** A caller who sends a different one is asking
 *   Simulate a different well-formed question, which it may already ask from the routing page.
 *
 * ### Failure posture: a refusal is a sentence
 *
 * A refused read comes back as a value the card renders in place of the rail. The one throw
 * that must travel is Next.js's redirect signal, for a session that expired since the page
 * rendered. A `fail_run` is not a refusal: it is a resolution, and the card draws it.
 */

import { isApiError } from "@/app/api/errors";
import { registry } from "@/app/api/registry";
import { routing } from "@/app/api/routing";

import { CHAIN_FAILURE, type ChainReading, type RouteLookup } from "./chain";

/**
 * Read how one alias resolves.
 *
 * @param alias The selected alias, by name.
 * @param route What the page knows about the routes naming it — `app/registry/chain.ts`'s
 *   `routeLookups`.
 * @returns A snapshot, a simulation, or *unrouted*; or the sentence to show for a refusal.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function readChain(alias: string, route: RouteLookup): Promise<ChainReading> {
  try {
    const { snapshot } = await registry.latestResolution(alias);

    if (snapshot !== null) return { ok: true, source: { kind: "snapshot", snapshot } };
    if (route.kind === "unknown") return { ok: false, reason: route.reason };
    if (route.kind === "unrouted") return { ok: true, source: { kind: "unrouted" } };

    const resolution = await routing.simulate({ taskKind: route.taskKind });

    return { ok: true, source: { kind: "simulated", resolution } };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: error.message === "" ? CHAIN_FAILURE : error.message };
  }
}
