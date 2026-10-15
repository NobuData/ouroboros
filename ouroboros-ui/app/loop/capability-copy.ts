/**
 * What the product says when a stage of the loop cannot run for real — DG.3
 * ([#1301](https://github.com/NobuData/ouroboros/issues/1301)).
 *
 * ```
 * GET /api/v1/loop/capabilities ─▶ stage { available, reason } ─▶ stageNotice() ─▶ sentence · fix link
 * ```
 *
 * Every surface that would otherwise assert "simulated" or "arrives later" reads DG.2's report
 * instead and, for a stage that is not live, says **why** in DG.2's own terms and **where it is
 * fixed** — Providers, Build Farm, Policies or the deployment guide. A stage that is live says
 * nothing: the claim is simply absent. Pure, so every reason is tested without a page.
 */

import type { LoopCapabilities, LoopReason, LoopStage } from "@/app/api/loop";
import { DOCS_URL } from "@/app/external";
import { BUILD_FARM_PATH, POLICIES_PATH, PROVIDERS_PATH } from "@/app/paths";

/** Where a reason is fixed. */
export interface CapabilityFix {
  /** The link's words. */
  readonly label: string;
  /** In the application, or on the documentation site. */
  readonly href: string;
  /** True for a documentation page, which opens in a new tab. */
  readonly external: boolean;
}

/** What a surface says about one stage that is not live. */
export interface StageNotice {
  /** The stage the report answered for. */
  readonly stage: LoopStage;
  /** The reason that decided it — after following `execution_unavailable` to execution's own. */
  readonly reason: LoopReason;
  /** One sentence: what is off and what that means here. */
  readonly sentence: string;
  /** Where to fix it. */
  readonly fix: CapabilityFix;
}

/** The deployment guide's row for the switch — EnvVar anchors are the lower-cased name. */
export const LIVE_EXECUTION_DOCS = `${DOCS_URL}administration/deploy/containers#ouro_live_execution_enabled`;

/** The operations page — the engine's health and how to read it. */
export const OPERATIONS_DOCS = `${DOCS_URL}administration/operations`;

/** The concepts page's section on dry-run and live — what is built and what is not. */
export const DRY_RUN_AND_LIVE_DOCS = `${DOCS_URL}user-guide/concepts#dry-run-and-live`;

/** How to enable live execution — the deployment's own switch. */
export const HOW_TO_ENABLE: CapabilityFix = {
  label: "How to enable",
  href: LIVE_EXECUTION_DOCS,
  external: true,
};

/** The engine's health, on the operations page. */
export const ENGINE_HEALTH: CapabilityFix = {
  label: "Check the engine",
  href: OPERATIONS_DOCS,
  external: true,
};

/** Providers — where a connection is added. */
export const PROVIDERS: CapabilityFix = { label: "Providers →", href: PROVIDERS_PATH, external: false };

/** Build Farm — where runners are seen and enrolled. */
const BUILD_FARM: CapabilityFix = { label: "Build Farm →", href: BUILD_FARM_PATH, external: false };

/** Policies — where the dry-run policy is set. */
export const POLICIES: CapabilityFix = { label: "Policies →", href: POLICIES_PATH, external: false };

/** What this version has built, for a stage it has not. */
const WHAT_IS_BUILT: CapabilityFix = {
  label: "What is built",
  href: DRY_RUN_AND_LIVE_DOCS,
  external: true,
};

/**
 * Every reason's sentence and fix. `execution_unavailable` is never shown as itself — a stage
 * that waits on execution says execution's reason, so the fix is the one that helps.
 */
export const REASON_COPY: Readonly<
  Record<Exclude<LoopReason, "execution_unavailable">, { sentence: string; fix: CapabilityFix }>
> = {
  deployment_disabled: {
    sentence: "Live execution is off for this deployment — ask an administrator.",
    fix: HOW_TO_ENABLE,
  },
  engine_unavailable: {
    sentence: "The engine is not answering — live runs cannot start.",
    fix: ENGINE_HEALTH,
  },
  no_task_queue: {
    sentence: "The engine runs no task queue — live runs cannot start.",
    fix: ENGINE_HEALTH,
  },
  no_executor: {
    sentence: "The engine has no stage executor registered — live runs cannot start.",
    fix: ENGINE_HEALTH,
  },
  no_invocable_connection: {
    sentence: "No provider connection can be invoked — models cannot be called.",
    fix: PROVIDERS,
  },
  not_implemented: {
    sentence: "This version does not build this stage yet.",
    fix: WHAT_IS_BUILT,
  },
  no_runner: {
    sentence: "No runner is online — builds will wait.",
    fix: BUILD_FARM,
  },
  no_source_checkout: {
    sentence: "No online runner can check out source — builds will wait.",
    fix: BUILD_FARM,
  },
  policy_not_dry_run: {
    sentence: "The workspace's dry-run policy is off — pull requests are not published.",
    fix: POLICIES,
  },
};

/**
 * What a surface says about one stage, or nothing when it is live.
 *
 * @param capabilities The report, or null while it has not been read.
 * @param stage The stage the surface depends on.
 * @returns Null for a live stage **and** for an unread report — a surface asserts nothing it
 *   has not been told — else the sentence and the fix.
 */
export function stageNotice(
  capabilities: LoopCapabilities | null,
  stage: LoopStage,
): StageNotice | null {
  if (capabilities === null) return null;

  const answer = capabilities.stages[stage];

  if (answer.available) return null;

  // A stage that waits on execution names execution's reason; a report that names none is
  // read as the deployment's switch, the one reason every other depends on.
  const reason =
    answer.reason === "execution_unavailable" || answer.reason === null
      ? (capabilities.stages.execution.reason ?? "deployment_disabled")
      : answer.reason;
  const copy = REASON_COPY[reason === "execution_unavailable" ? "deployment_disabled" : reason];

  return { stage, reason, sentence: copy.sentence, fix: copy.fix };
}

/**
 * The run console's one deployment-level notice — the issue's diagram:
 *
 * ```
 * execution unavailable                 → execution's reason         (How to enable, …)
 * execution live, builds not integrated → "No runner is online — …"  (Build Farm →)
 * all live                              → nothing
 * ```
 *
 * @param capabilities The report, or null.
 * @returns The notice, or null.
 */
export function runConsoleNotice(capabilities: LoopCapabilities | null): StageNotice | null {
  return stageNotice(capabilities, "execution") ?? stageNotice(capabilities, "buildIntegration");
}

/**
 * Whether a stage is known to be live — false while the report is unread, so a surface that
 * would drop a caveat keeps it until it is told otherwise.
 *
 * @param capabilities The report, or null.
 * @param stage The stage.
 * @returns True only for a stage the report says is available.
 */
export function stageLive(capabilities: LoopCapabilities | null, stage: LoopStage): boolean {
  return capabilities?.stages[stage].available === true;
}
