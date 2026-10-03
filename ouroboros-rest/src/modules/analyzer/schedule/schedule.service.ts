/**
 * The Build Analyzer's schedule — read by every member, saved by an administrator (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516); the table is V080's, #506; the
 * triggers that read it are BV.1's scheduler and build counter, #510).
 *
 * A repository with no saved schedule answers V080's defaults with `saved: false` — every
 * trigger off, the default budgets — so the editor always has a form to show. A save is audited
 * as `analyzer.schedule_updated`.
 */

import { Injectable } from "@nestjs/common";

import { ANALYZER_SCHEDULE_UPDATED_EVENT } from "../../audit/audit.events";
import { AuditService } from "../../audit/audit.service";
import { analysisRepositoryNotFound } from "../analysis.errors";
import { AnalysisRepository } from "../analysis.repository";
import { CorpusRepository } from "../corpus/corpus.repository";
import type { PutAnalysisScheduleBody } from "./schedule.dto";
import {
  scheduleResource,
  unsavedSchedule,
  type AnalysisScheduleResource,
} from "./schedule.resources";

@Injectable()
export class AnalysisScheduleService {
  /**
   * @param runs - The schedule's statements.
   * @param corpus - Whether the repository is the workspace's.
   * @param audit - The trail a save is written to.
   */
  constructor(
    private readonly runs: AnalysisRepository,
    private readonly corpus: CorpusRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * A repository's schedule, with its live build counter.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @returns The saved schedule, or V080's defaults with `saved: false`.
   * @throws {NotFoundError} `analysis_repository_not_found`.
   */
  async read(organizationId: string, repoRef: string): Promise<AnalysisScheduleResource> {
    await this.requireRepository(organizationId, repoRef);
    const row = await this.runs.schedule(organizationId, repoRef);

    return row === undefined ? unsavedSchedule(repoRef) : scheduleResource(row);
  }

  /**
   * Save a repository's whole schedule.
   *
   * @param organizationId - The workspace.
   * @param actorId - The administrator saving it.
   * @param body - The validated configuration.
   * @returns The saved schedule; its counter is unchanged by the save.
   * @throws {NotFoundError} `analysis_repository_not_found`.
   */
  async save(
    organizationId: string,
    actorId: string,
    body: PutAnalysisScheduleBody,
  ): Promise<AnalysisScheduleResource> {
    await this.requireRepository(organizationId, body.repo);

    const row = await this.runs.saveSchedule(
      organizationId,
      {
        repoRef: body.repo,
        enabled: body.enabled,
        weeklyEnabled: body.weeklyEnabled,
        weeklyDay: body.weeklyDay ?? null,
        weeklyTime: body.weeklyTime ?? null,
        everyNBuilds: body.everyNBuilds,
        maxBuilds: body.maxBuilds,
        maxLogLines: body.maxLogLines,
        computeCeilingSeconds: body.computeCeilingSeconds,
      },
      actorId,
    );
    const saved = scheduleResource(row);

    await this.audit.record({
      organizationId,
      actorId,
      action: ANALYZER_SCHEDULE_UPDATED_EVENT,
      subjectType: "analysis_schedule",
      subjectId: row.id,
      at: row.updated_at,
      detail: {
        repo: saved.repo,
        enabled: saved.enabled,
        weeklyEnabled: saved.weeklyEnabled,
        weeklyDay: saved.weeklyDay,
        weeklyTime: saved.weeklyTime,
        everyNBuilds: saved.everyNBuilds,
        maxBuilds: saved.maxBuilds,
        maxLogLines: saved.maxLogLines,
        computeCeilingSeconds: saved.computeCeilingSeconds,
      },
    });

    return saved;
  }

  /**
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @returns When the repository is the workspace's.
   * @throws {NotFoundError} `analysis_repository_not_found` otherwise.
   */
  private async requireRepository(organizationId: string, repoRef: string): Promise<void> {
    if ((await this.corpus.repository(organizationId, repoRef)) === undefined) {
      throw analysisRepositoryNotFound(repoRef);
    }
  }
}
