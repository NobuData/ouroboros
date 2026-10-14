/**
 * Gathers the facts the loop capability report is computed from (DG.2,
 * [#1300](https://github.com/NobuData/ouroboros/issues/1300)) and hands them to
 * `loop.capabilities.ts`, which decides.
 *
 * Four sources, read at once:
 *
 * - the deployment switch, `OURO_LIVE_EXECUTION_ENABLED`;
 * - the engine's `GET /v0/status`. A failure of any kind is *unreachable*, never an error of
 *   this route: the report exists to say the engine is down, not to be down with it;
 * - the workspace's connections and runners (`LoopRepository`);
 * - the workspace's dry-run policy (`OrgPolicyService`).
 */

import { Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { PROVIDER_CONNECTION_KINDS } from "../db/schema";
import { EngineClient } from "../engine/engine.client";
import { INVOCATION_GATEWAY_AVAILABLE } from "../internal/invoke.contract";
import { OrgPolicyService } from "../policies/org-policy.service";
import { invocationCleared } from "../providers/invocation.terms";
import {
  loopCapabilities,
  PR_PUBLISHING_IMPLEMENTED,
  type LoopCapabilitiesResource,
  type LoopFacts,
} from "./loop.capabilities";
import { LoopRepository } from "./loop.repository";

/** The connection kinds whose adapter may serve invocation (DH.4). Static: terms are code. */
const INVOCABLE_KINDS = PROVIDER_CONNECTION_KINDS.filter(invocationCleared);

/** What an engine that did not answer reports. */
const ENGINE_UNREACHABLE: LoopFacts["engine"] = {
  reachable: false,
  taskQueue: false,
  executors: [],
};

@Injectable()
export class LoopCapabilitiesService {
  /**
   * @param config - The deployment switch.
   * @param engine - The engine's status.
   * @param policies - The workspace's dry-run policy.
   * @param loop - The workspace's connections and runners.
   */
  constructor(
    private readonly config: AppConfigService,
    private readonly engine: EngineClient,
    private readonly policies: OrgPolicyService,
    private readonly loop: LoopRepository,
  ) {}

  /**
   * The report for one workspace.
   *
   * @param organizationId - The workspace, from the tenant context — never from the request.
   * @returns The report.
   */
  async read(organizationId: string): Promise<LoopCapabilitiesResource> {
    const [invocableConnection, runners, engine, dryRun] = await Promise.all([
      this.loop.invocableConnectionExists(organizationId, INVOCABLE_KINDS),
      this.loop.runnerPresence(organizationId),
      this.engineFacts(),
      this.policies.dryRun(organizationId),
    ]);

    return loopCapabilities({
      deploymentEnabled: this.config.liveExecutionEnabled,
      invocationImplemented: INVOCATION_GATEWAY_AVAILABLE,
      invocableConnection,
      engine,
      runners,
      prPublishingImplemented: PR_PUBLISHING_IMPLEMENTED,
      dryRun,
    });
  }

  /**
   * What the engine says about its queue and executors.
   *
   * @returns The engine's facts, or {@link ENGINE_UNREACHABLE} when the status call failed.
   */
  private async engineFacts(): Promise<LoopFacts["engine"]> {
    try {
      const status = await this.engine.status();

      return {
        reachable: true,
        taskQueue: status.taskQueue ?? false,
        executors: status.executors ?? [],
      };
    } catch {
      return ENGINE_UNREACHABLE;
    }
  }
}
