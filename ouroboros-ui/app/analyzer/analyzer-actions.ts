"use server";

/**
 * The Build Analyzer page's server hops — *Run analysis now* and the schedule editor's save
 * (BW.1, [#516](https://github.com/NobuData/ouroboros/issues/516)), and what a suggestion may be
 * done with (BW.3, [#518](https://github.com/NobuData/ouroboros/issues/518)): its consequence
 * preview, its apply, its dismissal, and a spike's draft — and the drafted-tickets card's two
 * writes (BW.4, [#519](https://github.com/NobuData/ouroboros/issues/519)): drafting the ticket
 * suggestions into a planning batch, ticking a draft, and pushing a batch to its tracker. The tick
 * is planning's own route — it is planning's checkbox — reached through a hop that can change
 * nothing else about a draft.
 *
 * Refusals come back as values, never throws, so the page words them: a concurrent run is its own
 * outcome (with the run the service named), a save the service refused carries its per-field
 * complaints, and an apply whose preview moved is told apart from one somebody else got to first.
 * Anything that is not an `ApiError` — Next.js's redirect signal above all — is rethrown.
 *
 * **The roles are the service's.** Nothing here checks who is calling: a member's apply is the
 * service's `403`, answered as a refusal like any other.
 */

import {
  type AnalysisRun,
  type AnalysisSchedule,
  type AnalysisScheduleInput,
  type AnalyzerPushReport,
  type AppliedSuggestion,
  type SuggestionPreview,
  type SuggestionResolution,
  analyzer,
} from "@/app/api/analyzer";
import { isApiError } from "@/app/api/errors";
import { type PlanningBatch, planning } from "@/app/api/planning";
import { attempt } from "@/app/api/reading";
import { sources } from "@/app/api/sources";
import { PLANNING_PATH } from "@/app/paths";
import { type TrackerOption, batchHref, trackerOptions } from "@/app/planning/generator";

import {
  APPLY_FAILED,
  DISMISS_FAILED,
  PREVIEW_FAILED,
  SPIKE_FAILED,
  TRACKERS_FAILED,
} from "./suggestions-view";
import { DRAFT_TICKETS_FAILED, PUSH_FAILED, TICK_FAILED } from "./tickets-view";
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

/* ------------------------------------------------------------------ suggestions (BW.3, #518) */

/** The service's code for an apply whose plan moved since its preview. */
const PREVIEW_STALE = "analysis_preview_stale";

/** The service's code for an action on a suggestion that is no longer open. */
const SUGGESTION_RESOLVED = "analysis_suggestion_resolved";

/** A uuid, as every suggestion and ticket-source id is. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A preview's fingerprint, as the service writes one. */
const FINGERPRINT = /^sha256:[0-9a-f]{64}$/;

/**
 * Whether a value is a uuid — what stands between a call from anywhere and the service's `422`.
 *
 * @param value What the caller passed.
 * @returns True for a uuid string.
 */
function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** How reading a consequence preview went. */
export type PreviewOutcome =
  | { readonly ok: true; readonly preview: SuggestionPreview }
  | { readonly ok: false; readonly reason: string };

/**
 * Read what applying a suggestion would change — no side effects, and every member's to read.
 *
 * @param id The suggestion.
 * @returns The preview, or why it could not be read.
 */
export async function previewSuggestion(id: string): Promise<PreviewOutcome> {
  if (!isUuid(id)) return { ok: false, reason: PREVIEW_FAILED };

  try {
    return { ok: true, preview: await analyzer.preview(id) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: `${PREVIEW_FAILED} ${error.message}` };
  }
}

/** How an apply went. */
export type ApplyOutcome =
  /** It was applied; the row is resolved and a measurement is open. */
  | { readonly kind: "applied"; readonly applied: AppliedSuggestion }
  /** The plan moved since the preview was read — nothing was applied; read the preview again. */
  | { readonly kind: "stale"; readonly reason: string }
  /** Somebody resolved it first — nothing was applied. */
  | { readonly kind: "resolved"; readonly reason: string }
  /** Refused for another reason, as a sentence — nothing was applied. */
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Apply a suggestion — **exactly the plan the preview showed**: the fingerprint is required, so an
 * apply can never execute something the person did not read.
 *
 * @param id The suggestion.
 * @param fingerprint The fingerprint of the preview that was confirmed.
 * @returns The outcome. Every refusal leaves the suggestion as it was.
 */
export async function applySuggestion(id: string, fingerprint: string): Promise<ApplyOutcome> {
  if (!isUuid(id) || typeof fingerprint !== "string" || !FINGERPRINT.test(fingerprint)) {
    return { kind: "refused", reason: APPLY_FAILED };
  }

  try {
    return { kind: "applied", applied: await analyzer.apply(id, fingerprint) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    if (error.code === PREVIEW_STALE) return { kind: "stale", reason: error.message };
    if (error.code === SUGGESTION_RESOLVED) return { kind: "resolved", reason: error.message };

    return { kind: "refused", reason: `${APPLY_FAILED} ${error.message}` };
  }
}

/** How a dismissal went. */
export type DismissOutcome =
  | { readonly ok: true; readonly resolution: SuggestionResolution }
  | {
      readonly ok: false;
      readonly reason: string;
      /** Whether it was refused because somebody resolved the suggestion first. */
      readonly resolved: boolean;
    };

/**
 * Dismiss a suggestion, for good.
 *
 * @param id The suggestion.
 * @param reason Why, or `null` — a dismissal needs no reason.
 * @returns The resolution, or why it was not dismissed.
 */
export async function dismissSuggestion(id: string, reason: string | null): Promise<DismissOutcome> {
  if (!isUuid(id) || (reason !== null && typeof reason !== "string")) {
    return { ok: false, reason: DISMISS_FAILED, resolved: false };
  }

  try {
    return { ok: true, resolution: await analyzer.dismiss(id, reason ?? undefined) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      reason: `${DISMISS_FAILED} ${error.message}`,
      resolved: error.code === SUGGESTION_RESOLVED,
    };
  }
}

/** The trackers a spike may be drafted for. */
export type DraftTargets =
  | { readonly ok: true; readonly options: readonly TrackerOption[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Read the trackers a spike may be drafted for — the planning page's own tracker segment
 * (`trackerOptions`), so a tracker that cannot be written to is disabled here with the same reason
 * it is there.
 *
 * @returns The options, or why the workspace's trackers could not be read.
 */
export async function readDraftTargets(): Promise<DraftTargets> {
  const [page, catalog] = await Promise.all([attempt(() => sources.list()), attempt(() => sources.catalog())]);

  if (!page.ok) return { ok: false, reason: `${TRACKERS_FAILED} ${page.reason}` };

  return { ok: true, options: trackerOptions(page.value.items, catalog) };
}

/** How a spike's draft went. */
export type DraftOutcome =
  | {
      readonly ok: true;
      /** The planning batch it was drafted into. */
      readonly batchId: string;
      /** Where that batch opens — the planning page's generator card. */
      readonly href: string;
      /** The drafted ticket's key in the batch — `BA-1`. */
      readonly localKey: string | null;
      /** The drafted ticket's title, as the service wrote it. */
      readonly title: string | null;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Draft one spike-flagged suggestion as an investigation ticket, in a planning batch of its own.
 * Nothing reaches a tracker: the batch is edited and pushed on the planning page.
 *
 * @param id The suggestion.
 * @param targetSourceId The ticket source the batch will push to.
 * @returns The batch it was drafted into, or why it was not.
 */
export async function draftSpike(id: string, targetSourceId: string): Promise<DraftOutcome> {
  if (!isUuid(id) || !isUuid(targetSourceId)) return { ok: false, reason: SPIKE_FAILED };

  try {
    const { batch } = await analyzer.draft([id], targetSourceId);
    const draft = batch.drafts[0];

    return {
      ok: true,
      batchId: batch.id,
      href: batchHref(PLANNING_PATH, batch.id),
      localKey: draft?.localKey ?? null,
      title: draft?.title ?? null,
    };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: `${SPIKE_FAILED} ${error.message}` };
  }
}

/* ------------------------------------------------------------------ drafted tickets (BW.4, #519) */

/** How drafting the ticket suggestions went. */
export type DraftTicketsOutcome =
  | {
      readonly ok: true;
      /** The planning batch they were drafted into — sizing is under way. */
      readonly batch: PlanningBatch;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Draft ticket suggestions into one planning batch, sized by the estimator. Nothing reaches a
 * tracker: the batch then stands on the card, where it is selected from, edited and pushed.
 *
 * @param ids The suggestions, in the order their drafts are keyed (`BA-1`, `BA-2`, …).
 * @param targetSourceId The ticket source the batch will push to — fixed once drafted.
 * @returns The batch, or why nothing was drafted.
 */
export async function draftTickets(
  ids: readonly string[],
  targetSourceId: string,
): Promise<DraftTicketsOutcome> {
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every(isUuid) || !isUuid(targetSourceId)) {
    return { ok: false, reason: DRAFT_TICKETS_FAILED };
  }

  try {
    const { batch } = await analyzer.draft(ids, targetSourceId);

    return { ok: true, batch };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: `${DRAFT_TICKETS_FAILED} ${error.message}` };
  }
}

/** How a tick went. */
export type SelectTicketOutcome =
  | {
      readonly ok: true;
      /** The batch as it now stands — its footer has moved with the selection. */
      readonly batch: PlanningBatch;
    }
  | { readonly ok: false; readonly reason: string };

/** A draft's key within its batch — `BA-3` — as the service's path parameter requires. */
const LOCAL_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Tick or untick one drafted ticket — the draft's stored `selected`, which is what a push files.
 * Nothing else about the draft can be changed through here: its title and body are edited on the
 * planning page.
 *
 * @param batchId The batch.
 * @param localKey The draft's key within it.
 * @param selected Whether a push should include it.
 * @returns The batch after the tick, or why it was not saved.
 */
export async function selectTicket(
  batchId: string,
  localKey: string,
  selected: boolean,
): Promise<SelectTicketOutcome> {
  if (!isUuid(batchId) || typeof localKey !== "string" || !LOCAL_KEY.test(localKey) || typeof selected !== "boolean") {
    return { ok: false, reason: TICK_FAILED };
  }

  try {
    return { ok: true, batch: await planning.patchDraft(batchId, localKey, { selected }) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: `${TICK_FAILED} ${error.message}` };
  }
}

/** How a push went. */
export type PushTicketsOutcome =
  | {
      readonly ok: true;
      /** What the push did — each selected draft's state, and how many landed this run. */
      readonly report: AnalyzerPushReport;
      /** The batch as it now stands, or `null` when that read failed — the poll will catch up. */
      readonly batch: PlanningBatch | null;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Push a drafted batch's **selected** drafts to its tracker. Idempotent: a draft already in the
 * tracker is not filed again, so pressing it after a failure files only what did not land.
 *
 * @param batchId The batch.
 * @returns What the push did and the batch after it, or why nothing was pushed.
 */
export async function pushTickets(batchId: string): Promise<PushTicketsOutcome> {
  if (!isUuid(batchId)) return { ok: false, reason: PUSH_FAILED };

  try {
    const report = await analyzer.push(batchId);
    const after = await attempt(() => planning.batch(batchId));

    return { ok: true, report, batch: after.ok ? after.value : null };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: `${PUSH_FAILED} ${error.message}` };
  }
}
