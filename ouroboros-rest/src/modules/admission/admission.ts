/**
 * Live-run admission — the one decision a queued item passes before the engine may claim it
 * (DI.4, [#1312](https://github.com/NobuData/ouroboros/issues/1312); decisions L5, L7, L10).
 *
 * **Pure.** Facts in, the first reason that holds out — in the style of the loop capability
 * report (`loop/loop.capabilities.ts`). The claim (`ingest/queue-claim.service.ts`) and every
 * read model that shows a queued item (`GET /api/v1/queue`, the dashboard, the backlog) ask this
 * same function, so the reason a person reads is the reason the claim acted on.
 *
 * Two scopes, because they fail differently:
 *
 * ```
 * workspace   deployment_disabled → workspace_paused | workspace_pending_delete → no_executor
 *             → concurrency_ceiling
 *             the claim is refused (409) — nothing in the queue can start
 * item        repository_disabled → policy_not_dry_run → workflow_unpublished
 *             → route_not_invocable → needs_confirmation
 *             the claim skips the item and takes the next one that passes
 * ```
 *
 * A read model shows the hard workspace reasons first, then the item's own reason, and the
 * ceiling last: a full ceiling clears by itself, and an item that also needs a person's
 * confirmation should say so while it waits.
 *
 * The codes are a stable vocabulary ({@link ADMISSION_REASONS}): the UI keys copy on them.
 */

import type { WorkspaceLifecycleState } from "../db/schema";
import { admitsNewWork } from "../lifecycle/lifecycle.states";

/** Reasons that hold the whole workspace's queue. Stable: add, never rename. */
export const WORKSPACE_ADMISSION_REASONS = [
  // `OURO_LIVE_EXECUTION_ENABLED` is off (DG.2, decision L10).
  "deployment_disabled",
  // The workspace is paused (#489).
  "workspace_paused",
  // The workspace is pending deletion (#489).
  "workspace_pending_delete",
  // The engine has registered no stage executor (DH.1).
  "no_executor",
  // The workspace already runs as many live runs as its ceiling allows.
  "concurrency_ceiling",
] as const;

/** Reasons one item waits for. Stable: add, never rename. */
export const ITEM_ADMISSION_REASONS = [
  // The item's repository is not enabled for the loop.
  "repository_disabled",
  // The item's repository is not in dry-run — the slice opens draft pull requests only (L7).
  "policy_not_dry_run",
  // The item pins no published workflow version, or one that no longer reads.
  "workflow_unpublished",
  // A route the workflow's model stages use resolves to no connection cleared for invocation
  // (DH.4), or the workspace has no such connection at all.
  "route_not_invocable",
  // Nobody holding `can_approve_loops` has confirmed the item for a live run (L5).
  "needs_confirmation",
] as const;

/** Every admission reason, workspace first. */
export const ADMISSION_REASONS = [
  ...WORKSPACE_ADMISSION_REASONS,
  ...ITEM_ADMISSION_REASONS,
] as const;

/** A workspace-wide reason. */
export type WorkspaceAdmissionReason = (typeof WORKSPACE_ADMISSION_REASONS)[number];

/** An item's own reason. */
export type ItemAdmissionReason = (typeof ITEM_ADMISSION_REASONS)[number];

/** Any reason. */
export type AdmissionReason = WorkspaceAdmissionReason | ItemAdmissionReason;

/** What the workspace-wide decision is made from. */
export interface WorkspaceAdmissionFacts {
  /** `OURO_LIVE_EXECUTION_ENABLED`. */
  readonly deploymentEnabled: boolean;
  /** The workspace's lifecycle state (#489). */
  readonly state: WorkspaceLifecycleState;
  /** How many stage executors the engine has registered. */
  readonly executors: number;
  /** Live runs executing now plus items leased to a worker and not yet opened. */
  readonly liveSlotsTaken: number;
  /** The workspace's ceiling, already clamped to the deployment maximum. */
  readonly ceiling: number;
}

/** What one item's decision is made from. */
export interface ItemAdmissionFacts {
  /** `github_repos.enabled`. */
  readonly repositoryEnabled: boolean;
  /** Whether the item's repository is in dry-run now (`policies/repository-dry-run.ts`). */
  readonly dryRun: boolean;
  /** Whether the pinned workflow version exists and reads. */
  readonly workflowPublished: boolean;
  /** Whether every route the pinned workflow uses resolves to a cleared connection. */
  readonly routeInvocable: boolean;
  /** `queue_items.confirmed_at is not null`. */
  readonly confirmed: boolean;
}

/** Why a queued item is not starting, as the read models publish it. */
export interface QueueWaiting {
  /** The reason code. */
  readonly reason: AdmissionReason;
  /** Whether it holds the whole workspace or only this item. */
  readonly scope: "workspace" | "item";
}

/**
 * The first reason that holds, or `null` when none does.
 *
 * @param checks - `[holds, reason]` pairs, in precedence order.
 * @returns The reason of the first pair that holds.
 */
function firstReason<R extends AdmissionReason>(
  checks: readonly (readonly [boolean, R])[],
): R | null {
  return checks.find(([holds]) => holds)?.[1] ?? null;
}

/**
 * The reason a lifecycle state holds new work, or `null` when it admits.
 *
 * @param state - The workspace's state.
 * @returns `workspace_paused`, `workspace_pending_delete` or `null`.
 */
function lifecycleReason(state: WorkspaceLifecycleState): WorkspaceAdmissionReason | null {
  if (admitsNewWork(state)) {
    return null;
  }

  return state === "paused" ? "workspace_paused" : "workspace_pending_delete";
}

/**
 * The workspace reasons that do not clear by themselves, in precedence order.
 *
 * @param facts - The workspace's facts.
 * @returns The first that holds, or `null`.
 */
function hardWorkspaceReason(facts: WorkspaceAdmissionFacts): WorkspaceAdmissionReason | null {
  if (!facts.deploymentEnabled) {
    return "deployment_disabled";
  }

  return lifecycleReason(facts.state) ?? (facts.executors === 0 ? "no_executor" : null);
}

/**
 * Whether a claim may proceed at all in this workspace.
 *
 * @param facts - The workspace's facts.
 * @returns The first workspace reason that holds, or `null` when an item may be claimed.
 */
export function workspaceAdmission(
  facts: WorkspaceAdmissionFacts,
): WorkspaceAdmissionReason | null {
  return (
    hardWorkspaceReason(facts) ??
    (facts.liveSlotsTaken >= facts.ceiling ? "concurrency_ceiling" : null)
  );
}

/**
 * Whether one item may become a live run, workspace aside.
 *
 * @param facts - The item's facts.
 * @returns The first item reason that holds, or `null` when it may.
 */
export function itemAdmission(facts: ItemAdmissionFacts): ItemAdmissionReason | null {
  return firstReason<ItemAdmissionReason>([
    [!facts.repositoryEnabled, "repository_disabled"],
    [!facts.dryRun, "policy_not_dry_run"],
    [!facts.workflowPublished, "workflow_unpublished"],
    [!facts.routeInvocable, "route_not_invocable"],
    [!facts.confirmed, "needs_confirmation"],
  ]);
}

/**
 * Why an item is waiting, as a read model shows it — the hard workspace reasons, then the
 * item's own, then the ceiling.
 *
 * @param workspace - The workspace's facts.
 * @param item - The item's facts.
 * @returns The reason and its scope, or `null` when the item would be admitted now.
 */
export function queueWaiting(
  workspace: WorkspaceAdmissionFacts,
  item: ItemAdmissionFacts,
): QueueWaiting | null {
  const hard = hardWorkspaceReason(workspace);
  if (hard !== null) {
    return { reason: hard, scope: "workspace" };
  }

  const own = itemAdmission(item);
  if (own !== null) {
    return { reason: own, scope: "item" };
  }

  return workspace.liveSlotsTaken >= workspace.ceiling
    ? { reason: "concurrency_ceiling", scope: "workspace" }
    : null;
}

/**
 * The ceiling a claim enforces — the workspace's own, never above the deployment's maximum.
 *
 * @param workspaceCeiling - `workspace_settings_effective.live_run_ceiling`.
 * @param deploymentMax - `OURO_LIVE_RUN_CEILING_MAX`.
 * @returns The lower of the two.
 */
export function effectiveCeiling(workspaceCeiling: number, deploymentMax: number): number {
  return Math.min(workspaceCeiling, deploymentMax);
}
