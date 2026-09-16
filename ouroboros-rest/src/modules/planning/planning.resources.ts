/**
 * What the planning API answers — AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)).
 *
 * Every shape here is something mockup 09 renders: the generator card's draft rows and footer, the
 * push progress, and the Roadmap card's lanes. `openapi.yaml` describes the same shapes; the
 * OpenAPI suite holds the two together.
 */

import type {
  DraftBatchStatus,
  DraftProvenance,
  DraftPushError,
  DraftPushState,
  EpicStatus,
  EpicTint,
} from "../db/schema";
import type { Effort } from "../engine/engine.contract";
import type { PushReport } from "./push.service";

/** One draft's estimate in force — the row's effort chip and the footer's inputs. */
export interface DraftEstimateResource {
  /** `xs` … `xl`. */
  readonly effort: Effort;
  /** 0–100. */
  readonly confidence: number;
  /** The single planning number, minutes. */
  readonly estMinutes: number;
  /** Tokens the work is expected to cost. */
  readonly estTokens: number;
  /** Which model the work is routed to. */
  readonly routedModel: string;
  /** What produced the estimate — the card's `estimator` tag renders this, never a constant. */
  readonly estimator: string;
  /** Which version of the draft's estimate this is. */
  readonly version: number;
}

/** One draft row. */
export interface DraftResource {
  /** `ticket_drafts.id`. */
  readonly id: string;
  /** `OTA-3`. */
  readonly localKey: string;
  readonly title: string;
  readonly body: string | null;
  /** The checkbox. */
  readonly selected: boolean;
  /** The workflow tag chip, or null. */
  readonly suggestedWorkflow: string | null;
  /** `planned`, or `edited` once a person has changed the title or body. */
  readonly provenance: DraftProvenance;
  /** The local keys of the drafts this one is blocked by, in key order. */
  readonly dependencies: readonly string[];
  /** Canonical tickets this one is blocked by — a pushed blocker, rewritten by AL.3. */
  readonly blockedByTicketIds: readonly string[];
  /** `pending`, `pushed` or `failed`. */
  readonly pushState: DraftPushState;
  /** The canonical ticket, once pushed. */
  readonly pushedTicketId: string | null;
  /** Why the push failed, when it did. */
  readonly pushError: DraftPushError | null;
  /** The estimate in force, or null while unsized. */
  readonly estimate: DraftEstimateResource | null;
}

/** The footer's `$ est. spend` — present **only** when some rate prices the batch (decision N10). */
export interface BatchSpendResource {
  /** Estimated cents, rounded to a whole cent. */
  readonly cents: number;
  /** `$14`. */
  readonly display: string;
  /** True when some sized draft routes to a model nobody priced — the figure is a lower bound. */
  readonly partial: boolean;
}

/** The generator card's footer and sizing pill. */
export interface BatchSummaryResource {
  /** Every draft in the batch. */
  readonly draftCount: number;
  /** The drafts a push would include. */
  readonly selectedCount: number;
  /** Selected drafts with an estimate. */
  readonly sizedCount: number;
  /** `✓ all sized` — every selected draft has an estimate, and there is at least one. */
  readonly allSized: boolean;
  /** The estimators that sized the selected drafts, distinct and sorted. */
  readonly estimators: readonly string[];
  /** Summed `est_minutes` of the selected, sized drafts. */
  readonly estMinutes: number;
  /** `~3.1 days of loop time` — {@link estMinutes} over 24 hours, one decimal. */
  readonly loopDays: number;
  /** The spend, or **absent** when nothing is priced — never `$0` for *unknown*. */
  readonly spend?: BatchSpendResource;
}

/** A batch, with its drafts and footer. */
export interface BatchResource {
  readonly id: string;
  readonly status: DraftBatchStatus;
  /** Which planner produced the drafts — `outline-v0`. */
  readonly planner: string;
  readonly prompt: string;
  readonly outline: string | null;
  readonly targetSourceId: string;
  readonly milestone: string | null;
  readonly epicId: string | null;
  readonly autoSize: boolean;
  readonly queueSmall: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The drafts, in local-key order. */
  readonly drafts: readonly DraftResource[];
  readonly summary: BatchSummaryResource;
}

/** What a generation or regeneration answers — the batch, and the planner's guidance. */
export interface GeneratedBatchResource extends BatchResource {
  /** The planner's `notes`, rendered as guidance — not stored, so only a generation carries them. */
  readonly notes: readonly string[];
}

/** One draft's push progress. */
export interface PushStatusDraftResource {
  readonly localKey: string;
  readonly selected: boolean;
  readonly pushState: DraftPushState;
  readonly pushedTicketId: string | null;
  readonly pushError: DraftPushError | null;
}

/** `GET /:batch/push-status`. */
export interface PushStatusResource {
  readonly batchId: string;
  readonly status: DraftBatchStatus;
  /** Whether this process is pushing the batch right now. */
  readonly pushing: boolean;
  readonly drafts: readonly PushStatusDraftResource[];
}

/** Why a pushed small ticket was not queued. */
export type QueueSmallSkipReason =
  /** The backlog sync has not mirrored the issue yet. */
  | "not_yet_mirrored"
  /** The mirrored issue has not been sized yet — M.3's sized-only rule. */
  | "not_sized"
  /** The queue already holds it. */
  | "already_queued";

/** What the `queue_small` hook did (decision N7). */
export interface QueueSmallResource {
  /** The local keys queued through INTAKE-M.3. */
  readonly queued: readonly string[];
  /** The XS/S drafts that were not, and why. */
  readonly skipped: readonly { readonly localKey: string; readonly reason: QueueSmallSkipReason }[];
}

/** `POST /:batch/push` and `/push/resume`. */
export interface PushResultResource {
  /** AL.3's report. */
  readonly report: PushReport;
  /** The queue-small hook's outcome, or null when the batch's toggle is off. */
  readonly queueSmall: QueueSmallResource | null;
}

/** One roadmap lane. */
export interface EpicResource {
  readonly id: string;
  readonly name: string;
  readonly tint: EpicTint;
  readonly status: EpicStatus;
  /** `2026-07`, or null for an unscoped lane. */
  readonly startMonth: string | null;
  /** `2026-09`, or null. */
  readonly endMonth: string | null;
  /** Lane order, top first. */
  readonly sortOrder: number;
  readonly roadmapName: string | null;
  readonly roadmapWindow: string | null;
  /** `12 issues · 8 done` — **computed** from linked ticket states on every read (AK.3). */
  readonly chips: { readonly issues: number; readonly done: number };
}

/** `GET /planning/roadmap`. */
export interface RoadmapResource {
  /** The roadmap head — the first lane's `roadmap_name`, or null. */
  readonly name: string | null;
  /** Its window tag, or null. */
  readonly window: string | null;
  readonly lanes: readonly EpicResource[];
}

/** One milestone a batch may be filed under. */
export interface MilestoneResource {
  /** The tracker's handle. */
  readonly externalRef: string;
  readonly name: string;
}

/** `GET /planning/sources/:source/milestones`. */
export interface MilestonesResource {
  readonly sourceId: string;
  /** False when the source's tracker has no milestones — the selector renders disabled. */
  readonly supported: boolean;
  readonly milestones: readonly MilestoneResource[];
}
