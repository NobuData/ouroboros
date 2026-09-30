"use server";

/**
 * The server hops for the learned-facts card
 * (BG.3, [#419](https://github.com/NobuData/ouroboros/issues/419)) — the calls its Client
 * Components cannot make themselves: the five transitions, and the manual proposal.
 *
 * `app/knowledge/skills-actions.ts` is the same seam for the skills table and states the rule:
 * the browser cannot reach REST, so a Client Component that needs the API calls a Server Action
 * that calls it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in the call and no person.** The fact belongs to the workspace the
 *   caller's own session is acting in, and **the actor is the session's person**, both resolved
 *   by `ouroboros-rest` from the cookie — which is what makes *confirmed by Ken* a recorded
 *   decision rather than a claim the page made.
 * - **The gates are the service's.** A viewer's buttons are drawn inert, but that is presentation;
 *   a viewer who reaches {@link decideFact} anyway gets `403 forbidden` back as a value and
 *   changes nothing. A transition off the lifecycle's edges is `409 fact_transition_refused`.
 *
 * A refusal comes back as a value, not a throw, so the row can show it. The one throw that must
 * travel is Next.js's redirect signal. A `"use server"` module may export only async functions,
 * so the sentences live in `app/knowledge/facts.ts`.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import { isApiError } from "@/app/api/errors";
import { type Fact, type ProposeFactBody, facts } from "@/app/api/facts";

import type { FactVerb } from "./facts";

/** What one call produced: the service's answer, or its refusal as a value. */
export type FactActionOutcome =
  | { readonly ok: true; readonly value: Fact }
  | { readonly ok: false; readonly refusal: ErrorEnvelope };

/**
 * Run one call, keeping the service's refusal as a value.
 *
 * @param call The call.
 * @returns Its answer, or the envelope.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
async function outcome(call: () => Promise<Fact>): Promise<FactActionOutcome> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      refusal: { code: error.code, message: error.message, details: error.details },
    };
  }
}

/**
 * Move one fact along its lifecycle.
 *
 * @param factId The fact.
 * @param verb Which edge: `confirm`, `reject`, `reconfirm`, `expire` or `relearn`.
 * @param reason The note beside the transition — **required** for `expire`, where it is the
 *   reason the row prints; optional for the rest; the new text for a `relearn`, or absent for the
 *   expired fact's own.
 * @returns The fact as the service now holds it — for a `relearn`, the **new** proposal — or the
 *   service's refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function decideFact(factId: string, verb: FactVerb, reason?: string): Promise<FactActionOutcome> {
  const note = reason === undefined || reason === "" ? undefined : reason;

  switch (verb) {
    case "confirm":
      return outcome(() => facts.confirm(factId, note === undefined ? {} : { reason: note }));
    case "reject":
      return outcome(() => facts.reject(factId, note === undefined ? {} : { reason: note }));
    case "reconfirm":
      return outcome(() => facts.reconfirm(factId, note === undefined ? {} : { reason: note }));
    case "expire":
      return outcome(() => facts.expire(factId, { reason: note ?? "" }));
    case "relearn":
      return outcome(() => facts.relearn(factId, note === undefined ? {} : { text: note }));
  }
}

/**
 * Propose a fact by hand. It is born `proposed`.
 *
 * @param body The text, and optionally the repository, the provenance line and the anchors, as
 *   the dialog composed them — forwarded as they are.
 * @returns The new proposal, or the service's refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function proposeFact(body: ProposeFactBody): Promise<FactActionOutcome> {
  return outcome(() => facts.propose(body));
}
