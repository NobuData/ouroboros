/**
 * Action resolution — which of a card's buttons the person looking at it may press.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)). A kind declares each action's
 * `required_role` on V091's ladder, with `approver` meaning the `can_approve_loops` capability
 * ([#485](https://github.com/NobuData/ouroboros/issues/485)) rather than a role:
 *
 * ```
 * viewer < member < admin < owner        (a member's highest role)
 * approver                               (can_approve_loops — owner/admin by default, overridable)
 * ```
 *
 * The card shows every action; one the viewer cannot press is marked so the UI can disable it with
 * its reason, instead of hiding a decision that exists. BN.2's executor re-checks at the route —
 * this answers *what to show*, never *what to allow*.
 *
 * Pure.
 */

import type { OrganizationRole } from "../db/schema";
import type { DecisionAction, DecisionRequiredRole } from "./decision.types";

/** Rank on the role ladder; higher holds everything lower holds. */
const RANK: Readonly<Record<OrganizationRole, number>> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

/** Who is looking at the card. */
export interface DecisionViewer {
  /** The member's roles (a member may hold several). */
  readonly roles: readonly OrganizationRole[];
  /** The member's effective `can_approve_loops`. */
  readonly canApproveLoops: boolean;
}

/** One action, with whether this viewer may press it. */
export interface ResolvedDecisionAction extends DecisionAction {
  /** Whether the viewer's role (or capability) is enough. */
  readonly allowed: boolean;
  /** A link that decides nothing — `navigate.*`. */
  readonly navigates: boolean;
}

/**
 * Whether a viewer holds what an action requires.
 *
 * @param required - The action's `required_role`.
 * @param viewer - Who is asking.
 * @returns `true` when the viewer may press it.
 */
export function holdsRole(required: DecisionRequiredRole, viewer: DecisionViewer): boolean {
  if (required === "approver") {
    return viewer.canApproveLoops;
  }

  const highest = Math.max(-1, ...viewer.roles.map((role) => RANK[role]));

  return highest >= RANK[required];
}

/**
 * A card's action row, resolved against the viewer, in declared order.
 *
 * @param actions - The pinned version's actions.
 * @param viewer - Who is looking.
 * @returns Every action, each marked `allowed` and `navigates`.
 */
export function resolveActions(
  actions: readonly DecisionAction[],
  viewer: DecisionViewer,
): ResolvedDecisionAction[] {
  return actions.map((action) => ({
    ...action,
    allowed: holdsRole(action.required_role, viewer),
    navigates: action.handler_binding.startsWith("navigate."),
  }));
}
