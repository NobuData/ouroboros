/**
 * What *Run my first loop* answers — the receipt — and the *What Happens Next* projection
 * ([#388](https://github.com/NobuData/ouroboros/issues/388), BB.5, decisions **O7**, **O8**).
 *
 * ```
 * POST /api/v1/onboarding/launch  → LaunchReceiptResource
 * ```
 *
 * The receipt states **what actually happened**: the issue was queued, at this position, under
 * this workflow version, with dry-run in this state. Nothing in it claims a loop ran — autonomous
 * execution (AR.1, #315) does not exist yet, so `run` is a slot that stays `null` until a run of
 * the issue does (BD.1, #396, fills it live).
 *
 * The timeline it carries is `launch.timeline.ts`' projection, labelled as one on every row.
 *
 * Pure: every function here is facts in, payload out.
 */

import type { QueueItemSummary } from "../dashboard/resources";
import type { QueueWorkflowPinReason } from "../db/schema";
import { POLICIES_PATH } from "./defaults.resources";
import { projectTimeline, type TimelineFacts, type TimelineResource } from "./launch.timeline";
import type { OnboardingResource } from "./resources";
import { studioPath } from "./templates.resources";

/** The dashboard (mockup 02). Mirrors the UI route. */
export const DASHBOARD_PATH = "/dashboard";

/** The dashboard's *Up next in queue* card. Mirrors the UI's `DASHBOARD_QUEUE_HASH`. */
export const DASHBOARD_QUEUE_PATH = `${DASHBOARD_PATH}#dash-up-next-title`;

/** The run console's root (mockup 10). Mirrors the UI's `RUNS_PATH`. */
export const RUNS_PATH = "/runs";

/** What the launch did. */
export type LaunchOutcome = "queued" | "already_queued" | "already_started";

/** The workflow the issue is pinned to. */
export interface LaunchWorkflowResource {
  readonly slug: string;
  /** The pinned published version; null only for a row written before pins existed, or a run. */
  readonly version: number | null;
  /** Which rule chose it — `explicit` for a launch; null when read off a run. */
  readonly pinReason: QueueWorkflowPinReason | null;
  /** The workflow in the Studio. */
  readonly path: string;
}

/** Dry-run, as confirmed at launch. */
export interface LaunchDryRunResource {
  /** Whether the dry-run policy is active now, read from the database after completion. */
  readonly active: boolean;
  /** The policy's designed reason while active, else null. */
  readonly reason: string | null;
  /** What that means for this loop, in a sentence the receipt prints. */
  readonly note: string;
  /** Settings → Policies. */
  readonly path: string;
}

/** A run of the issue — the live reference. */
export interface LaunchRunResource {
  readonly id: string;
  /** The run console. */
  readonly path: string;
}

/** `POST /api/v1/onboarding/launch`. */
export interface LaunchReceiptResource {
  /** `acme-robotics/helios-firmware`, lower-case. */
  readonly repo: string;
  /**
   * `queued` — this request wrote the queue item. `already_queued` — the queue already held the
   * issue; nothing was written twice. `already_started` — a run of the issue exists.
   */
  readonly outcome: LaunchOutcome;
  readonly issue: { readonly id: string; readonly number: number; readonly title: string };
  /** The queue item — the dashboard queue's own shape — or null once a run has claimed it. */
  readonly queue: QueueItemSummary | null;
  readonly workflow: LaunchWorkflowResource;
  readonly dryRun: LaunchDryRunResource;
  /** When the wizard was completed. */
  readonly completedAt: string | null;
  readonly links: {
    readonly dashboard: string;
    /** The dashboard's queue card. */
    readonly queue: string;
    /** The run console, once there is a run to open; null until then. */
    readonly console: string | null;
  };
  /** The live run reference — null until a run of the issue exists (BD.1, #396). */
  readonly run: LaunchRunResource | null;
  readonly timeline: TimelineResource;
  /** The wizard after the launch — every step done, derived. */
  readonly onboarding: OnboardingResource;
}

/** The dry-run notes — one sentence per state. */
export const DRY_RUN_NOTES = {
  active: "Dry-run is on: this loop opens a draft pull request and never merges.",
  off: "Dry-run is off for this workspace: this loop is not draft-only, and its workflow's final step may merge.",
} as const;

/**
 * Dry-run as the receipt states it.
 *
 * @param policy - The policy, read after completion.
 * @returns The confirmation — `active: false` says so in words rather than implying draft-only.
 */
export function launchDryRun(policy: {
  readonly dryRun: boolean;
  readonly reason: string | null;
}): LaunchDryRunResource {
  return {
    active: policy.dryRun,
    reason: policy.reason,
    note: policy.dryRun ? DRY_RUN_NOTES.active : DRY_RUN_NOTES.off,
    path: POLICIES_PATH,
  };
}

/**
 * The run console for a run.
 *
 * @param runId - `runs.id`.
 * @returns `/runs/<id>`.
 */
export function runConsolePath(runId: string): string {
  return `${RUNS_PATH}/${encodeURIComponent(runId)}`;
}

/** Everything a receipt is assembled from. */
export interface LaunchReceiptParts {
  readonly outcome: LaunchOutcome;
  readonly issue: { readonly id: string; readonly number: number; readonly title: string };
  readonly queue: QueueItemSummary | null;
  /** The workflow slug, version and pin reason actually in force for the issue. */
  readonly workflow: Omit<LaunchWorkflowResource, "path">;
  readonly policy: { readonly dryRun: boolean; readonly reason: string | null };
  readonly runId: string | null;
  readonly cycle: TimelineFacts["cycle"];
  readonly onboarding: OnboardingResource;
}

/**
 * The receipt.
 *
 * @param parts - What happened, and the wizard afterwards.
 * @returns The resource.
 */
export function launchReceipt(parts: LaunchReceiptParts): LaunchReceiptResource {
  const run = parts.runId === null ? null : { id: parts.runId, path: runConsolePath(parts.runId) };

  return {
    repo: parts.onboarding.repo,
    outcome: parts.outcome,
    issue: parts.issue,
    queue: parts.queue,
    workflow: { ...parts.workflow, path: studioPath(parts.workflow.slug) },
    dryRun: launchDryRun(parts.policy),
    completedAt: parts.onboarding.choices.completedAt,
    links: {
      dashboard: DASHBOARD_PATH,
      queue: DASHBOARD_QUEUE_PATH,
      console: run?.path ?? null,
    },
    run,
    timeline: projectTimeline({
      issueKey: `#${String(parts.issue.number)}`,
      cycle: parts.cycle,
      dryRun: parts.policy.dryRun,
    }),
    onboarding: parts.onboarding,
  };
}
