/**
 * The workflow statistics service — *"computed truth, not a stored string"* (P.4,
 * [#135](https://github.com/NobuData/ouroboros/issues/135)).
 *
 * One method, {@link WorkflowStatsService.forWorkspace}, and what it answers is mockup 04's
 * rail and page head at once: a stage count and a terminal behaviour per workflow, the share
 * of the workspace's runs each one accounts for, and the captions those compose into.
 *
 * ```
 * definition in force ─▶ nodes.count · term actions ─▶ "6 stages · auto-merge"
 * runs (30d window)   ─▶ slug share                 ─▶ "used by 61% of runs"
 *                     └▶ no runs at all             ─▶ "no runs yet"   (never a fake %)
 * workflows.status    ─▶ paused                     ─▶ "5 stages · paused" + the err-dot
 * ```
 *
 * ---------------------------------------------------------------------------
 * ## Two statements, issued together, measured from one instant
 *
 * The registry read and the run counts are independent questions about different tables, so
 * they go out concurrently — `estimation.context.ts`' `Promise.all`, for its reason: it keeps
 * building the payload one round trip deep rather than two.
 *
 * The window boundary is computed **once**, from a `now` the caller may supply, and handed to
 * the statement as a parameter. That is `windows.ts`' rule and its whole argument: an instant
 * computed twice a few milliseconds apart puts a run that started on the boundary inside one
 * number and outside the next. Here there is one number it could fall on either side of, and
 * one instant it is compared against.
 *
 * ## The stage count and the caption cannot drift, because neither is written anywhere
 *
 * *"Stage counts and terminal captions change when the definition changes, with no separate
 * write"* is the ticket's third criterion, and it holds structurally rather than by a rule
 * somebody keeps: there is no column to update. The statement reads
 * `workflow_versions.definition` through `workflows.current_version` on every request, so
 * publishing a version with a stage more is the only write there is.
 *
 * ## What this service does *not* do
 *
 * It does not route. `GET /api/v1/workflows` is P.3's
 * ([#134](https://github.com/NobuData/ouroboros/issues/134)) — the rail payload, the create,
 * the draft save and the publish — and this is the provider that ticket's handler composes
 * its entries from, exactly as `PricingModule` and `RoutingModule` export a service rather
 * than a second answer to a question a surface already asks. There is one derivation of *how
 * many stages does this workflow have*, and everything that needs it imports this module.
 */

import { Injectable } from "@nestjs/common";

import { WorkflowStatsRepository } from "./stats.repository";
import { workflowStats, type WorkflowStats } from "./stats.resources";

/**
 * How many days back *used by N% of runs* looks.
 *
 * Thirty, as the issue specifies. A rolling duration subtracted from the request instant
 * rather than a calendar month — `windows.ts`' distinction: "the last thirty days" needs no
 * timezone to be well defined and is immune to what a clock did in the middle of it.
 */
export const USAGE_WINDOW_DAYS = 30;

/** Milliseconds in a day. A duration, not a calendar day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The start of the usage window.
 *
 * Exported so that a caller which renders the window in prose — *"over the last 30 days"* —
 * and the statement that measures it cannot disagree about which instant is meant.
 *
 * @param now - The request instant.
 * @returns {@link USAGE_WINDOW_DAYS} days before it.
 */
export function usageWindowStart(now: Date): Date {
  return new Date(now.getTime() - USAGE_WINDOW_DAYS * DAY_MS);
}

@Injectable()
export class WorkflowStatsService {
  /**
   * @param repository - The three statements, all org-scoped.
   */
  constructor(private readonly repository: WorkflowStatsRepository) {}

  /**
   * Every workflow on one workspace's rail, with its statistics.
   *
   * @param organizationId - The workspace, from the tenant context. Both statements filter on
   *   it, so the counts are this workspace's runs and nobody else's — the ticket's cross-org
   *   criterion, asserted in `workflows.integration-spec.ts` against two workspaces holding
   *   the same slugs.
   * @param now - The request instant, from which the 30-day window is measured. Passed in
   *   rather than read from the clock so a test can state the moment it is asking about, and
   *   so every number in one answer is measured from the same one.
   * @returns One entry per non-archived workflow, in the rail's order. Empty for a workspace
   *   with no workflows, which is the studio's empty state rather than an error.
   */
  async forWorkspace(organizationId: string, now: Date = new Date()): Promise<WorkflowStats[]> {
    const [entries, shares] = await Promise.all([
      this.repository.registryEntries(organizationId),
      this.repository.runShares(organizationId, usageWindowStart(now)),
    ]);

    // The denominator is every run in the window, whatever tag it carried — including tags
    // that resolve to no workflow, because a run performed under a since-renamed workflow is
    // still a run this workspace performed. Summed from the same rows the numerators come
    // from, so the share of a workspace's runs can never exceed 100%.
    const totalRuns = shares.reduce((total, share) => total + share.runs, 0);
    const bySlug = new Map(shares.map((share) => [share.workflow_tag, share.runs]));

    return entries.map((entry) => workflowStats(entry, bySlug.get(entry.slug) ?? 0, totalRuns));
  }
}
