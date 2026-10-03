/**
 * The Build Analyzer's operations (BV.1, [#510](https://github.com/NobuData/ouroboros/issues/510);
 * BW.1, [#516](https://github.com/NobuData/ouroboros/issues/516); BW.2,
 * [#517](https://github.com/NobuData/ouroboros/issues/517); BW.3,
 * [#518](https://github.com/NobuData/ouroboros/issues/518); BW.4,
 * [#519](https://github.com/NobuData/ouroboros/issues/519); BW.5,
 * [#520](https://github.com/NobuData/ouroboros/issues/520)) — the runs mockup 18's head and meta
 * strip render, *Run analysis now*, the schedule behind **Schedule: weekly + every 50 builds ▾**,
 * the duration series with the change-points detected on it, the suggestion cards with what a
 * suggestion may be done with — previewed, applied, dismissed, drafted — the drafted-tickets
 * card with its push, and the measurements every apply opened, with the calibration they moved.
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

/** A repository's duration series and the change-points one run detected on it. */
export type DurationChart = components["schemas"]["DurationChart"];

/** One UTC day of the duration series. */
export type DurationPoint = components["schemas"]["DurationPoint"];

/** One detected change-point — a chip, and the Details sheet behind it. */
export type ChangePoint = components["schemas"]["ChangePoint"];

/** One ranked attribution candidate of a change-point. */
export type ChangePointCandidate = components["schemas"]["ChangePointCandidate"];

/** One evidence reference of a finding, resolved to what it names and where it opens. */
export type AnalysisEvidence = components["schemas"]["AnalysisEvidence"];

/** A repository's current build-process and workflow suggestions, with its calibration. */
export type AnalysisSuggestions = components["schemas"]["AnalysisSuggestions"];

/** One suggestion — a row of a card, with its bases, its resolution and the findings it cites. */
export type AnalysisSuggestion = components["schemas"]["AnalysisSuggestion"];

/** How a suggestion's confidence was computed — the scoring popover. */
export type AnalysisSuggestionConfidence = components["schemas"]["AnalysisSuggestionConfidence"];

/** A suggestion's impact, with the basis it was arrived at by. */
export type AnalysisSuggestionImpact = components["schemas"]["AnalysisSuggestionImpact"];

/** One finding a suggestion cites, as its analyzer wrote it. */
export type AnalysisSuggestionFinding = components["schemas"]["AnalysisSuggestionFinding"];

/** One analyzer and impact class's calibration factor, with every update that moved it. */
export type CalibrationCell = components["schemas"]["CalibrationCell"];

/** What applying a suggestion would change, and where — the consequence preview. */
export type SuggestionPreview = components["schemas"]["SuggestionPreview"];

/** What an apply did: the resolution, the preview it executed, where it landed, the measurement. */
export type AppliedSuggestion = components["schemas"]["AppliedSuggestion"];

/** A suggestion's resolution, as an action answers it. */
export type SuggestionResolution = components["schemas"]["SuggestionResolution"];

/** A drafted planning batch, and the suggestions drafted into it. */
export type DraftedSuggestions = components["schemas"]["DraftedSuggestions"];

/** A repository's drafted-tickets card: the un-drafted ticket suggestions and the batches. */
export type AnalysisTickets = components["schemas"]["AnalysisTickets"];

/** A ticket suggestion nobody has drafted yet. */
export type AnalysisUndraftedTicket = components["schemas"]["AnalysisUndraftedTicket"];

/** One planning batch on the card, with what each draft's body says its evidence is. */
export type AnalysisTicketBatch = components["schemas"]["AnalysisTicketBatch"];

/** What one draft's body says its evidence is. */
export type AnalysisDraftedTicket = components["schemas"]["AnalysisDraftedTicket"];

/** What a push did — each selected draft's state, and how many landed this run. */
export type AnalyzerPushReport = components["schemas"]["PlanningPushReport"];

/** A repository's measurements, its calibration cells and the arithmetic between them. */
export type Measurements = components["schemas"]["Measurements"];

/** One applied suggestion: predicted and — once its window closes — measured. */
export type Measurement = components["schemas"]["Measurement"];

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
   * `GET /api/v1/analyzer/duration?repo=` — the duration series of the newest run that detected
   * change-points, with those change-points: ranked candidates, scores, resolved evidence.
   *
   * @param repo The repository, `owner/name`.
   * @param client The client to call through. Defaults to the server-side one.
   * @param signal Abandons the request — the poll's deadline.
   * @returns The chart; `runId: null` and empty lists before any run has detected change-points.
   * @throws {ApiError} What the service answered.
   */
  async duration(repo: string, client: ApiClient = api(), signal?: AbortSignal): Promise<DurationChart> {
    return unwrap(await client.GET("/api/v1/analyzer/duration", { params: { query: { repo } }, signal }));
  },

  /**
   * `GET /api/v1/analyzer/suggestions?repo=` — the build-process and workflow suggestions still
   * current, in every status, most confident first. One stays current until an analysis that ran
   * its analyzers no longer finds it.
   *
   * @param repo The repository, `owner/name`.
   * @param client The client to call through. Defaults to the server-side one.
   * @param signal Abandons the request — the poll's deadline.
   * @returns The suggestions; `runId: null` and none before an analysis has composed one.
   * @throws {ApiError} What the service answered.
   */
  async suggestions(repo: string, client: ApiClient = api(), signal?: AbortSignal): Promise<AnalysisSuggestions> {
    return unwrap(await client.GET("/api/v1/analyzer/suggestions", { params: { query: { repo } }, signal }));
  },

  /**
   * `GET /api/v1/analyzer/suggestions/{id}/preview` — what applying it would change, and where.
   * No side effects; every member may read.
   *
   * @param id The suggestion.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The preview, with the fingerprint an apply may be held to.
   * @throws {ApiError} `analysis_suggestion_not_found`, `workflow_not_found`.
   */
  async preview(id: string, client: ApiClient = api()): Promise<SuggestionPreview> {
    return unwrap(
      await client.GET("/api/v1/analyzer/suggestions/{id}/preview", { params: { path: { id } } }),
    );
  },

  /**
   * `POST /api/v1/analyzer/suggestions/{id}/apply` — apply it through the plane that owns the
   * change. `owner`/`admin` only.
   *
   * @param id The suggestion.
   * @param fingerprint The preview's fingerprint: the apply is refused unless it does exactly that.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns What was applied, where it landed and the measurement row it opened.
   * @throws {ApiError} `analysis_preview_stale`, `analysis_suggestion_resolved`,
   *   `analysis_baseline_unavailable` (409s), `analysis_plane_unavailable` (422), `forbidden`,
   *   `analysis_suggestion_not_found`, or the plane's own refusal.
   */
  async apply(id: string, fingerprint: string, client: ApiClient = api()): Promise<AppliedSuggestion> {
    return unwrap(
      await client.POST("/api/v1/analyzer/suggestions/{id}/apply", {
        params: { path: { id } },
        body: { fingerprint },
      }),
    );
  },

  /**
   * `POST /api/v1/analyzer/suggestions/{id}/dismiss` — dismiss it, for good. `owner`, `admin` or
   * `member`.
   *
   * @param id The suggestion.
   * @param reason Why, or `undefined` for a dismissal without a reason.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The resolution.
   * @throws {ApiError} `analysis_suggestion_resolved` (409), `forbidden`,
   *   `analysis_suggestion_not_found`, `validation_failed`.
   */
  async dismiss(
    id: string,
    reason: string | undefined,
    client: ApiClient = api(),
  ): Promise<SuggestionResolution> {
    return unwrap(
      await client.POST("/api/v1/analyzer/suggestions/{id}/dismiss", {
        params: { path: { id } },
        body: reason === undefined ? {} : { reason },
      }),
    );
  },

  /**
   * `POST /api/v1/analyzer/suggestions/draft` — draft ticket and spike suggestions into one
   * planning batch. `owner`/`admin` only. Nothing reaches a tracker until the batch is pushed.
   *
   * @param suggestionIds The suggestions, in the batch's order.
   * @param targetSourceId The write-capable ticket source the batch will push to.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The batch and the suggestions drafted into it.
   * @throws {ApiError} `analysis_suggestion_not_draftable` (422), `analysis_suggestion_resolved`,
   *   `planning_target_read_only` (409s), `planning_source_not_found`, `forbidden`.
   */
  async draft(
    suggestionIds: readonly string[],
    targetSourceId: string,
    client: ApiClient = api(),
  ): Promise<DraftedSuggestions> {
    return unwrap(
      await client.POST("/api/v1/analyzer/suggestions/draft", {
        body: { suggestionIds: [...suggestionIds], targetSourceId },
      }),
    );
  },

  /**
   * `GET /api/v1/analyzer/measurements?repo=` — every applied suggestion's measurement, newest
   * apply first, with the repository's calibration cells and the formula that moves them.
   *
   * @param repo The repository, `owner/name`.
   * @param client The client to call through. Defaults to the server-side one.
   * @param signal Abandons the request — the poll's deadline.
   * @returns The measurements; none before a suggestion has been applied.
   * @throws {ApiError} What the service answered.
   */
  async measurements(repo: string, client: ApiClient = api(), signal?: AbortSignal): Promise<Measurements> {
    return unwrap(await client.GET("/api/v1/analyzer/measurements", { params: { query: { repo } }, signal }));
  },

  /**
   * `GET /api/v1/analyzer/tickets?repo=` — the drafted-tickets card: the ticket suggestions nobody
   * has drafted yet, and the planning batches the rest were drafted into, each batch as planning
   * answers it with the evidence every draft's body states.
   *
   * @param repo The repository, `owner/name`.
   * @param client The client to call through. Defaults to the server-side one.
   * @param signal Abandons the request — the poll's deadline.
   * @returns The card; both lists empty before an analysis has composed a ticket suggestion.
   * @throws {ApiError} What the service answered.
   */
  async tickets(repo: string, client: ApiClient = api(), signal?: AbortSignal): Promise<AnalysisTickets> {
    return unwrap(await client.GET("/api/v1/analyzer/tickets", { params: { query: { repo } }, signal }));
  },

  /**
   * `POST /api/v1/analyzer/batches/{id}/push` — push an analyzer-drafted batch's **selected**
   * drafts to its tracker. `owner`/`admin` only. Idempotent: a draft already pushed is not pushed
   * again, so a retry after a failure files only what did not land.
   *
   * @param batchId The batch.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns What the push did.
   * @throws {ApiError} `batch_not_pushable`, `push_in_progress`, `push_nothing_selected`,
   *   `push_target_read_only` (409s), `analysis_batch_not_found`, `forbidden`.
   */
  async push(batchId: string, client: ApiClient = api()): Promise<AnalyzerPushReport> {
    return unwrap(
      await client.POST("/api/v1/analyzer/batches/{id}/push", { params: { path: { id: batchId } } }),
    );
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
