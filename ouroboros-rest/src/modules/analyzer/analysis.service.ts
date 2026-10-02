/**
 * The Build Analyzer's request side — *Run analysis now* and the run reads (BV.1,
 * [#510](https://github.com/NobuData/ouroboros/issues/510)).
 *
 * The manual trigger is the orchestrator's `start` with an actor: the run is started, then the
 * request is audited as `analyzer.run_requested` naming it. A refused start (`409` — one is already
 * running) starts nothing and so records nothing; the run that is going already has its own row.
 */

import { Injectable } from "@nestjs/common";

import { ANALYZER_RUN_REQUESTED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { analysisRunNotFound } from "./analysis.errors";
import { AnalysisOrchestrator } from "./analysis.orchestrator";
import { AnalysisRepository } from "./analysis.repository";
import {
  analysisRunResource,
  type AnalysisRunResource,
  type LatestAnalysisResource,
} from "./analysis.resources";

@Injectable()
export class AnalysisService {
  /**
   * @param orchestrator - Starts runs.
   * @param runs - Reads them.
   * @param audit - The trail the manual trigger is written to.
   */
  constructor(
    private readonly orchestrator: AnalysisOrchestrator,
    private readonly runs: AnalysisRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Start an analysis because a person asked.
   *
   * @param organizationId - The workspace.
   * @param actorId - The administrator who asked.
   * @param repoRef - The repository.
   * @returns The new run, `running` in `assembling`.
   * @throws {ConflictError} `analysis_already_running`, naming the run that is.
   * @throws {NotFoundError} `analysis_repository_not_found`.
   * @throws {UpstreamError} `engine_unavailable` when the analyzer set cannot be read.
   */
  async runNow(
    organizationId: string,
    actorId: string,
    repoRef: string,
  ): Promise<AnalysisRunResource> {
    const run = await this.orchestrator.start({ organizationId, repoRef, trigger: "manual" });

    await this.audit.record({
      organizationId,
      actorId,
      action: ANALYZER_RUN_REQUESTED_EVENT,
      subjectType: "analysis_run",
      subjectId: run.id,
      at: run.started_at,
      detail: { repo: repoRef, trigger: "manual" },
    });

    return analysisRunResource(run);
  }

  /**
   * One run — its status, phase and per-analyzer progress.
   *
   * @param organizationId - The workspace.
   * @param id - The run.
   * @returns The run.
   * @throws {NotFoundError} `analysis_run_not_found` for another workspace's run or none.
   */
  async run(organizationId: string, id: string): Promise<AnalysisRunResource> {
    const row = await this.runs.run(organizationId, id);
    if (row === undefined) {
      throw analysisRunNotFound();
    }

    return analysisRunResource(row);
  }

  /**
   * A repository's newest run.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @returns It, or `run: null` before the first analysis.
   */
  async latest(organizationId: string, repoRef: string): Promise<LatestAnalysisResource> {
    const row = await this.runs.latest(organizationId, repoRef);

    return { run: row === undefined ? null : analysisRunResource(row) };
  }
}
