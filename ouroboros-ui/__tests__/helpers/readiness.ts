import type { LoopReadiness, LoopReadinessCheck } from "@/app/api/loop";
import type { ReadinessGate } from "@/app/get-started/view";

/** The repository every readiness fixture is about. */
export const READINESS_REPO = "acme-robotics/helios-firmware";

/** The twelve checks, every one passing, in REST's order. */
const PASSING: readonly LoopReadinessCheck[] = [
  pass("deployment", "Live execution is enabled for this deployment."),
  pass("workspace", "The workspace is active."),
  pass("provider_connection", "A provider connection can run a loop: Anthropic (anthropic)."),
  pass("routes", "Routes resolve: plan, implement."),
  pass("stage_executors", "A stage executor is registered for model stages: harness."),
  pass("runner", "A runner is online in pool-a."),
  pass("repository", "acme-robotics/helios-firmware is enabled for the loop."),
  pass("push_credential", "The token can push a branch in acme-robotics/helios-firmware."),
  pass("pull_request_credential", "The token can open a pull request in acme-robotics/helios-firmware."),
  pass("dry_run", "Dry-run policy is on: pull requests open as drafts and nothing merges."),
  pass("workflow_published", "quick-fixes@v1 is published."),
  pass("concurrency", "A live-run slot is free (0 of 1 in use)."),
];

/**
 * A passing check.
 *
 * @param id The check.
 * @param reason What passed.
 * @returns The check.
 */
function pass(id: LoopReadinessCheck["id"], reason: string): LoopReadinessCheck {
  return { id, state: "pass", code: null, reason, fix: null };
}

/**
 * The preflight, every check passing unless replaced.
 *
 * @param replaced Checks to put in place of the passing ones, by id.
 * @returns The preflight, `ready` derived from the checks.
 */
export function readiness(...replaced: readonly LoopReadinessCheck[]): LoopReadiness {
  const checks = PASSING.map((check) => replaced.find((one) => one.id === check.id) ?? check);

  return {
    repository: READINESS_REPO,
    workflow: { slug: "quick-fixes", version: 1 },
    ready: checks.every((check) => check.state === "pass"),
    checks,
    estimate: {
      isEstimate: true,
      costCapCentsPerRun: 200,
      issue: { number: 488, title: "Typo sweep in operator manual + pairing guide", size: "s", sizedBy: "heuristic-v0" },
    },
  };
}

/** No runner online — the diagram's failing row. */
export const NO_RUNNER: LoopReadinessCheck = {
  id: "runner",
  state: "fail",
  code: "no_runner",
  reason: "No runner is online in pool-a.",
  fix: { label: "Build Farm · enrol a runner", href: "/build-farm" },
};

/** Push permission GitHub would not confirm — an `unknown` row. */
export const PUSH_UNCONFIRMED: LoopReadinessCheck = {
  id: "push_credential",
  state: "unknown",
  code: "permission_unconfirmed",
  reason: "Whether the token can push a branch could not be confirmed: GitHub's answer carries no permission for the token.",
  fix: { label: "Sources · check the token", href: "/settings/sources" },
};

/** Live execution off for the deployment. */
export const DEPLOYMENT_OFF: LoopReadinessCheck = {
  id: "deployment",
  state: "fail",
  code: "deployment_disabled",
  reason: "Live execution is turned off for this deployment.",
  fix: { label: "Live execution · enable it", href: "https://docs.ouroboros.build/administration/live-execution" },
};

/**
 * A gate over a preflight.
 *
 * @param value The preflight.
 * @returns The gate the wizard reads.
 */
export function heard(value: LoopReadiness): ReadinessGate {
  return { state: "read", value };
}

/** Every check passing, as a gate. */
export const READY_GATE: ReadinessGate = heard(readiness());
