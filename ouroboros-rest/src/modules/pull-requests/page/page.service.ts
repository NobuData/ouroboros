/**
 * `PageService` — the PR page's reads: the listing for navigation and inbox surfaces, and the whole
 * page payload in one call (AX.5, [#361](https://github.com/NobuData/ouroboros/issues/361)).
 *
 * ```
 * GET /api/v1/pull-requests          ─▶ Page<summary>          (?state=…, ?reviewRequested=true)
 * GET /api/v1/pull-requests/:id      ─▶ { pullRequest, revisions[+snapshots], gates, criteria,
 *                                          files, thread, plan, spend, review, loopReturn }
 * ```
 *
 * **Composed, not re-derived.** The criteria matrix is `CriteriaService.matrix` (#359) and the merge
 * plan is `MergeExecutorService.plan` (#360) — the same answers their own routes give. Gate
 * snapshots are V056's `pr_gate_results_latest` and `pr_gate_aggregate`, the spend is
 * `readSpendTotals` (V8). This service joins; it computes nothing a card could get differently
 * elsewhere.
 *
 * **404, not 403.** A PR of another workspace is `pull_request_not_found`, like an absent one.
 */

import { Inject, Injectable } from "@nestjs/common";

import { pageOf, windowOf } from "../../tenancy/pagination";
import { CriteriaService } from "../criteria/criteria.service";
import { pullRequestNotFound } from "../criteria/criteria.errors";
import { MergeExecutorService } from "../merge/merge.executor";
import type { CriteriaMatrixResource } from "../criteria/criteria.resources";
import type { MergePlanResource } from "../merge/merge.resources";
import type { ListPullRequestsQuery } from "./page.dto";
import { PageRepository, type PageStore } from "./page.repository";
import {
  citedTestRunId,
  filesResource,
  headResource,
  loopReturnResource,
  reviewResource,
  stripResources,
  summaryResource,
  threadResource,
  type PullRequestListResource,
  type PullRequestPageResource,
} from "./page.resources";
import { spendRollup } from "./page.spend";

/** The criteria matrix, as the page reads it — `CriteriaService.matrix`. */
export interface PageCriteria {
  /**
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @returns The matrix.
   */
  matrix(organizationId: string, prId: string): Promise<CriteriaMatrixResource>;
}

/** The merge plan, as the page reads it — `MergeExecutorService.plan`. */
export interface PagePlan {
  /**
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @returns The plan.
   */
  plan(organizationId: string, prId: string): Promise<MergePlanResource>;
}

@Injectable()
export class PageService {
  /**
   * @param store - The page's statements.
   * @param criteria - The criteria matrix (#359).
   * @param merge - The merge plan (#360).
   */
  constructor(
    @Inject(PageRepository) private readonly store: PageStore,
    @Inject(CriteriaService) private readonly criteria: PageCriteria,
    @Inject(MergeExecutorService) private readonly merge: PagePlan,
  ) {}

  /**
   * The workspace's PRs, most recently updated first.
   *
   * @param organizationId - The workspace.
   * @param query - The filters and the page.
   * @returns One page, each row with its latest revision's aggregate and needs-you flag.
   */
  async list(
    organizationId: string,
    query: ListPullRequestsQuery,
  ): Promise<PullRequestListResource> {
    const window = windowOf(query);
    const { rows, total } = await this.store.list(
      organizationId,
      {
        ...(query.state === undefined ? {} : { states: query.state }),
        ...(query.reviewRequested === undefined ? {} : { reviewRequested: query.reviewRequested }),
      },
      window,
    );
    const aggregates = await this.store.aggregates(
      rows.flatMap((row) => (row.latestRevision === null ? [] : [row.latestRevision.id])),
    );

    return pageOf(
      rows.map((row) =>
        summaryResource(
          row,
          row.latestRevision === null ? undefined : aggregates.get(row.latestRevision.id),
        ),
      ),
      total,
      window,
    );
  }

  /**
   * The whole page.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @returns Every region's data.
   * @throws {NotFoundError} `pull_request_not_found` — absent, or another workspace's.
   */
  async page(organizationId: string, prId: string): Promise<PullRequestPageResource> {
    const head = await this.store.head(organizationId, prId);

    if (head === undefined) {
      throw pullRequestNotFound(prId);
    }

    const [revisions, gateRows, thread, approval, loopReturns, criteria, plan] = await Promise.all([
      this.store.revisions(prId),
      this.store.gateRows(prId),
      this.store.thread(prId),
      this.store.approval(prId),
      this.store.loopReturns(prId),
      this.criteria.matrix(organizationId, prId),
      this.merge.plan(organizationId, prId),
    ]);
    const testRunIds = [
      ...new Set(
        revisions.flatMap((revision) => {
          const id = citedTestRunId(gateRows.filter((row) => row.revisionId === revision.id));
          return id === undefined ? [] : [id];
        }),
      ),
    ];
    const [aggregates, attempts, classifications, spend, route] = await Promise.all([
      this.store.aggregates(revisions.map((revision) => revision.id)),
      this.store.testAttempts(organizationId, testRunIds),
      this.store.classifications(organizationId, testRunIds),
      head.run === null ? undefined : this.store.spend(head.run.id),
      head.run === null ? undefined : this.store.routeCap(organizationId, head.run),
    ]);
    const strip = stripResources({
      revisions,
      gateRows,
      aggregates,
      attempts,
      classifications,
      loopReturns,
    });
    const latest = revisions.at(-1);

    return {
      pullRequest: headResource(head),
      revisions: strip,
      gates: strip.at(-1)?.gates ?? null,
      criteria,
      files: latest === undefined ? null : filesResource(latest, head.url),
      thread: threadResource(thread),
      plan,
      spend: spend === undefined ? null : spendRollup(spend.loop, spend.verification, route),
      review: approval === undefined ? null : reviewResource(approval),
      loopReturn: loopReturns[0] === undefined ? null : loopReturnResource(loopReturns[0]),
    };
  }
}
