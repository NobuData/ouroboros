"use server";

/**
 * The Build Analyzer page's two writes (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516)) — *Run analysis now* and the schedule
 * editor's save.
 *
 * Refusals come back as values, never throws, so the page words them: a concurrent run is its own
 * outcome (with the run the service named), and a save the service refused carries its per-field
 * complaints. Anything that is not an `ApiError` — Next.js's redirect signal above all — is
 * rethrown.
 */

import { type AnalysisRun, type AnalysisSchedule, type AnalysisScheduleInput, analyzer } from "@/app/api/analyzer";
import { isApiError } from "@/app/api/errors";

import { SCHEDULE_SAVE_FAILED, START_FAILED } from "./view";

/** The service's code for a start refused because one is running. */
const ALREADY_RUNNING = "analysis_already_running";

/** How a press of *Run analysis now* went. */
export type StartOutcome =
  /** A run started; the poll follows it. */
  | { readonly kind: "started"; readonly run: AnalysisRun }
  /** One was already running — nothing was queued. Names it, when the service could. */
  | {
      readonly kind: "running";
      readonly runId: string | null;
      readonly startedAt: string | null;
      readonly phase: string | null;
    }
  /** Refused for another reason, as a sentence. */
  | { readonly kind: "refused"; readonly reason: string };

/** How a schedule save went. */
export type ScheduleOutcome =
  | { readonly ok: true; readonly value: AnalysisSchedule }
  | {
      readonly ok: false;
      readonly reason: string;
      /** The service's per-field complaints, keyed by the body's field names. */
      readonly fields: Readonly<Record<string, string>>;
    };

/**
 * A detail of a refusal as a string, or `null`.
 *
 * @param value The detail.
 * @returns It, when it is a non-empty string.
 */
function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * *Run analysis now* — start an analysis of one repository.
 *
 * @param repo The repository, `owner/name`.
 * @returns The outcome. A `409` is `running`, never a second run.
 */
export async function startAnalysis(repo: string): Promise<StartOutcome> {
  if (typeof repo !== "string" || repo === "") return { kind: "refused", reason: START_FAILED };

  try {
    return { kind: "started", run: await analyzer.start(repo) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    if (error.code === ALREADY_RUNNING) {
      const details = error.details as Record<string, unknown>;

      return {
        kind: "running",
        runId: text(details.runId),
        startedAt: text(details.startedAt),
        phase: text(details.phase),
      };
    }

    return { kind: "refused", reason: `${START_FAILED} ${error.message}` };
  }
}

/**
 * Save a repository's whole schedule.
 *
 * @param input The configuration the editor built.
 * @returns The saved schedule, or why not with each refused field.
 */
export async function saveAnalyzerSchedule(input: AnalysisScheduleInput): Promise<ScheduleOutcome> {
  if (typeof input !== "object" || input === null || typeof input.repo !== "string") {
    return { ok: false, reason: SCHEDULE_SAVE_FAILED, fields: {} };
  }

  try {
    return { ok: true, value: await analyzer.saveSchedule(input) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    const fields: Record<string, string> = {};
    for (const [field, messages] of Object.entries(error.details as Record<string, unknown>)) {
      if (Array.isArray(messages) && typeof messages[0] === "string") fields[field] = messages[0];
    }

    return { ok: false, reason: `${SCHEDULE_SAVE_FAILED} ${error.message}`, fields };
  }
}
