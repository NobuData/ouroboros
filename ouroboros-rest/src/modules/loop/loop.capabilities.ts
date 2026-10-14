/**
 * The loop capability report — which stages of the loop are live here, and why not.
 *
 * DG.2 ([#1300](https://github.com/NobuData/ouroboros/issues/1300)), decision **L10** and the
 * honest-states rule (`docs/ROADMAP_OOE_MVP.md` § *Standing rules*). "Is the loop real here?"
 * needs one answer the product can read, so the UI's copy and the onboarding wizard stop
 * deciding it for themselves (DG.3, DK.1).
 *
 * **Availability is computed, never configured.** This module is a pure function from
 * {@link LoopFacts} — what the deployment, the engine and the workspace's own rows say today —
 * to {@link LoopCapabilitiesResource}. Each stage that is not available carries the **first**
 * reason that holds, in the order below, so a caller fixes the nearest thing first:
 *
 * ```
 * invocation             not_implemented → no_invocable_connection
 * execution              deployment_disabled → engine_unavailable → no_task_queue → no_executor
 * guardrailEnforcement   execution_unavailable
 * buildIntegration       no_runner → no_source_checkout
 * prPublishing           execution_unavailable → not_implemented → policy_not_dry_run
 * ```
 *
 * Guardrail enforcement is the tool policy every executor asks before a tool runs (DH.1), so
 * it is live exactly when execution is. Pull-request publishing additionally needs DI.2/DI.3's
 * code ({@link PR_PUBLISHING_IMPLEMENTED}) and a workspace whose dry-run policy is on — the
 * slice opens draft pull requests only (decision **L7**).
 *
 * The reason codes are a stable vocabulary ({@link LOOP_REASONS}): the UI keys copy on them,
 * and none names another workspace's row, so a reason never leaks one.
 */

import type { StageExecutorKind } from "../engine/engine.contract";

/** The stages the report covers, in the order the loop meets them. */
export const LOOP_STAGES = [
  "invocation",
  "execution",
  "guardrailEnforcement",
  "buildIntegration",
  "prPublishing",
] as const;

/** One stage. */
export type LoopStage = (typeof LOOP_STAGES)[number];

/** Every reason a stage can be unavailable. Stable: add, never rename. */
export const LOOP_REASONS = [
  // The code that would make the stage live has not shipped in this build.
  "not_implemented",
  // Invocation: the workspace has no enabled connection whose adapter may serve invocation.
  "no_invocable_connection",
  // Execution: `OURO_LIVE_EXECUTION_ENABLED` is off.
  "deployment_disabled",
  // Execution: the engine did not answer its status call.
  "engine_unavailable",
  // Execution: the engine answered, and runs no task queue (#54).
  "no_task_queue",
  // Execution: the engine answered, and has registered no stage executor (DH.1).
  "no_executor",
  // A stage that runs inside execution, while execution is unavailable.
  "execution_unavailable",
  // Build integration: no runner of this workspace's is online.
  "no_runner",
  // Build integration: runners are online, and none can check out source (#991).
  "no_source_checkout",
  // Pull-request publishing: the workspace's dry-run policy is off (decision L7).
  "policy_not_dry_run",
] as const;

/** One reason. */
export type LoopReason = (typeof LOOP_REASONS)[number];

/**
 * Whether pull-request publishing (DI.2, DI.3) has shipped in this build. `false` until the
 * commit that implements it sets it, the way `INVOCATION_GATEWAY_AVAILABLE` is set by AF.2.
 */
export const PR_PUBLISHING_IMPLEMENTED: boolean = false;

/**
 * The `ouroboros-rest` release that first shipped each stage, or `null` while none has. Set by
 * the commit that ships the stage, beside the flag it flips — so a client can say *live since
 * 0.43.0* without guessing.
 */
export const STAGE_SINCE_VERSION: Readonly<Record<LoopStage, string | null>> = {
  invocation: null,
  execution: null,
  guardrailEnforcement: null,
  buildIntegration: null,
  prPublishing: null,
};

/** What the report is computed from. Gathered by `LoopCapabilitiesService`. */
export interface LoopFacts {
  /** `OURO_LIVE_EXECUTION_ENABLED`. */
  readonly deploymentEnabled: boolean;
  /** Whether `POST /internal/llm/invoke` is implemented (`INVOCATION_GATEWAY_AVAILABLE`). */
  readonly invocationImplemented: boolean;
  /** Whether the workspace has an enabled connection cleared for invocation (DH.4). */
  readonly invocableConnection: boolean;
  /** What the engine's status call said. */
  readonly engine: {
    /** Whether it answered at all. */
    readonly reachable: boolean;
    /** Whether it runs a task queue. */
    readonly taskQueue: boolean;
    /** The executor kinds it registered. */
    readonly executors: readonly StageExecutorKind[];
  };
  /** The workspace's runners. */
  readonly runners: {
    /** Whether any is online and active. */
    readonly online: boolean;
    /** Whether any of those can check out source. */
    readonly sourceCheckout: boolean;
  };
  /** Whether pull-request publishing has shipped ({@link PR_PUBLISHING_IMPLEMENTED}). */
  readonly prPublishingImplemented: boolean;
  /** The workspace's effective dry-run policy. */
  readonly dryRun: boolean;
}

/** One stage's answer. */
export interface LoopStageCapability {
  /** Whether the stage is live for this workspace in this deployment. */
  readonly available: boolean;
  /** Why not, or `null` when it is. */
  readonly reason: LoopReason | null;
  /** The release that first shipped it, or `null` while none has. */
  readonly sinceVersion: string | null;
}

/** `GET /api/v1/loop/capabilities`. */
export interface LoopCapabilitiesResource {
  /** `OURO_LIVE_EXECUTION_ENABLED`. */
  readonly deploymentEnabled: boolean;
  /** One answer per stage. */
  readonly stages: Readonly<Record<LoopStage, LoopStageCapability>>;
  /** The stage-executor kinds the engine has registered; empty when it reports none. */
  readonly executors: readonly StageExecutorKind[];
}

/**
 * The first reason that holds, or `null` when none does.
 *
 * @param checks - `[holds, reason]` pairs, in precedence order.
 * @returns The reason of the first pair that holds.
 */
function firstReason(checks: readonly (readonly [boolean, LoopReason])[]): LoopReason | null {
  return checks.find(([holds]) => holds)?.[1] ?? null;
}

/**
 * Compute the report.
 *
 * @param facts - What the deployment, the engine and the workspace say.
 * @returns The report.
 */
export function loopCapabilities(facts: LoopFacts): LoopCapabilitiesResource {
  const execution = firstReason([
    [!facts.deploymentEnabled, "deployment_disabled"],
    [!facts.engine.reachable, "engine_unavailable"],
    [!facts.engine.taskQueue, "no_task_queue"],
    [facts.engine.executors.length === 0, "no_executor"],
  ]);
  const executionDown = execution !== null;

  const reasons: Record<LoopStage, LoopReason | null> = {
    invocation: firstReason([
      [!facts.invocationImplemented, "not_implemented"],
      [!facts.invocableConnection, "no_invocable_connection"],
    ]),
    execution,
    guardrailEnforcement: firstReason([[executionDown, "execution_unavailable"]]),
    buildIntegration: firstReason([
      [!facts.runners.online, "no_runner"],
      [!facts.runners.sourceCheckout, "no_source_checkout"],
    ]),
    prPublishing: firstReason([
      [executionDown, "execution_unavailable"],
      [!facts.prPublishingImplemented, "not_implemented"],
      [!facts.dryRun, "policy_not_dry_run"],
    ]),
  };

  const stages = Object.fromEntries(
    LOOP_STAGES.map((stage) => [
      stage,
      {
        available: reasons[stage] === null,
        reason: reasons[stage],
        sinceVersion: STAGE_SINCE_VERSION[stage],
      },
    ]),
  ) as Record<LoopStage, LoopStageCapability>;

  return {
    deploymentEnabled: facts.deploymentEnabled,
    stages,
    executors: facts.engine.reachable ? [...facts.engine.executors] : [],
  };
}
