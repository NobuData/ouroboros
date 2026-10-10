/**
 * The infra replay estimators (CD.3,
 * [#561](https://github.com/NobuData/ouroboros/issues/561)).
 *
 * ```
 * never:  a model asked "how long will this build take?"
 * always: arithmetic over builds this farm actually ran, with the sample attached
 * ```
 *
 * A dry run dispatches nothing to the farm (decision W4), so its build and test rows are
 * **replayed from history**. This service answers two questions for a dry run's stage — *how
 * long do builds like this one take?* and *how long does this suite set take?* — and each answer
 * is either an estimate with its whole basis (median, spread, sample count, window, similarity
 * class) or `insufficient_history` with the count that was found. There is no third shape, and
 * {@link assertCompleteEstimate} checks every answer before it leaves.
 *
 * Who calls it: the engine's dry-run harness, through `POST
 * /internal/dry-runs/{id}/replay-estimates` (`replay.internal.controller.ts`); and dry-run
 * orchestration inside this service, through the exported methods here.
 */

import { Injectable } from "@nestjs/common";

import {
  type ReplayResult,
  type ReplayStageRecord,
  assertCompleteEstimate,
  composeEstimate,
  replayStageRecord,
} from "./replay.estimate";
import {
  commandRequired,
  dryRunNotFound,
  poolNotFound,
  poolRequired,
  repositoryUnresolved,
} from "./replay.errors";
import type { ReplayKind } from "./replay.formulas";
import { ReplayEstimateRepository } from "./replay.repository";

/** What a stage asks to have estimated. */
export interface ReplayRequest {
  /** A build, or a test run. */
  readonly kind: ReplayKind;
  /** The stage's runner pool, by name. Required for a build. */
  readonly runnerPool?: string;
  /** The stage's command. A build without one takes its pool's default. */
  readonly command?: string;
  /** The suite set of a test stage. Without one, the set the repository last measured. */
  readonly suites?: readonly string[];
}

/** An estimator's answer, with the stage row that records it. */
export interface ReplayEstimateResource {
  /** The estimate, or the insufficient-history answer. */
  readonly estimate: ReplayResult;
  /** The same answer as a `dry_run_stages` row's `how`, `note` and `metrics`. */
  readonly stage: ReplayStageRecord;
}

/** The class printed for a repository with no measured test run to take a suite set from. */
const NO_SUITE_SET = "no measured test run";

@Injectable()
export class ReplayEstimateService {
  /** @param repository - The statements. */
  constructor(private readonly repository: ReplayEstimateRepository) {}

  /**
   * Estimate one infra stage of a dry run from history.
   *
   * @param dryRunId - The dry run. Its workspace and its ticket's repository are what is sampled.
   * @param request - What to estimate.
   * @returns The estimate — or insufficient history — and the stage row that records it.
   * @throws {NotFoundError} `dry_run_not_found`.
   * @throws {InvalidRequestError} `replay_repository_unresolved`, `replay_pool_required`,
   *   `replay_pool_not_found` or `replay_command_required`.
   */
  async estimate(dryRunId: string, request: ReplayRequest): Promise<ReplayEstimateResource> {
    const context = await this.repository.context(dryRunId);

    if (context === undefined) throw dryRunNotFound(dryRunId);
    if (context.repository === null) throw repositoryUnresolved(dryRunId);

    const result =
      request.kind === "build"
        ? await this.estimateBuild(context.organizationId, context.repository, request)
        : await this.estimateTest(context.organizationId, context.repository, request.suites);
    const estimate = assertCompleteEstimate(result);

    return { estimate, stage: replayStageRecord(estimate) };
  }

  /**
   * Estimate a build stage: the median wall time of the similar succeeded builds.
   *
   * @param organizationId - The workspace.
   * @param repository - The repository built.
   * @param request - The stage's pool and command.
   * @returns The estimate with its cache context, or insufficient history.
   * @throws {InvalidRequestError} `replay_pool_required`, `replay_pool_not_found` or
   *   `replay_command_required`.
   */
  async estimateBuild(
    organizationId: string,
    repository: { readonly id: string; readonly name: string },
    request: Pick<ReplayRequest, "runnerPool" | "command">,
  ): Promise<ReplayResult> {
    if (request.runnerPool === undefined) throw poolRequired();

    const row = await this.repository.buildSample(
      organizationId,
      repository,
      request.runnerPool,
      request.command ?? null,
    );

    if (row === undefined) throw poolNotFound(request.runnerPool);
    if (row.command === null || row.similarityClass === null) {
      throw commandRequired(request.runnerPool);
    }

    return composeEstimate("build", row.similarityClass, row.sample, row.policy, row.cache);
  }

  /**
   * Estimate a test stage: the median wall time of the test runs that reported its suite set.
   * It reads test history only.
   *
   * @param organizationId - The workspace.
   * @param repository - The repository tested.
   * @param suites - The stage's suite set; omitted, the set the repository last measured.
   * @returns The estimate, or insufficient history — which is also the answer for a repository
   *   with no measured test run at all.
   */
  async estimateTest(
    organizationId: string,
    repository: { readonly id: string; readonly name: string },
    suites?: readonly string[],
  ): Promise<ReplayResult> {
    const row = await this.repository.testSample(organizationId, repository, suites ?? null);

    return composeEstimate(
      "test",
      row.similarityClass ?? `${repository.name} · tests · ${NO_SUITE_SET}`,
      row.sample,
      row.policy,
    );
  }
}
