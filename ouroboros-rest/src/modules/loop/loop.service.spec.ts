import type { AppConfigService } from "../config/config.service";
import type { EngineClient } from "../engine/engine.client";
import { engineUnavailable } from "../engine/engine.errors";
import type { OrgPolicyService } from "../policies/org-policy.service";
import type { LoopRepository, RunnerPresence } from "./loop.repository";
import { LoopCapabilitiesService } from "./loop.service";

const WORKSPACE = "org-a";

interface Rig {
  readonly service: LoopCapabilitiesService;
  readonly repository: jest.Mocked<
    Pick<LoopRepository, "invocableConnectionExists" | "runnerPresence">
  >;
  readonly engine: jest.Mocked<Pick<EngineClient, "status">>;
  readonly policies: jest.Mocked<Pick<OrgPolicyService, "dryRun">>;
}

/**
 * A service over stubbed sources.
 *
 * @param options - What each source answers.
 * @returns The service and its stubs.
 */
function rig(
  options: {
    liveExecutionEnabled?: boolean;
    invocable?: boolean;
    runners?: RunnerPresence;
    status?: () => Promise<unknown>;
    dryRun?: boolean;
  } = {},
): Rig {
  const repository = {
    invocableConnectionExists: jest.fn().mockResolvedValue(options.invocable ?? false),
    runnerPresence: jest
      .fn()
      .mockResolvedValue(options.runners ?? { online: false, sourceCheckout: false }),
  };
  const engine = {
    status: jest
      .fn()
      .mockImplementation(
        options.status ??
          (() =>
            Promise.resolve({ service: "ouroboros-engine", version: "0.7.30", uptimeSeconds: 1 })),
      ),
  };
  const policies = { dryRun: jest.fn().mockResolvedValue(options.dryRun ?? false) };
  const config = {
    liveExecutionEnabled: options.liveExecutionEnabled ?? false,
  } as AppConfigService;
  const service = new LoopCapabilitiesService(
    config,
    engine as unknown as EngineClient,
    policies as unknown as OrgPolicyService,
    repository as unknown as LoopRepository,
  );

  return { service, repository, engine, policies };
}

describe("LoopCapabilitiesService (DG.2, #1300)", () => {
  it("reports a workspace with nothing connected: every stage unavailable", async () => {
    const { service } = rig();

    const report = await service.read(WORKSPACE);

    expect(report.deploymentEnabled).toBe(false);
    // The gateway answers since AF.2 (#235); what stops invocation now is the workspace.
    expect(Object.values(report.stages).map((stage) => stage.reason)).toEqual([
      "no_invocable_connection",
      "deployment_disabled",
      "execution_unavailable",
      "no_runner",
      "execution_unavailable",
    ]);
    expect(report.executors).toEqual([]);
  });

  it("asks every source about the session's workspace and no other", async () => {
    const { service, repository, policies } = rig();

    await service.read(WORKSPACE);

    expect(repository.invocableConnectionExists).toHaveBeenCalledWith(WORKSPACE, [
      "anthropic",
      "openai_compatible",
      "ollama",
    ]);
    expect(repository.runnerPresence).toHaveBeenCalledWith(WORKSPACE);
    expect(policies.dryRun).toHaveBeenCalledWith(WORKSPACE);
  });

  it("only asks about connection kinds DH.4 has cleared", async () => {
    const { service, repository } = rig();

    await service.read(WORKSPACE);

    const [, kinds] = repository.invocableConnectionExists.mock.calls[0];

    expect(kinds).not.toContain("copilot");
    expect(kinds).not.toContain("cursor");
    expect(kinds).not.toContain("custom");
  });

  it("reads the switch from the deployment", async () => {
    const { service } = rig({ liveExecutionEnabled: true });

    const report = await service.read(WORKSPACE);

    expect(report.deploymentEnabled).toBe(true);
    // Today's engine reports no queue, so execution is still off — for the next reason.
    expect(report.stages.execution.reason).toBe("no_task_queue");
  });

  it("turns an engine failure into engine_unavailable, never into an error of its own", async () => {
    const { service } = rig({
      liveExecutionEnabled: true,
      status: () => Promise.reject(engineUnavailable()),
    });

    const report = await service.read(WORKSPACE);

    expect(report.stages.execution.reason).toBe("engine_unavailable");
    expect(report.executors).toEqual([]);
  });

  it("makes execution available when the engine reports a queue and an executor", async () => {
    const { service } = rig({
      liveExecutionEnabled: true,
      status: () =>
        Promise.resolve({
          service: "ouroboros-engine",
          version: "0.8.0",
          uptimeSeconds: 1,
          taskQueue: true,
          executors: ["harness"],
        }),
    });

    const report = await service.read(WORKSPACE);

    expect(report.stages.execution).toEqual({ available: true, reason: null, sinceVersion: null });
    expect(report.stages.guardrailEnforcement.available).toBe(true);
    expect(report.executors).toEqual(["harness"]);
    // PR publishing has not shipped.
    expect(report.stages.prPublishing.reason).toBe("not_implemented");
  });

  it("passes the workspace's connections and runners through", async () => {
    const { service } = rig({
      invocable: true,
      runners: { online: true, sourceCheckout: false },
    });

    const report = await service.read(WORKSPACE);

    // The gateway answers (AF.2, #235) and a connection is invocable, so nothing stops it.
    expect(report.stages.invocation.reason).toBeNull();
    expect(report.stages.buildIntegration.reason).toBe("no_source_checkout");
  });
});
