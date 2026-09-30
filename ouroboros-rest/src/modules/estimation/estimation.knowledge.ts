/**
 * The estimator as a context-assembly consumer — INTAKE-L.1's amendment (BF.5,
 * [#414](https://github.com/NobuData/ouroboros/issues/414), decision **K9**).
 *
 * *"Confirmed facts are injected into every run's context"* — and the estimator is the consumer
 * that exists today. So every sizing request assembles the `estimator` manifest for the issue's
 * repository, carries its facts as `EstimationContext.facts`, and once the estimate row is stored
 * records `{consumer: estimator, estimateId, factIds, manifestHash}` — the ids it actually sent.
 *
 * **Knowledge never blocks an estimate.** An assembly that fails is logged and the request goes
 * out with no facts; a record that fails is logged and the estimate stands. The estimate is the
 * product here, and a usage record that could veto one would be the tail wagging the dog. A
 * manifest carrying no facts injects nothing, so nothing is recorded for it.
 */

import { Injectable, Logger } from "@nestjs/common";

import { ContextAssemblyService, injectionOf } from "../context-assembly/context-assembly.service";
import type { ContextManifest } from "../context-assembly/context-assembly.resources";
import type { ContextFact } from "../engine/engine.contract";
import { describeForLog } from "../errors/failure";

@Injectable()
export class EstimationKnowledge {
  /** Where a failed assembly or record is reported. */
  private readonly logger = new Logger(EstimationKnowledge.name);

  /** @param assembly - BF.5's one resolution. */
  constructor(private readonly assembly: ContextAssemblyService) {}

  /**
   * The estimator's manifest for one repository.
   *
   * @param organizationId - The workspace.
   * @param repo - The issue's repository, `owner/name`.
   * @returns The manifest, or `undefined` when assembly failed — logged, and the estimate goes out
   *   without facts.
   */
  async manifestFor(organizationId: string, repo: string): Promise<ContextManifest | undefined> {
    try {
      return await this.assembly.assemble(organizationId, { repo }, "estimator");
    } catch (error) {
      this.logger.error(
        `Assembling the estimator's context for ${repo} failed; sizing without facts.`,
        describeForLog(error),
      );
      return undefined;
    }
  }

  /**
   * Record that an estimate was sized with a manifest's facts.
   *
   * @param organizationId - The workspace.
   * @param estimateId - The `issue_estimates` row the request produced.
   * @param manifest - The manifest whose facts were sent, or `undefined` when none was assembled.
   * @returns When recorded, or when there was nothing to record. Never rejects.
   */
  async record(
    organizationId: string,
    estimateId: string,
    manifest: ContextManifest | undefined,
  ): Promise<void> {
    if (manifest === undefined || manifest.facts.length === 0) {
      return;
    }

    const { factIds, manifestHash } = injectionOf(manifest);

    try {
      await this.assembly.record(organizationId, {
        consumer: "estimator",
        estimateId,
        skillVersionIds: [],
        factIds,
        manifestHash,
      });
    } catch (error) {
      this.logger.error(
        `Recording the estimator's injection for estimate ${estimateId} failed; the estimate ` +
          "stands, and its facts go uncounted.",
        describeForLog(error),
      );
    }
  }
}

/**
 * The facts a manifest sends to the engine.
 *
 * @param manifest - The estimator's manifest, or `undefined`.
 * @returns `{id, text}` per fact, in manifest order; empty without a manifest.
 */
export function factsOf(manifest: ContextManifest | undefined): ContextFact[] {
  return (manifest?.facts ?? []).map((fact) => ({ id: fact.id, text: fact.text }));
}
