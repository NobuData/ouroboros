/**
 * The Build Analyzer's run records and schedules — every statement against `analysis_runs`,
 * `analysis_schedules` and `analysis_findings` (BV.1,
 * [#510](https://github.com/NobuData/ouroboros/issues/510); the tables are V080/V081/V086).
 *
 * Three statements here carry a rule the rest of the domain relies on:
 *
 *   * **{@link AnalysisRepository.insertRun} is the concurrent-run guard.** The insert is refused
 *     by `analysis_runs_one_running` (V080's partial unique index) when the repository already has
 *     a running analysis, and that refusal — not a prior "is one running?" read — is what decides.
 *     A weekly tick, the fiftieth build and a person's click arriving together produce exactly one
 *     run; the others are told which run is already going.
 *   * **{@link AnalysisRepository.countBuild} is one `UPDATE`.** The increment, the threshold test
 *     and the reset happen under the schedule row's lock in a single statement, so a burst of
 *     completions cannot fire the trigger twice or step over it.
 *   * **Every write to a run is guarded by `status = 'running'`.** A run the reaper has already
 *     failed, or one finished by another path, is never written again — and V086's guard refuses
 *     it in the database besides.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Selectable } from "kysely";

import { DatabaseService } from "../db/db.service";
import type {
  AnalysisPhase,
  AnalysisRunsTable,
  AnalysisSchedulesTable,
  AnalysisStatus,
  AnalysisTrigger,
} from "../db/schema";
import type { AnalyzerSet, EngineFinding } from "../engine/engine.analysis";
import { isDatabaseFailure, UNIQUE_VIOLATION } from "../tenancy/constraints";
import type { CorpusManifest } from "./corpus/corpus.manifest";
import type { RunProgress } from "./analysis.progress";

/** The guard's name, as V080 declares it. */
export const ONE_RUNNING_INDEX = "analysis_runs_one_running";

/** A run row, as read. */
export type AnalysisRunRow = Selectable<AnalysisRunsTable>;

/** A schedule row, as read. */
export type AnalysisScheduleRow = Selectable<AnalysisSchedulesTable>;

/** What starting a run needs. */
export interface NewRun {
  organizationId: string;
  repoRef: string;
  trigger: AnalysisTrigger;
  scheduleId: string | null;
  analyzerSet: AnalyzerSet;
  progress: RunProgress;
}

/** How an insert went: the new run, or the run that is already going. */
export type InsertedRun =
  { started: true; run: AnalysisRunRow } | { started: false; running: AnalysisRunRow | undefined };

/** How a run ends. */
export interface RunEnding {
  status: Exclude<AnalysisStatus, "running">;
  /** The phase it ended in; null keeps the one it reached. */
  phase: AnalysisPhase | null;
  /** The final manifest; null keeps the stored one. */
  manifest: CorpusManifest | null;
  /** The final progress; null keeps the stored one. */
  progress: RunProgress | null;
  computeSeconds: number;
  confidenceNote: string | null;
  failureReason: string | null;
}

/** A weekly schedule, with when its repository last started an analysis. */
export interface WeeklySchedule {
  id: string;
  organizationId: string;
  repoRef: string;
  weeklyDay: number;
  /** `HH:MM`, UTC. */
  weeklyTime: string;
  createdAt: Date;
  lastStartedAt: Date | null;
}

/** What one build's completion did to its repository's counter. */
export interface CountedBuild {
  scheduleId: string;
  /** Whether this build reached the threshold — the counter is back at 0. */
  fired: boolean;
}

@Injectable()
export class AnalysisRepository {
  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * A repository's schedule.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @returns The row, or undefined when none was ever saved.
   */
  async schedule(
    organizationId: string,
    repoRef: string,
  ): Promise<AnalysisScheduleRow | undefined> {
    return this.database.db
      .selectFrom("analysis_schedules")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("repo_ref", "=", repoRef)
      .executeTakeFirst();
  }

  /**
   * Insert a running analysis — or learn that one is already running.
   *
   * @param run - The run to start.
   * @returns The new row, or the running one that refused it (undefined if it ended between the
   *   refusal and the read).
   * @throws Whatever else the insert threw.
   */
  async insertRun(run: NewRun): Promise<InsertedRun> {
    try {
      const row = await this.database.db
        .insertInto("analysis_runs")
        .values({
          organization_id: run.organizationId,
          repo_ref: run.repoRef,
          trigger: run.trigger,
          schedule_id: run.scheduleId,
          analyzer_set: JSON.stringify(run.analyzerSet),
          progress: JSON.stringify(run.progress),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return { started: true, run: row };
    } catch (error) {
      if (
        isDatabaseFailure(error) &&
        error.code === UNIQUE_VIOLATION &&
        error.constraint === ONE_RUNNING_INDEX
      ) {
        return { started: false, running: await this.running(run.organizationId, run.repoRef) };
      }
      throw error;
    }
  }

  /**
   * The repository's running analysis.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @returns The run, or undefined.
   */
  async running(organizationId: string, repoRef: string): Promise<AnalysisRunRow | undefined> {
    return this.database.db
      .selectFrom("analysis_runs")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("repo_ref", "=", repoRef)
      .where("status", "=", "running")
      .executeTakeFirst();
  }

  /**
   * One run of the workspace.
   *
   * @param organizationId - The workspace.
   * @param id - The run.
   * @returns The row, or undefined for another workspace's run or none.
   */
  async run(organizationId: string, id: string): Promise<AnalysisRunRow | undefined> {
    return this.database.db
      .selectFrom("analysis_runs")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * A repository's most recent run.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @returns The newest by start, or undefined.
   */
  async latest(organizationId: string, repoRef: string): Promise<AnalysisRunRow | undefined> {
    return this.database.db
      .selectFrom("analysis_runs")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("repo_ref", "=", repoRef)
      .orderBy("started_at", "desc")
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Store the assembled manifest and move the run to `analyzing`.
   *
   * @param id - The run.
   * @param manifest - What assembly read.
   * @returns Whether the run was still running.
   */
  async analyzing(id: string, manifest: CorpusManifest): Promise<boolean> {
    const result = await this.database.db
      .updateTable("analysis_runs")
      .set({ corpus_manifest: JSON.stringify(manifest), phase: "analyzing" })
      .where("id", "=", id)
      .where("status", "=", "running")
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /**
   * Record per-analyzer progress, and optionally the phase.
   *
   * @param id - The run.
   * @param progress - Every analyzer's state.
   * @param phase - The phase, when it moves.
   * @returns Whether the run was still running.
   */
  async progress(id: string, progress: RunProgress, phase?: AnalysisPhase): Promise<boolean> {
    const result = await this.database.db
      .updateTable("analysis_runs")
      .set({ progress: JSON.stringify(progress), ...(phase === undefined ? {} : { phase }) })
      .where("id", "=", id)
      .where("status", "=", "running")
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /**
   * Write one analyzer's findings into a running run — all of them, or none.
   *
   * V081's guard checks each row as it lands: the run is running, the analyzer is in its set, the
   * evidence resolves, the data has its type's shape. One refusal rolls back the analyzer's whole
   * batch, so a run never holds half of what an analyzer found.
   *
   * @param run - The run.
   * @param findings - The analyzer's findings.
   * @returns How many were written.
   * @throws Whatever the database refused; the caller records it as that analyzer's failure.
   */
  async writeFindings(
    run: Pick<AnalysisRunRow, "id" | "organization_id" | "repo_ref">,
    findings: readonly EngineFinding[],
  ): Promise<number> {
    if (findings.length === 0) {
      return 0;
    }

    await this.database.transaction(async (trx) => {
      await trx
        .insertInto("analysis_findings")
        .values(
          findings.map((finding) => ({
            run_id: run.id,
            organization_id: run.organization_id,
            repo_ref: run.repo_ref,
            analyzer: finding.analyzer,
            analyzer_version: finding.analyzer_version,
            finding_type: finding.finding_type,
            subject_key: finding.subject_key,
            data: JSON.stringify(finding.data),
            evidence_refs: JSON.stringify(finding.evidence_refs),
            confidence: finding.confidence,
            confidence_basis: JSON.stringify(finding.confidence_basis),
          })),
        )
        .execute();
    });

    return findings.length;
  }

  /**
   * End a running run.
   *
   * @param id - The run.
   * @param ending - How it ended.
   * @returns Whether it was still running — false when another path ended it first.
   */
  async finish(id: string, ending: RunEnding): Promise<boolean> {
    const result = await this.database.db
      .updateTable("analysis_runs")
      .set({
        status: ending.status,
        ...(ending.phase === null ? {} : { phase: ending.phase }),
        ...(ending.manifest === null ? {} : { corpus_manifest: JSON.stringify(ending.manifest) }),
        ...(ending.progress === null ? {} : { progress: JSON.stringify(ending.progress) }),
        finished_at: sql<Date>`greatest(now(), started_at)`,
        compute_seconds: ending.computeSeconds,
        confidence_note: ending.confidenceNote,
        failure_reason: ending.failureReason,
      })
      .where("id", "=", id)
      .where("status", "=", "running")
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /**
   * The repository a build job belongs to.
   *
   * @param organizationId - The workspace.
   * @param jobId - The job.
   * @returns `owner/name`, or undefined.
   */
  async jobRepo(organizationId: string, jobId: string): Promise<string | undefined> {
    const { rows } = await sql<{ repo_ref: string }>`
      select gh.login || '/' || repo.name as repo_ref
        from ouroboros.build_jobs b
        join ouroboros.github_repos repo on repo.id = b.github_repo_id
        join ouroboros.github_orgs gh on gh.id = repo.org_id
       where b.organization_id = ${organizationId} and b.id = ${jobId}`.execute(this.database.db);

    return rows[0]?.repo_ref;
  }

  /**
   * Count one finished build against its repository's every-N trigger — atomically.
   *
   * The counter always counts (V080: it is independent of the threshold); it resets to 0 and
   * fires only when the schedule is enabled and has a threshold the new count reaches. Because
   * the reset is part of the same statement as the increment, concurrent completions serialise
   * on the row and exactly one of them sees the threshold.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @returns The schedule and whether this build fired it; undefined when the repository has no
   *   schedule (nothing to count against).
   */
  async countBuild(organizationId: string, repoRef: string): Promise<CountedBuild | undefined> {
    const { rows } = await sql<{ id: string; fired: boolean }>`
      update ouroboros.analysis_schedules s
         set build_counter = case
               when s.enabled and s.every_n_builds is not null
                    and s.build_counter + 1 >= s.every_n_builds then 0
               else s.build_counter + 1
             end
       where s.organization_id = ${organizationId} and s.repo_ref = ${repoRef}
       returning s.id,
                 (s.build_counter = 0 and s.enabled and s.every_n_builds is not null) as fired`.execute(
      this.database.db,
    );

    const row = rows[0];

    return row === undefined ? undefined : { scheduleId: row.id, fired: row.fired };
  }

  /**
   * Re-arm a fired every-N trigger whose run could not start, so the next build fires it again.
   *
   * @param scheduleId - The schedule.
   * @returns When re-armed.
   */
  async rearm(scheduleId: string): Promise<void> {
    await sql`
      update ouroboros.analysis_schedules
         set build_counter = greatest(build_counter, every_n_builds - 1)
       where id = ${scheduleId} and every_n_builds is not null`.execute(this.database.db);
  }

  /**
   * Every enabled weekly schedule, with when its repository last started an analysis.
   *
   * @returns The schedules, across workspaces — the scheduler decides which are due.
   */
  async weeklySchedules(): Promise<WeeklySchedule[]> {
    const { rows } = await sql<{
      id: string;
      organization_id: string;
      repo_ref: string;
      weekly_day: number;
      weekly_time: string;
      created_at: Date;
      last_started_at: Date | null;
    }>`
      select s.id, s.organization_id, s.repo_ref, s.weekly_day,
             to_char(s.weekly_time, 'HH24:MI') as weekly_time, s.created_at,
             (select max(r.started_at) from ouroboros.analysis_runs r
               where r.organization_id = s.organization_id and r.repo_ref = s.repo_ref)
               as last_started_at
        from ouroboros.analysis_schedules s
       where s.enabled and s.weekly_enabled
       order by s.id`.execute(this.database.db);

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      repoRef: row.repo_ref,
      weeklyDay: row.weekly_day,
      weeklyTime: row.weekly_time,
      createdAt: row.created_at,
      lastStartedAt: row.last_started_at,
    }));
  }

  /**
   * Fail every running analysis that has outlived its compute ceiling by `graceSeconds` — a run
   * whose process stopped before it could end it. Without this, a restart mid-run would hold the
   * concurrent-run guard shut for its repository forever.
   *
   * The ceiling is the run's own (its manifest's budget), else its schedule's, else V080's default.
   *
   * @param graceSeconds - How long past the ceiling a run is presumed abandoned.
   * @param reason - The failure reason recorded.
   * @returns The ids failed.
   */
  async reapStale(graceSeconds: number, reason: string): Promise<string[]> {
    const { rows } = await sql<{ id: string }>`
      update ouroboros.analysis_runs r
         set status = 'failed', finished_at = now(), failure_reason = ${reason},
             compute_seconds = greatest(0, extract(epoch from (now() - r.started_at))::int)
       where r.status = 'running'
         and r.started_at + make_interval(secs => coalesce(
               (r.corpus_manifest #>> '{budget,compute_ceiling_seconds}')::int,
               (select s.compute_ceiling_seconds from ouroboros.analysis_schedules s
                 where s.organization_id = r.organization_id and s.repo_ref = r.repo_ref),
               3600) + ${graceSeconds}) < now()
       returning r.id`.execute(this.database.db);

    return rows.map((row) => row.id);
  }
}
