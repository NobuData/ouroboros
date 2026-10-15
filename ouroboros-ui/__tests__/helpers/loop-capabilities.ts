/**
 * DG.2's capability report as a test states it, and a stand-in for `useLoopCapabilities()`
 * (DG.3, #1301).
 *
 * A suite that renders a capability-driven surface mocks the hook with
 *
 *     vi.mock("@/app/shell/use-loop-capabilities", async () =>
 *       (await import("../helpers/loop-capabilities")).loopCapabilitiesModule());
 *
 * and sets {@link loopCapabilitiesState} per test — `live()`, `deploymentOff()`, … — so each
 * surface renders under both states without a poll or a network.
 */

import type { LoopCapabilities, LoopReason, LoopStage } from "@/app/api/loop";
import type { LoopCapabilitiesState } from "@/app/shell/use-loop-capabilities";

/** Every stage live. */
export function live(): LoopCapabilities {
  const stage = { available: true, reason: null, sinceVersion: "0.41.0" };

  return {
    deploymentEnabled: true,
    stages: {
      invocation: stage,
      execution: stage,
      guardrailEnforcement: stage,
      buildIntegration: stage,
      prPublishing: stage,
    },
    executors: ["native"],
  };
}

/**
 * A report with some stages off.
 *
 * @param off Each stage that is not live, with its reason.
 * @returns The report.
 */
export function withOff(off: Partial<Record<LoopStage, LoopReason>>): LoopCapabilities {
  const report = live();
  const stages = { ...report.stages };

  for (const [stage, reason] of Object.entries(off) as [LoopStage, LoopReason][]) {
    stages[stage] = { available: false, reason, sinceVersion: null };
  }

  return { ...report, deploymentEnabled: off.execution !== "deployment_disabled", stages };
}

/** The shipped default: the deployment's switch off, so nothing downstream of it is live. */
export function deploymentOff(): LoopCapabilities {
  return withOff({
    invocation: "no_invocable_connection",
    execution: "deployment_disabled",
    guardrailEnforcement: "execution_unavailable",
    buildIntegration: "no_runner",
    prPublishing: "execution_unavailable",
  });
}

/** What the mocked hook answers; a suite sets it per test. */
export const loopCapabilitiesState: { current: LoopCapabilitiesState } = {
  current: { capabilities: null, error: null },
};

/**
 * Set what the mocked hook answers.
 *
 * @param capabilities The report, or null for an unread one.
 */
export function answerCapabilities(capabilities: LoopCapabilities | null): void {
  loopCapabilitiesState.current = { capabilities, error: null };
}

/**
 * The mocked module.
 *
 * @returns `useLoopCapabilities` reading {@link loopCapabilitiesState}.
 */
export function loopCapabilitiesModule() {
  return { useLoopCapabilities: () => loopCapabilitiesState.current };
}
