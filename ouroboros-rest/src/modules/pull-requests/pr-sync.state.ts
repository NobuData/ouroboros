/**
 * How a host's report moves a mirrored PR's `state` — the one rule the PR sync applies to what a
 * provider answered.
 *
 * AX.1 ([#357](https://github.com/NobuData/ouroboros/issues/357)). V052 shares
 * `pull_requests.state` by rule: the host reports `open`, `closed` and `merged`; the verification
 * plane refines an open PR into `verifying`, `blocked` and `armed`. So a sync must write the host's
 * facts **without undoing the plane's refinements**:
 *
 * ```
 * host merged  → merged          from any state — the host owns that fact; merged is terminal
 * host closed  → closed          unless merged
 * host open    → open            from closed — reopened on the host
 *              → unchanged       otherwise — verifying, blocked and armed are the plane's words for open
 * ```
 *
 * One report can need two edges. V052 has no `closed → merged`, because a closed PR cannot be
 * merged — it is reopened first. A sync that last saw it closed and now sees it merged missed the
 * reopen, so {@link mirroredPath} walks `closed → open → merged`, the history the host went through.
 *
 * Every step these answer is an edge of `pull_requests_state_transition`'s graph, which
 * `pr-sync.state.spec.ts` checks against the graph written out.
 */

import type { PullRequestState } from "../db/schema";
import type { HostPrState } from "../ticket-sources/ticket-source.pr";

/**
 * The state a mirrored PR should hold after a sync.
 *
 * @param current - The row's state, or null for a PR not mirrored yet.
 * @param host - What the host reports.
 * @returns The state to write — `current` itself when nothing should change.
 */
export function mirroredState(
  current: PullRequestState | null,
  host: HostPrState,
): PullRequestState {
  if (current === null || host === "merged" || current === "merged") {
    return current === "merged" ? "merged" : host;
  }

  if (host === "closed") {
    return "closed";
  }

  return current === "closed" ? "open" : current;
}

/**
 * The states a mirrored PR passes through to reach {@link mirroredState} — each one an edge V052
 * accepts on its own.
 *
 * @param current - The row's state.
 * @param host - What the host reports.
 * @returns The states to write in order; empty when nothing changes.
 */
export function mirroredPath(current: PullRequestState, host: HostPrState): PullRequestState[] {
  const next = mirroredState(current, host);

  if (next === current) {
    return [];
  }

  return current === "closed" && next === "merged" ? ["open", "merged"] : [next];
}
