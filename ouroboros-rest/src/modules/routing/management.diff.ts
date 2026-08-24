/**
 * What one press of **Save routes** changed — the function `route_revisions.diff` is written
 * from, and the function that decides which statements a save issues at all.
 *
 * Z.2 ([#195](https://github.com/NobuData/ouroboros/issues/195)). Pure: two values in, a
 * document out, no clock and no connection. That is not a testing convenience — it is what
 * makes the ticket's acceptance criterion *"every save writes a `route_revisions` row whose
 * diff reflects exactly what changed"* checkable as a table of inputs rather than as a
 * scenario to stage.
 *
 * ---------------------------------------------------------------------------
 * **The diff drives the write, rather than describing it afterwards.**
 *
 * The obvious arrangement is to apply the body and then record what was applied, and it has a
 * failure mode that is invisible until an audit: the record is a second computation over the
 * same inputs, so a route can be written one way and reported another. Here the comparison
 * happens once — a route with no entry in the diff is a route no statement runs against, and
 * a route with an entry is written *and* recorded from the same object. The two cannot
 * disagree because there is only one of them.
 *
 * It also settles what a no-op save does. A body that asks for the state a route is already in
 * produces no entry, so nothing is written and no revision row exists to say a button was
 * pressed. V021 makes that structural rather than a habit: `changes` must be non-empty and
 * `routes` must be non-empty, so an empty revision cannot be stored even by a caller that
 * tried.
 *
 * ---------------------------------------------------------------------------
 * **The keys are column names, and the hops are alias *names*.**
 *
 * V021's header argues both at length; the short version is that a revision is read by a
 * person reconstructing a decision months later. `floor_hop_index` is what they will find in
 * the schema, and `coder-max` is what they were told in the conversation — a uuid is a lookup
 * into a row that may since have been repointed, which is exactly the interval they are asking
 * about.
 */

import type { RouteRevisionChange, RouteRevisionDiff, RouteRevisionEntry } from "../db/schema";
import type { DesiredRoute, HopState, RouteState } from "./management.rows";

/**
 * The column a chain change is recorded under.
 *
 * `route_hops` is a table rather than a column, and the diff still calls the change `hops`:
 * what moved is *the chain*, and recording it as eight per-row changes would make a reorder
 * unreadable. Named here so this file and its spec cannot disagree about the spelling.
 */
export const HOPS_KEY = "hops";

/** The three policy columns a save may move, spelled as V016 spells them. */
export const POLICY_KEYS = {
  allowLocalFallback: "allow_local_fallback",
  floorHopIndex: "floor_hop_index",
  maxCostCentsPerRun: "max_cost_cents_per_run",
} as const;

/**
 * Whether two chains are the same chain.
 *
 * Order-sensitive, which is the whole point: a reorder changes nothing about *which* aliases
 * a route names and is exactly the edit the matrix's drag handle exists for. Notes are
 * compared too — an operator rewriting *"Fallback on 5xx"* has changed the chain a reader
 * sees, and a diff that ignored it would report a save that did something as a save that did
 * nothing.
 *
 * @param before - The chain as stored.
 * @param after - The chain as the body asks for it.
 * @returns Whether they are identical, hop for hop.
 */
export function sameChain(before: readonly HopState[], after: readonly HopState[]): boolean {
  return (
    before.length === after.length &&
    before.every((hop, index) => hop.alias === after[index].alias && hop.note === after[index].note)
  );
}

/**
 * What one route's save moved.
 *
 * @param before - The route as it stands.
 * @param after - The route as the body asks for it.
 * @returns One entry per column that changed, keyed by the column's own name. **Empty when
 *   nothing moved**, which is the caller's signal to issue no statement for this route at
 *   all — see this file's header.
 */
export function routeChanges(
  before: RouteState,
  after: DesiredRoute,
): Record<string, RouteRevisionChange> {
  const changes: Record<string, RouteRevisionChange> = {};

  if (!sameChain(before.hops, after.hops)) {
    changes[HOPS_KEY] = { from: [...before.hops], to: [...after.hops] };
  }

  if (before.allowLocalFallback !== after.allowLocalFallback) {
    changes[POLICY_KEYS.allowLocalFallback] = {
      from: before.allowLocalFallback,
      to: after.allowLocalFallback,
    };
  }

  if (before.floorHopIndex !== after.floorHopIndex) {
    changes[POLICY_KEYS.floorHopIndex] = { from: before.floorHopIndex, to: after.floorHopIndex };
  }

  if (before.maxCostCentsPerRun !== after.maxCostCentsPerRun) {
    changes[POLICY_KEYS.maxCostCentsPerRun] = {
      from: before.maxCostCentsPerRun,
      to: after.maxCostCentsPerRun,
    };
  }

  return changes;
}

/**
 * One route's entry in a revision, or nothing when the route did not move.
 *
 * @param before - The route as it stands.
 * @param after - The route as the body asks for it.
 * @returns The entry, or `null` for a route this save leaves exactly as it found it.
 */
export function routeEntry(before: RouteState, after: DesiredRoute): RouteRevisionEntry | null {
  const changes = routeChanges(before, after);

  return Object.keys(changes).length === 0 ? null : { task_kind: after.taskKind, changes };
}

/**
 * The whole batch's revision, or nothing to record.
 *
 * @param entries - The entries of the routes that moved, in the order the body listed them —
 *   which is the order a reader will compare against the request they made.
 * @returns The document to store, or `null` when no route in the batch changed. `null` is not
 *   a failure: it is a client pressing **Save routes** on a matrix it had not edited, and the
 *   honest record of that is no record.
 */
export function revisionDiff(entries: readonly RouteRevisionEntry[]): RouteRevisionDiff | null {
  return entries.length === 0 ? null : { routes: [...entries] };
}
