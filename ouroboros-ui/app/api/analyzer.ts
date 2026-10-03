/**
 * The Build Analyzer's operations (BV.1, [#510](https://github.com/NobuData/ouroboros/issues/510);
 * BW.1, [#516](https://github.com/NobuData/ouroboros/issues/516)) — the runs mockup 18's head and
 * meta strip render, *Run analysis now*, and the schedule behind **Schedule: weekly + every 50
 * builds ▾**.
 *
 * Thin by design, like every module here: one function per operation, the client injectable so a
 * suite can stub `fetch`, and the service's refusals left as `ApiError`s for the caller to word.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** One analysis run — status, phase, per-analyzer progress, manifest and provenance. */
export type AnalysisRun = components["schemas"]["AnalysisRun"];

/** The corpus receipt the meta strip renders. */
export type AnalysisManifest = components["schemas"]["AnalysisManifest"];

/** One source's sampling record — whether it was read in full, and if not, at what rate. */
export type AnalysisSamplingRecord = components["schemas"]["AnalysisSamplingRecord"];

/** The analyzers a run ran, with their versions and kinds. */
export type AnalyzerSet = components["schemas"]["AnalyzerSet"];

/** One analyzer's progress within a run. */
export type AnalyzerProgress = components["schemas"]["AnalyzerProgress"];

/** What produced a run's confidence note — the confidence popover. */
export type AnalysisConfidenceBasis = components["schemas"]["AnalysisConfidenceBasis"];

/** A repository's schedule, with its live every-N counter. */
export type AnalysisSchedule = components["schemas"]["AnalysisSchedule"];

/** What the schedule editor saves — the whole configuration. */
export type AnalysisScheduleInput = components["schemas"]["PutAnalysisScheduleBody"];

/** The analyzer operations. */
export const analyzer = {
  /**
   * `GET /api/v1/analyzer/runs/latest?repo=` — a repository's newest run.
   *
   * @param repo The repository, `owner/name`.
   * @param client The client to call through. Defaults to the server-side one.
   * @param signal Abandons the request — the poll's deadline.
   * @returns The run, or `null` before the first analysis.
   * @throws {ApiError} What the service answered.
   */
  async latest(repo: string, client: ApiClient = api(), signal?: AbortSignal): Promise<AnalysisRun | null> {
    const answer = unwrap(
      await client.GET("/api/v1/analyzer/runs/latest", { params: { query: { repo } }, signal }),
    );

    return answer.run;
  },

  /**
   * `POST /api/v1/analyzer/runs` — *Run analysis now*. `owner`/`admin` only.
   *
   * @param repo The repository, `owner/name`.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The new run, `running` in `assembling`.
   * @throws {ApiError} `analysis_already_running` (409, its details name the run that is going),
   *   `analysis_repository_not_found`, `forbidden`, `engine_unavailable`.
   */
  async start(repo: string, client: ApiClient = api()): Promise<AnalysisRun> {
    return unwrap(await client.POST("/api/v1/analyzer/runs", { body: { repo } }));
  },

  /**
   * `GET /api/v1/analyzer/schedule?repo=` — a repository's schedule and live build counter.
   *
   * @param repo The repository, `owner/name`.
   * @param client The client to call through. Defaults to the server-side one.
   * @param signal Abandons the request — the poll's deadline.
   * @returns The schedule; `saved: false` when none was ever saved.
   * @throws {ApiError} What the service answered.
   */
  async schedule(repo: string, client: ApiClient = api(), signal?: AbortSignal): Promise<AnalysisSchedule> {
    return unwrap(await client.GET("/api/v1/analyzer/schedule", { params: { query: { repo } }, signal }));
  },

  /**
   * `PUT /api/v1/analyzer/schedule` — save a repository's whole schedule. `owner`/`admin` only.
   *
   * @param input The configuration.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The saved schedule.
   * @throws {ApiError} `validation_failed` (its details name each field), `forbidden`,
   *   `analysis_repository_not_found`.
   */
  async saveSchedule(input: AnalysisScheduleInput, client: ApiClient = api()): Promise<AnalysisSchedule> {
    return unwrap(await client.PUT("/api/v1/analyzer/schedule", { body: input }));
  },
};
