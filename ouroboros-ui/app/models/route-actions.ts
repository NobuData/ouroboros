"use server";

/**
 * The server hop for **Save routes**
 * ([#202](https://github.com/NobuData/ouroboros/issues/202)) — the one call the chain editor's
 * Client Components cannot make themselves.
 *
 * `app/models/rule-actions.ts` is the same seam for the rules card, and the reason is the same:
 * the browser cannot reach REST — `OURO_REST_URL` has no `NEXT_PUBLIC_` prefix and the session
 * cookie is `HttpOnly` — so a Client Component that needs to write calls a Server Action that
 * calls it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in the call and no person.** The batch is committed to *the
 *   workspace the caller's own session is acting in*, resolved by `ouroboros-rest` from the
 *   cookie this request carries; *who saved this* is read from the session there, never from
 *   a body. There is nothing to forge.
 * - **The role gate is the service's.** The page draws no handle, menu or bar for a member,
 *   but that is presentation; the `403` behind the API is the check that decides, and a
 *   member who reaches this anyway writes nothing and gets the sentence the page would have
 *   shown.
 * - **The validation is the service's too.** The editor refuses an empty chain and a breached
 *   floor before the press, and the server refuses them again — plus an alias the workspace
 *   does not have, which only it can know. Its `422` names the routes, and this hands that
 *   map back rather than a sentence, so the matrix can mark exactly the rows it refused.
 *
 * ### Failure posture: nothing moves without the server
 *
 * A refusal comes back as a **value** rather than a throw, because it is a state to render:
 * the drafts stay, the bar stays, and the offending rows say why. Only the gate's own redirect
 * signal travels as a throw, which is how a session that expired since the page rendered still
 * reaches the login screen.
 */

import { isApiError } from "@/app/api/errors";
import { type SaveRouteInput, routing } from "@/app/api/routing";

import {
  ROUTES_FORBIDDEN,
  ROUTES_SAVE_FAILURE,
  ROUTE_SAVE_INVALID_CODE,
  type SaveRoutesOutcome,
  batchProblems,
} from "./chain";
import { FORBIDDEN_CODE } from "./rules";

/**
 * Commit one press of **Save routes**.
 *
 * @param routes The batch — every changed route, as `app/models/chain.ts`'s `toSaveInput`
 *   forms it, and nothing for a route nobody edited.
 * @returns Whether it landed; or the problems the server keyed by task kind for a `422
 *   route_save_invalid`, so each row can print its own; or the sentence to show for any other
 *   refusal.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function saveRoutes(routes: readonly SaveRouteInput[]): Promise<SaveRoutesOutcome> {
  try {
    const result = await routing.saveRoutes(routes);
    return { ok: true, revisionId: result.revisionId };
  } catch (error) {
    if (!isApiError(error)) throw error;

    if (error.code === ROUTE_SAVE_INVALID_CODE) {
      return { ok: false, kind: "refused", problems: batchProblems(error.details) };
    }

    // The service's own `403` message is written for an API caller; this answers with the
    // sentence the page uses, from the one place it is written.
    if (error.code === FORBIDDEN_CODE) return { ok: false, kind: "failed", reason: ROUTES_FORBIDDEN };

    return {
      ok: false,
      kind: "failed",
      reason: error.message === "" ? ROUTES_SAVE_FAILURE : error.message,
    };
  }
}
