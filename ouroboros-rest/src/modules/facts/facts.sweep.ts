/**
 * The staleness sweep — what makes *"Facts expire when the code that taught them changes"* an
 * automatic behaviour (BF.2, [#411](https://github.com/NobuData/ouroboros/issues/411); decision
 * **K4**).
 *
 * | trigger     | what it reads                                                               |
 * |-------------|-----------------------------------------------------------------------------|
 * | sync-driven | one PR the source sync just observed `merged` ({@link FactSweepService.mergeObserved}) |
 * | nightly     | every merged PR of an enabled GitHub repository since each anchor was last  |
 * |             | checked ({@link FactSweepService.sweepWorkspace}) — what catches a merge the |
 * |             | sync hook never saw                                                          |
 *
 * **A match flags, it never expires.** An anchor matching means *something changed near this
 * fact*, not *this fact is now false*: a confirmed fact moves to `stale` with nobody behind it
 * (V071 lets only `stale` be actor-less) and the matched anchor written as the reason — *"
 * platform_version anchor zephyr-4.0 matched: removed "revision: v4.0.0" in west.yml (PR #531)"*
 * — and it joins the needs-you feed for a person to re-confirm or expire.
 *
 * **Which changes count.** A change is considered for a fact's anchor only if it merged after
 * both the fact's confirmation and the anchor's `last_checked_at`: a fact confirmed after a change
 * already knew about it, and a re-confirmed fact is not flagged again by the change that flagged
 * it. A repository-scoped fact is matched against its own repository's PRs; a workspace-wide fact
 * against every repository's. Only the nightly pass stamps `last_checked_at` — the sync hook sees
 * one PR, and stamping there would hide earlier merges the hook never saw from the next night.
 *
 * **Anchor-less facts are never swept**, and the report counts them (`uncovered`) rather than
 * implying a coverage the sweep does not have; each fact's resource says `sweep.covered: false`.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";

import { describeForLog } from "../errors/failure";
import { FactReviewEmitter } from "./fact-review.emitter";
import { matchAnchor, type AnchorMatch } from "./facts.anchors";
import { STATUS_REASON_MAX_LENGTH } from "./facts.dto";
import type { FactCommitObserver } from "./facts.observer";
import {
  FactsRepository,
  SWEEP_CHANGE_LIMIT,
  type MergedChange,
  type SweepAnchor,
} from "./facts.repository";

/** One fact the sweep flagged. */
export interface StaleFlag {
  readonly factId: string;
  readonly anchorId: string;
  readonly prId: string;
  readonly prNumber: number;
  /** The reason written beside `stale`. */
  readonly reason: string;
}

/** What one pass over one workspace did. */
export interface SweepReport {
  readonly organizationId: string;
  /** Merged PRs read. */
  readonly changes: number;
  /** Anchors evaluated. */
  readonly anchors: number;
  /** Facts moved `confirmed → stale` by this pass. */
  readonly flagged: readonly StaleFlag[];
  /** Confirmed facts with no anchors — never swept. */
  readonly uncovered: number;
}

/**
 * The instant after which a change counts for an anchor — the later of its fact's confirmation
 * and its last check.
 *
 * @param anchor - The anchor.
 * @returns The instant (exclusive).
 */
export function anchorSince(anchor: SweepAnchor): Date {
  const checked = anchor.lastCheckedAt;

  return checked !== null && checked > anchor.confirmedAt ? checked : anchor.confirmedAt;
}

/**
 * Whether a change is in a fact's repository.
 *
 * @param factRepo - The fact's `owner/name`, or null for the whole workspace.
 * @param changeRepo - The change's `owner/name`, or null when its source names none.
 * @returns `true` when the change counts for the fact.
 */
export function sameRepository(factRepo: string | null, changeRepo: string | null): boolean {
  return (
    factRepo === null ||
    (changeRepo !== null && factRepo.toLowerCase() === changeRepo.toLowerCase())
  );
}

/**
 * The reason written beside `stale`, bounded to V071's `status_reason` length.
 *
 * @param anchor - The anchor that matched.
 * @param match - What it matched.
 * @param change - The PR.
 * @returns The reason.
 */
export function staleReason(
  anchor: Pick<SweepAnchor, "kind" | "value">,
  match: AnchorMatch,
  change: Pick<MergedChange, "number">,
): string {
  const reason = `${anchor.kind} anchor ${anchor.value} matched: ${match.evidence} (PR #${String(change.number)})`;

  return reason.length <= STATUS_REASON_MAX_LENGTH
    ? reason
    : `${reason.slice(0, STATUS_REASON_MAX_LENGTH - 1)}…`;
}

/**
 * Decide which facts a set of changes flags — pure, so every rule above is a unit test.
 *
 * Each fact is flagged at most once, by its earliest matching change and, within that change, its
 * first matching anchor.
 *
 * @param anchors - Confirmed facts' anchors.
 * @param changes - Merged PRs, oldest merge first.
 * @returns The flags, in fact order.
 */
export function staleFlags(
  anchors: readonly SweepAnchor[],
  changes: readonly MergedChange[],
): StaleFlag[] {
  const byFact = new Map<string, SweepAnchor[]>();

  for (const anchor of anchors) {
    byFact.set(anchor.factId, [...(byFact.get(anchor.factId) ?? []), anchor]);
  }

  const flags: StaleFlag[] = [];

  for (const [factId, factAnchors] of byFact) {
    const hit = firstHit(factAnchors, changes);

    if (hit !== undefined) {
      flags.push({
        factId,
        anchorId: hit.anchor.anchorId,
        prId: hit.change.prId,
        prNumber: hit.change.number,
        reason: staleReason(hit.anchor, hit.match, hit.change),
      });
    }
  }

  return flags;
}

/**
 * @param anchors - One fact's anchors.
 * @param changes - Merged PRs, oldest first.
 * @returns The earliest change that fires one of them, or undefined.
 */
function firstHit(
  anchors: readonly SweepAnchor[],
  changes: readonly MergedChange[],
): { anchor: SweepAnchor; change: MergedChange; match: AnchorMatch } | undefined {
  for (const change of changes) {
    for (const anchor of anchors) {
      if (
        !sameRepository(anchor.repoRef, change.repoRef) ||
        change.mergedAt <= anchorSince(anchor)
      ) {
        continue;
      }

      const match = matchAnchor(anchor, change);

      if (match !== null) {
        return { anchor, change, match };
      }
    }
  }

  return undefined;
}

@Injectable()
export class FactSweepService implements FactCommitObserver {
  /** Where a pass that flagged something is reported. */
  private readonly logger = new Logger(FactSweepService.name);

  /**
   * @param repo - The statements.
   * @param reviews - The Needs-You emitter (#461): a fact flagged stale files a `fact_review`
   *   card. Absent in a context without the inbox.
   */
  constructor(
    private readonly repo: FactsRepository,
    @Optional() private readonly reviews?: FactReviewEmitter,
  ) {}

  /**
   * The sync-driven trigger: one PR was just observed merged.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   */
  async mergeObserved(organizationId: string, prId: string): Promise<void> {
    const report = await this.run(organizationId, { prId }, null);

    this.announce(report, `PR ${prId}`);
  }

  /**
   * The nightly pass over one workspace: every merged PR of its enabled GitHub repositories since
   * the earliest anchor was last checked, then every evaluated anchor stamped.
   *
   * @param organizationId - The workspace.
   * @param at - The pass's instant — what `last_checked_at` becomes.
   * @returns What the pass did.
   */
  async sweepWorkspace(organizationId: string, at: Date = new Date()): Promise<SweepReport> {
    return this.run(organizationId, { enabledOnly: true }, at);
  }

  /**
   * The nightly pass over every workspace with a confirmed, anchored fact. A workspace that fails
   * is logged and skipped; the others still run.
   *
   * @param at - The pass's instant.
   * @returns One report per workspace that completed.
   */
  async sweepAll(at: Date = new Date()): Promise<SweepReport[]> {
    const reports: SweepReport[] = [];

    for (const organizationId of await this.repo.sweepWorkspaces()) {
      try {
        const report = await this.sweepWorkspace(organizationId, at);

        this.announce(report, "nightly");
        reports.push(report);
      } catch (error) {
        this.logger.error(
          `Fact staleness sweep failed for workspace ${organizationId}; retrying next night.`,
          describeForLog(error),
        );
      }
    }

    return reports;
  }

  /**
   * One pass.
   *
   * @param organizationId - The workspace.
   * @param scope - One PR, or the nightly window.
   * @param stampAt - The nightly pass's instant, or null for the sync hook (which stamps nothing).
   * @returns The report.
   */
  private async run(
    organizationId: string,
    scope: { readonly prId?: string; readonly enabledOnly?: boolean },
    stampAt: Date | null,
  ): Promise<SweepReport> {
    const [anchors, uncovered] = await Promise.all([
      this.repo.sweepAnchors(organizationId),
      this.repo.uncoveredCount(organizationId),
    ]);

    if (anchors.length === 0) {
      return { organizationId, changes: 0, anchors: 0, flagged: [], uncovered };
    }

    const since =
      scope.prId === undefined
        ? new Date(Math.min(...anchors.map((anchor) => anchorSince(anchor).getTime())))
        : undefined;
    const changes = await this.repo.mergedChanges(organizationId, { ...scope, since });
    const flagged: StaleFlag[] = [];

    for (const flag of staleFlags(anchors, changes)) {
      if (await this.repo.flagStale(flag.factId, flag.reason)) {
        flagged.push(flag);
      }
    }

    // A fact flagged stale waits on a person: file its inbox card (#461). Never throws.
    await this.reviews?.review(
      organizationId,
      flagged.map((flag) => flag.factId),
    );

    if (stampAt !== null) {
      // A window cut at the limit is only checked up to its last merge; the next night goes on.
      const last = changes.at(-1);
      const checkedTo =
        changes.length >= SWEEP_CHANGE_LIMIT && last !== undefined ? last.mergedAt : stampAt;

      await this.repo.stampChecked(
        anchors.map((anchor) => anchor.anchorId),
        checkedTo,
      );
    }

    return { organizationId, changes: changes.length, anchors: anchors.length, flagged, uncovered };
  }

  /**
   * Say what a pass flagged, when it flagged anything.
   *
   * @param report - The pass.
   * @param trigger - What ran it.
   */
  private announce(report: SweepReport, trigger: string): void {
    if (report.flagged.length === 0) {
      return;
    }

    this.logger.log(
      `Fact staleness sweep (${trigger}): ${String(report.flagged.length)} fact(s) flagged stale ` +
        `in workspace ${report.organizationId} from ${String(report.changes)} merged PR(s).`,
    );
  }
}
