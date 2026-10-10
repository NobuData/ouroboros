/**
 * The investigation lifecycle's published shapes (CM.6,
 * [#625](https://github.com/NobuData/ouroboros/issues/625)) — one row of the investigations
 * card, the detail behind it, the list with its computed counts, and a progress reading.
 *
 * **One record, one mapping.** The card, History, the library and the detail are all built
 * from {@link InvestigationRecord} by the functions here, so a row cannot say one thing in the
 * list and another when opened.
 *
 * **The pill and the link are derived, never stored.** The pill is the status in the card's
 * words, except that a finished investigation whose fix ticket has a loop running reads
 * `fix loop live`. The link is the first of *run → roadmap → brief → evidence* the
 * investigation actually has, which is what makes the seeded rows read `open run →`,
 * `to roadmap →`, `brief ↑` and `evidence →`.
 */

import type {
  InvestigationActualsDocument,
  InvestigationDepth,
  InvestigationEstimateDocument,
  InvestigationFailureReason,
  InvestigationOrigin,
  InvestigationProvenanceDocument,
  InvestigationStatus,
  ResearchStartRole,
} from "../../db/schema";
import type { Page } from "../../tenancy/pagination";
import { DEPTH_PRESETS } from "../estimate.calibration";
import type { ScopeEstimateResource } from "../resources";
import type { Quarter } from "./quarter";

/** The statuses the card counts as **active**: everything that did not fail or get cancelled. */
export const ACTIVE_STATUSES = [
  "queued",
  "running",
  "brief_ready",
  "issues_filed",
] as const satisfies readonly InvestigationStatus[];

/** The statuses a run can still leave — the ones a progress stream stays open for. */
export const IN_FLIGHT_STATUSES = [
  "queued",
  "running",
] as const satisfies readonly InvestigationStatus[];

/**
 * Whether an investigation is still queued or running.
 *
 * @param status - Its status.
 * @returns True while it can still change.
 */
export function inFlight(status: InvestigationStatus): boolean {
  return (IN_FLIGHT_STATUSES as readonly InvestigationStatus[]).includes(status);
}

/** An investigation as the repository reads it — everything a row or a detail is built from. */
export interface InvestigationRecord {
  readonly id: string;
  /** `RS-127`. */
  readonly displayId: string;
  readonly kind: { readonly slug: string; readonly name: string; readonly tint: string };
  readonly question: string;
  readonly depth: InvestigationDepth;
  readonly tools: readonly string[];
  readonly status: InvestigationStatus;
  readonly origin: InvestigationOrigin;
  /** Who started it; null for a watch- or schedule-opened one, or once the person is deleted. */
  readonly startedBy: { readonly id: string; readonly name: string } | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly estimate: InvestigationEstimateDocument | null;
  readonly estimateCalibrationVersion: number | null;
  readonly actuals: InvestigationActualsDocument | null;
  readonly provenance: InvestigationProvenanceDocument | null;
  /** The ledger's row count, now. */
  readonly sources: number;
  /** What its model calls have cost so far; null when none of them is priced. */
  readonly spendCents: number | null;
  /** The newest brief, with the deliverables it references. */
  readonly brief: {
    readonly id: string;
    readonly version: number;
    readonly createdAt: Date;
    readonly deliverables: Readonly<Record<string, string>>;
  } | null;
  /** The capability matrix built for it, if any (found by investigation, CM.2). */
  readonly matrixId: string | null;
  /** The loop's state; null until a worker has claimed the investigation. */
  readonly loop: {
    /** The checkpoint's zero-based iteration; null before the first checkpoint. */
    readonly iteration: number | null;
    readonly cancelRequestedAt: Date | null;
    readonly failureReason: InvestigationFailureReason | null;
    readonly failureDetail: string | null;
    readonly updatedAt: Date;
  } | null;
  /** The test run behind the first ledger record that names one — `evidence →`. */
  readonly evidence: { readonly testRunId: string; readonly runId: string } | null;
  /** A live run on the ticket its fix draft was pushed as — `open run →`. */
  readonly fixRunId: string | null;
}

/** The tone of a status pill — the mockup's `.pill` modifiers. */
export type PillTone = "run" | "warn" | "ok" | "err" | "idle";

/** The card's status pill. */
export interface InvestigationPillResource {
  /** The status, or `fix_loop_live` / `cancelling` where the pill says more than the status. */
  readonly state: InvestigationStatus | "fix_loop_live" | "cancelling";
  /** The words, verbatim — `✓ brief ready`. */
  readonly label: string;
  readonly tone: PillTone;
  /** Whether the pill pulses: something is running now. */
  readonly live: boolean;
}

/** Where a row's contextual link goes. The UI owns the address; this names the target. */
export type InvestigationLinkResource =
  /** `open run →` — the live run fixing what the investigation found. */
  | { readonly kind: "run"; readonly label: string; readonly runId: string }
  /** `to roadmap →` — the roadmap document generated from the brief. */
  | { readonly kind: "roadmap"; readonly label: string; readonly roadmapDocId: string }
  /** `brief ↑` — the investigation's brief. */
  | {
      readonly kind: "brief";
      readonly label: string;
      readonly briefId: string;
      readonly version: number;
    }
  /** `evidence →` — the test run a ledger record measured. */
  | {
      readonly kind: "evidence";
      readonly label: string;
      readonly testRunId: string;
      readonly runId: string;
    };

/** Every link an investigation has, by kind; null where it has none. */
export interface InvestigationLinksResource {
  readonly run: Extract<InvestigationLinkResource, { kind: "run" }> | null;
  readonly roadmap: Extract<InvestigationLinkResource, { kind: "roadmap" }> | null;
  readonly brief: Extract<InvestigationLinkResource, { kind: "brief" }> | null;
  readonly evidence: Extract<InvestigationLinkResource, { kind: "evidence" }> | null;
}

/** One row of the investigations card, History and the library. */
export interface InvestigationResource {
  readonly id: string;
  /** `RS-127`. */
  readonly displayId: string;
  /** The kind chip: slug, label and hue key. */
  readonly kind: { readonly slug: string; readonly name: string; readonly tint: string };
  readonly question: string;
  readonly depth: InvestigationDepth;
  readonly tools: readonly string[];
  readonly origin: InvestigationOrigin;
  readonly status: InvestigationStatus;
  readonly pill: InvestigationPillResource;
  /** The ledger's row count — `44 sources`. Kept when a run is cancelled or fails. */
  readonly sources: number;
  /** The row's contextual link, or null when it has nowhere to go yet. */
  readonly link: InvestigationLinkResource | null;
  readonly startedBy: { readonly id: string; readonly name: string } | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A reading of a run's progress — one SSE `progress` event, and the detail's `progress`. */
export interface InvestigationProgressResource {
  readonly status: InvestigationStatus;
  /** The round being worked, from 1; null before the loop's first checkpoint. */
  readonly iteration: number | null;
  /** How many rounds the depth runs. */
  readonly iterations: number;
  /** The ledger's row count so far. */
  readonly sources: number;
  /** Model spend so far, in cents; null when no call so far is priced. */
  readonly spendCents: number | null;
  /** A cancel was asked for and the worker has not stopped yet. */
  readonly cancelRequested: boolean;
  /** When the run last wrote anything. */
  readonly updatedAt: string;
}

/** One deliverable an investigation produced. */
export interface InvestigationDeliverableResource {
  /** `brief`, `matrix`, `fix_draft`, `roadmap_doc`, `draft_batch`, … */
  readonly kind: string;
  /** The deliverable's id in its own table. */
  readonly id: string;
}

/** An investigation, opened. */
export interface InvestigationDetailResource extends InvestigationResource {
  /** The estimate it started under; null for one opened before estimates were stored. */
  readonly estimate: {
    readonly sources: { readonly min: number; readonly max: number };
    readonly costCents: { readonly min: number; readonly max: number } | null;
    readonly calibrationVersion: number | null;
  } | null;
  /** What it used, once it has finished. */
  readonly actuals: {
    readonly sourcesUsed: number;
    readonly spendCents: number | null;
    readonly durationMs: number;
  } | null;
  /** Which loop and alias ran it. */
  readonly provenance: {
    readonly researcher: string;
    readonly alias: string;
    readonly resolutionRef: string | null;
  } | null;
  readonly progress: InvestigationProgressResource;
  /** The newest brief; read it at `…/brief`. */
  readonly brief: {
    readonly id: string;
    readonly version: number;
    readonly createdAt: string;
  } | null;
  readonly deliverables: readonly InvestigationDeliverableResource[];
  /** The ledger in summary: how many records, and from which tools. */
  readonly ledger: {
    readonly total: number;
    readonly byTool: readonly { readonly tool: string; readonly count: number }[];
  };
  readonly links: InvestigationLinksResource;
  /** Why it failed; null unless `status` is `failed` and the loop recorded a reason. */
  readonly failure: {
    readonly reason: InvestigationFailureReason;
    readonly detail: string;
  } | null;
  /** Whether the caller may cancel it now: it is in flight, and they started it or administer. */
  readonly mayCancel: boolean;
}

/** `GET /research/investigations` — a page of rows under the card's two computed counts. */
export interface InvestigationListResource extends Page<InvestigationResource> {
  /** `4 active · 23 this quarter` — over the whole workspace, whatever the filters. */
  readonly counts: { readonly active: number; readonly thisQuarter: number };
  /** The quarter `thisQuarter` was counted over. */
  readonly quarter: { readonly key: string; readonly from: string; readonly to: string };
}

/** `POST /research/investigations` — what was started, and what it is expected to take. */
export interface StartedInvestigationResource {
  readonly investigation: InvestigationDetailResource;
  /** The estimate stored on it — `est. 40–60 sources · ~$6`. */
  readonly estimate: ScopeEstimateResource;
}

/** `POST …/cancel` — what the cancel left. */
export interface CancelledInvestigationResource {
  /** `cancelled` at once, or `cancelling` while the worker finishes its current operation. */
  readonly state: "cancelled" | "cancelling";
  /** The investigation as it now stands, its ledger kept. */
  readonly investigation: InvestigationDetailResource;
}

/** `GET/PATCH /research/settings`. */
export interface ResearchSettingsResource {
  /** The lowest role that may start an investigation. */
  readonly startRole: ResearchStartRole;
}

/** The pill of each status, when nothing more specific applies. */
const STATUS_PILLS: Readonly<
  Record<InvestigationStatus, Omit<InvestigationPillResource, "state">>
> = {
  queued: { label: "queued", tone: "warn", live: false },
  running: { label: "running", tone: "run", live: true },
  brief_ready: { label: "✓ brief ready", tone: "ok", live: false },
  issues_filed: { label: "✓ issues filed", tone: "ok", live: false },
  failed: { label: "failed", tone: "err", live: false },
  cancelled: { label: "cancelled", tone: "idle", live: false },
};

/**
 * The status pill of an investigation.
 *
 * @param record - The investigation.
 * @returns `fix loop live` for a finished one whose fix is being built, `cancelling` for a
 *   running one asked to stop, otherwise its status in the card's words.
 */
export function pillOf(record: InvestigationRecord): InvestigationPillResource {
  if (record.fixRunId !== null && !inFlight(record.status)) {
    return { state: "fix_loop_live", label: "fix loop live", tone: "run", live: true };
  }
  if (record.status === "running" && record.loop?.cancelRequestedAt != null) {
    return { state: "cancelling", label: "cancelling", tone: "warn", live: true };
  }

  return { state: record.status, ...STATUS_PILLS[record.status] };
}

/**
 * Every link an investigation has.
 *
 * @param record - The investigation.
 * @returns One entry per kind, null where the investigation has no such target.
 */
export function linksOf(record: InvestigationRecord): InvestigationLinksResource {
  const roadmap = record.brief?.deliverables.roadmap_doc;

  return {
    run:
      record.fixRunId === null
        ? null
        : { kind: "run", label: "open run →", runId: record.fixRunId },
    roadmap:
      roadmap === undefined
        ? null
        : { kind: "roadmap", label: "to roadmap →", roadmapDocId: roadmap },
    brief:
      record.brief === null
        ? null
        : {
            kind: "brief",
            label: "brief ↑",
            briefId: record.brief.id,
            version: record.brief.version,
          },
    evidence:
      record.evidence === null
        ? null
        : {
            kind: "evidence",
            label: "evidence →",
            testRunId: record.evidence.testRunId,
            runId: record.evidence.runId,
          },
  };
}

/**
 * The one link a row shows: the furthest thing the investigation led to.
 *
 * @param links - Its links.
 * @returns The live run, else the roadmap, else the brief, else the evidence, else null.
 */
export function primaryLink(links: InvestigationLinksResource): InvestigationLinkResource | null {
  return links.run ?? links.roadmap ?? links.brief ?? links.evidence;
}

/**
 * A row of the card.
 *
 * @param record - The investigation.
 * @returns The row.
 */
export function investigationResource(record: InvestigationRecord): InvestigationResource {
  return {
    id: record.id,
    displayId: record.displayId,
    kind: record.kind,
    question: record.question,
    depth: record.depth,
    tools: [...record.tools],
    origin: record.origin,
    status: record.status,
    pill: pillOf(record),
    sources: record.sources,
    link: primaryLink(linksOf(record)),
    startedBy: record.startedBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * A progress reading.
 *
 * @param record - The investigation, as just read.
 * @returns Status, round, ledger size and spend so far — the recorded actuals' spend once the
 *   run has ended, so a finished investigation's stream and its detail name one figure.
 */
export function progressResource(
  record: Pick<
    InvestigationRecord,
    "status" | "depth" | "sources" | "spendCents" | "actuals" | "loop" | "updatedAt"
  >,
): InvestigationProgressResource {
  const rounds = DEPTH_PRESETS[record.depth].rounds;
  const iteration = record.loop?.iteration ?? null;
  const written = Math.max(record.updatedAt.getTime(), record.loop?.updatedAt.getTime() ?? 0);

  return {
    status: record.status,
    // The checkpoint counts from zero and reads one past the last round while it synthesizes.
    iteration: iteration === null ? null : Math.min(Math.max(iteration, 0) + 1, rounds),
    iterations: rounds,
    sources: record.sources,
    // Once the run has ended its recorded actuals are the figure; until then, the usage so far.
    spendCents: record.actuals === null ? record.spendCents : record.actuals.spend_cents,
    cancelRequested: inFlight(record.status) && record.loop?.cancelRequestedAt != null,
    updatedAt: new Date(written).toISOString(),
  };
}

/**
 * The deliverables an investigation produced, the brief first.
 *
 * @param record - The investigation.
 * @returns One entry per deliverable that exists.
 */
export function deliverablesOf(record: InvestigationRecord): InvestigationDeliverableResource[] {
  if (record.brief === null) return [];

  const referenced = Object.entries(record.brief.deliverables)
    .filter(([kind]) => kind !== "matrix")
    .map(([kind, id]) => ({ kind, id }))
    .sort((a, b) => a.kind.localeCompare(b.kind));

  return [
    { kind: "brief", id: record.brief.id },
    ...(record.matrixId === null ? [] : [{ kind: "matrix", id: record.matrixId }]),
    ...referenced,
  ];
}

/** Who is asking, as far as an investigation's permissions go. */
export interface Viewer {
  readonly userId: string | null;
  /** Whether they hold `owner` or `admin`. */
  readonly administrator: boolean;
}

/**
 * Whether a viewer may cancel an investigation.
 *
 * @param record - The investigation.
 * @param viewer - Who is asking.
 * @returns True when they started it or administer the workspace. Says nothing about whether
 *   it can still be cancelled.
 */
export function mayCancel(record: Pick<InvestigationRecord, "startedBy">, viewer: Viewer): boolean {
  return viewer.administrator || (viewer.userId !== null && record.startedBy?.id === viewer.userId);
}

/**
 * An investigation, opened.
 *
 * @param record - The investigation.
 * @param byTool - Its ledger, counted per tool.
 * @param viewer - Who is asking, for `mayCancel`.
 * @returns The detail.
 */
export function investigationDetailResource(
  record: InvestigationRecord,
  byTool: readonly { readonly tool: string; readonly count: number }[],
  viewer: Viewer,
): InvestigationDetailResource {
  const failure = record.loop;

  return {
    ...investigationResource(record),
    estimate:
      record.estimate === null
        ? null
        : {
            sources: record.estimate.sources,
            costCents: record.estimate.cost_cents,
            calibrationVersion: record.estimateCalibrationVersion,
          },
    actuals:
      record.actuals === null
        ? null
        : {
            sourcesUsed: record.actuals.sources_used,
            spendCents: record.actuals.spend_cents,
            durationMs: record.actuals.duration_ms,
          },
    provenance:
      record.provenance === null
        ? null
        : {
            researcher: record.provenance.researcher,
            alias: record.provenance.alias,
            resolutionRef: record.provenance.resolution_ref,
          },
    progress: progressResource(record),
    brief:
      record.brief === null
        ? null
        : {
            id: record.brief.id,
            version: record.brief.version,
            createdAt: record.brief.createdAt.toISOString(),
          },
    deliverables: deliverablesOf(record),
    ledger: { total: record.sources, byTool: byTool.map((entry) => ({ ...entry })) },
    links: linksOf(record),
    failure:
      record.status === "failed" && failure?.failureReason != null && failure.failureDetail !== null
        ? { reason: failure.failureReason, detail: failure.failureDetail }
        : null,
    mayCancel: inFlight(record.status) && mayCancel(record, viewer),
  };
}

/**
 * The quarter a count was taken over, published.
 *
 * @param quarter - The quarter.
 * @returns Its key and bounds as ISO strings.
 */
export function quarterResource(quarter: Quarter): InvestigationListResource["quarter"] {
  return { key: quarter.key, from: quarter.from.toISOString(), to: quarter.to.toISOString() };
}
