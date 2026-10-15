/**
 * Which model sizes an issue — the workspace's choice, or the Ollama default (O.2's core,
 * [#123](https://github.com/NobuData/ouroboros/issues/123)).
 *
 * The estimator runs on a model the workspace chooses the way it chooses every other model:
 * **Model routing**, for the `estimate` task kind every workspace has (V144). This file turns
 * that choice into the target the engine asks the invocation gateway for:
 *
 * ```
 * estimate route resolves      → its first kept hop, as an alias  (the gateway walks the chain)
 * no estimate route            → the workspace's Ollama connection, model llama3.1:8b
 * route does not resolve, or
 * no Ollama connection         → no model: the engine's heuristic answers, and says why
 * ```
 *
 * **Absent is a real answer, never an error.** A workspace that has configured nothing still
 * gets estimates — the heuristic's, with a trace that says no model was configured — so this
 * service never throws: a failed read is the same *no model* with the reason it failed.
 */

import { Injectable, Logger } from "@nestjs/common";

import type { EstimateModel, EstimateSubject } from "../engine/engine.contract";
import { describeForLog } from "../errors/failure";
import { ResolutionService } from "../routing/resolution.service";
import { ROUTING_ERRORS } from "../routing/routing.errors";
import { EstimationRepository } from "./estimation.repository";

/** The task kind the estimator routes through — V144 gives every workspace one. */
export const ESTIMATE_TASK_KIND = "estimate";

/** The model the estimator asks a workspace's Ollama connection for when nothing is routed. */
export const ESTIMATION_DEFAULT_MODEL = "llama3.1:8b";

/** The model target, or why there is none. */
export type EstimationModelChoice =
  | { readonly model: EstimateModel; readonly unavailable?: undefined }
  | { readonly model?: undefined; readonly unavailable: string };

@Injectable()
export class EstimationModelService {
  private readonly logger = new Logger(EstimationModelService.name);

  /**
   * @param routing - Z.1's resolution: the same answer Model routing's simulate panel shows.
   * @param estimates - Where the workspace's Ollama connection is read.
   */
  constructor(
    private readonly routing: ResolutionService,
    private readonly estimates: EstimationRepository,
  ) {}

  /**
   * The model that sizes one subject in one workspace.
   *
   * @param organizationId - The workspace.
   * @param subject - What is being sized — the call is metered against it.
   * @returns The target, or the sentence the trace gives for having none.
   */
  async choose(organizationId: string, subject: EstimateSubject): Promise<EstimationModelChoice> {
    try {
      const resolution = await this.routing.resolve(organizationId, ESTIMATE_TASK_KIND);
      const primary = resolution.chain.find((hop) => hop.decision === "kept");

      if (resolution.outcome !== "resolved" || primary === undefined) {
        return {
          unavailable:
            "the estimate route did not resolve" +
            (resolution.failure === null ? "" : ` — ${resolution.failure.explanation}`),
        };
      }

      return {
        model: {
          alias: primary.alias,
          label: primary.modelId,
          resolutionVersion: resolution.resolutionVersion,
          costCapCents: resolution.maxCostCents,
          subject,
        },
      };
    } catch (error) {
      if (!isRouteNotFound(error)) {
        this.logger.error(
          `Resolving the estimate route of workspace ${organizationId} failed`,
          describeForLog(error),
        );
        return { unavailable: "the estimate route could not be read" };
      }
    }

    return this.ollamaDefault(organizationId, subject);
  }

  /**
   * The default: the workspace's Ollama connection, asked for {@link ESTIMATION_DEFAULT_MODEL}.
   *
   * @param organizationId - The workspace.
   * @param subject - What is being sized.
   * @returns The target, or why there is none.
   */
  private async ollamaDefault(
    organizationId: string,
    subject: EstimateSubject,
  ): Promise<EstimationModelChoice> {
    try {
      const connection = await this.estimates.ollamaConnection(organizationId);

      if (connection === undefined) {
        return {
          unavailable:
            "no estimate route and no Ollama connection — add one under Providers, or route " +
            "the estimate task kind under Model routing",
        };
      }

      return {
        model: {
          connection,
          modelId: ESTIMATION_DEFAULT_MODEL,
          label: ESTIMATION_DEFAULT_MODEL,
          resolutionVersion: null,
          costCapCents: null,
          subject,
        },
      };
    } catch (error) {
      this.logger.error(
        `Reading the Ollama connection of workspace ${organizationId} failed`,
        describeForLog(error),
      );
      return { unavailable: "the workspace's Ollama connection could not be read" };
    }
  }
}

/**
 * Whether a resolution failed because the workspace has no route for the kind.
 *
 * @param error - What `ResolutionService.resolve` threw.
 * @returns Whether it is `route_not_found`.
 */
function isRouteNotFound(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === ROUTING_ERRORS.routeNotFound;
}
