/**
 * What resolution refuses, and the one thing it refuses that is not a `fail_run`.
 *
 * Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194)). The same shape and the same
 * argument as `pricing/pricing.errors.ts` and `registry/registry.errors.ts`: a code is only
 * meaningful beside the operation that produces it, and this file exists so the string in the
 * specification and the string in the answer come from one constant.
 *
 * ---------------------------------------------------------------------------
 * **There is exactly one error here, and the reason there is only one is the interesting
 * part.**
 *
 * Almost everything that can go wrong with a resolution is not an error — it is an *answer*.
 * Every provider down, the floor breached, a chain filtered to nothing: those are
 * `fail_run` resolutions carrying an explanation, because the caller asked a well-formed
 * question about a route that exists and deserves to be told what the route did. Turning any
 * of them into a `500` or a `422` would throw away the explanations this ticket is mostly
 * about.
 *
 * {@link ROUTING_ERRORS.routeNotFound} is the one case that genuinely is not an answer: the
 * workspace has no route for that task kind, so there is no chain to explain and nothing to
 * annotate. A `404` rather than a `422`, because nothing about the request is malformed — the
 * kind is a perfectly good name, this workspace simply does not have it, and V016 lets a
 * workspace delete a kind it never uses.
 */

import { NotFoundError } from "../errors/error.envelope";

/**
 * The codes, as one object.
 *
 * `as const` so each value is its own literal type, and so `routing.errors.spec.ts` can hold
 * the published copy to these.
 */
export const ROUTING_ERRORS = {
  /**
   * This workspace has no route for that task kind.
   *
   * Reachable two ways, and both are the caller's: a name the workspace never had, and a kind
   * that exists with no route pointing at it. V016 makes the second possible on purpose —
   * `routes.task_kind_id` is unique, not mandatory — so the message names the kind rather
   * than guessing which of the two it was.
   */
  routeNotFound: "route_not_found",
} as const;

/**
 * That task kind has no route in this workspace.
 *
 * @param taskKind - The name that was asked for, echoed so a client can say which of several
 *   resolutions failed without correlating by position.
 * @returns The `404`.
 */
export function routeNotFound(taskKind: string): NotFoundError {
  return new NotFoundError(
    ROUTING_ERRORS.routeNotFound,
    "This workspace has no route for that task kind.",
    { taskKind },
  );
}
