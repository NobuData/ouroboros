/**
 * The `dora` family — deploy frequency, lead time, change failure rate and MTTR (BI.2,
 * [#433](https://github.com/NobuData/ouroboros/issues/433); sources: farm jobs, runs, the PR plane
 * and loop commits). Two of the four are **proxies**, and the registry says so.
 *
 *   * **Deploy frequency** — successful default-branch builds finished on the day (`git_ref` is
 *     the repository's default branch, bare or as `refs/heads/…`). A repository with no default
 *     branch recorded has no deploys.
 *   * **Lead time** — over loop PRs merged on the day, the total of `ouroboros.lead_time_ms()`
 *     (loop start → merge, V077's single definition) over their count.
 *   * **Change failure rate** (proxy) — over loop PRs merged on the day, those a later revert names
 *     (`revert.detection.ts`): a merged PR's title or a loop commit's message, in the same
 *     repository, after the merge. **Dated by the original merge**, so a revert that lands days
 *     later changes that merge's day: the nightly consolidation re-fills a trailing window for
 *     exactly that reason (`OURO_INSIGHTS_ROLLUP_CONSOLIDATE_DAYS`).
 *   * **MTTR** (proxy) — loop-scoped recovery. A loop's farm jobs, in finish order, are green
 *     (`succeeded`) or red (`failed`, `retried`); a recovery is a green that follows one or more
 *     reds since the loop's previous green, timed from the first of those reds. Dated by the green.
 *
 * A negative interval — a host clock behind the loop's — is clamped to zero rather than allowed to
 * refuse the day's fill.
 */

import { sql, type Kysely } from "kysely";

import type { Database } from "../../../db/schema";
import { dayBounds } from "../rollup.days";
import { ratioRow, sumRow } from "../rollup.rows";
import { joinRepo, num, REPO_REF } from "../rollup.sql";
import type { FamilyExtractor, RollupRow } from "../rollup.types";
import { repositoryUrl, revertedTitle } from "../revert.detection";

/** A loop PR merged on the day. */
interface MergedPr {
  repo_ref: string;
  title: string;
  external_url: string;
  merged_at: Date;
  lead_ms: string;
}

/** A merged PR whose title might be a revert. */
interface RevertPr {
  title: string;
  external_url: string;
  merged_at: Date;
}

/** A loop commit whose message might be a revert. */
interface RevertCommit {
  repo_ref: string;
  message: string;
  committed_at: Date;
}

/** One finished farm job of a loop with a green on the day. */
interface LoopJob {
  repo_ref: string;
  run_id: string;
  status: "succeeded" | "failed" | "retried";
  finished_at: Date;
}

/** One repository's deploys. */
interface DeployGroup {
  repo_ref: string;
  deploys: string;
}

/** Running totals per repository for a ratio metric. */
type Ratios = Map<string, { numerator: number; denominator: number }>;

/**
 * Add to a repository's ratio components.
 *
 * @param ratios - The totals.
 * @param repoRef - The repository.
 * @param numerator - Added to the numerator.
 * @param denominator - Added to the denominator.
 */
function addRatio(ratios: Ratios, repoRef: string, numerator: number, denominator: number): void {
  const totals = ratios.get(repoRef) ?? { numerator: 0, denominator: 0 };

  totals.numerator += numerator;
  totals.denominator += denominator;
  ratios.set(repoRef, totals);
}

/**
 * Whether a merged PR was later reverted, by either kind of revert text.
 *
 * @param pr - The merged PR.
 * @param prs - Merged PRs of the workspace that might be reverts.
 * @param commits - Loop commits of the workspace that might be reverts.
 * @returns True when a revert in the same repository, after the merge, names its title.
 */
export function isReverted(
  pr: Pick<MergedPr, "repo_ref" | "title" | "external_url" | "merged_at">,
  prs: readonly RevertPr[],
  commits: readonly RevertCommit[],
): boolean {
  const title = pr.title.trim();
  const repoUrl = repositoryUrl(pr.external_url);

  return (
    prs.some(
      (candidate) =>
        candidate.merged_at > pr.merged_at &&
        repositoryUrl(candidate.external_url) === repoUrl &&
        revertedTitle(candidate.title) === title,
    ) ||
    commits.some(
      (candidate) =>
        candidate.committed_at > pr.merged_at &&
        candidate.repo_ref === pr.repo_ref &&
        revertedTitle(candidate.message) === title,
    )
  );
}

/**
 * The recoveries a loop's jobs contain, as `(finished, ms)` pairs.
 *
 * @param jobs - One loop's finished jobs, in finish order.
 * @returns Every green that followed a red, with the time since the first red of that streak.
 */
export function recoveries(
  jobs: readonly Pick<LoopJob, "status" | "finished_at">[],
): { at: Date; ms: number }[] {
  const out: { at: Date; ms: number }[] = [];
  let firstRed: Date | undefined;

  for (const job of jobs) {
    if (job.status === "succeeded") {
      if (firstRed !== undefined) {
        out.push({
          at: job.finished_at,
          ms: Math.max(0, job.finished_at.getTime() - firstRed.getTime()),
        });
      }
      firstRed = undefined;
    } else {
      firstRed ??= job.finished_at;
    }
  }

  return out;
}

/**
 * MTTR's components per repository: recoveries completed on the day.
 *
 * @param db - The connection.
 * @param organizationId - The workspace.
 * @param from - The day's start.
 * @param to - The next day's start.
 * @returns Total recovery time and recovery count, per repository.
 */
async function mttr(
  db: Kysely<Database>,
  organizationId: string,
  from: Date,
  to: Date,
): Promise<Ratios> {
  const { rows } = await sql<LoopJob>`
    select ${REPO_REF} as repo_ref, b.run_id, b.status, b.finished_at
      from ouroboros.build_jobs b
      ${joinRepo("b")}
     where b.organization_id = ${organizationId}
       and b.status in ('succeeded', 'failed', 'retried')
       and b.finished_at < ${to}
       and b.run_id in (select g.run_id from ouroboros.build_jobs g
                         where g.organization_id = ${organizationId} and g.status = 'succeeded'
                           and g.finished_at >= ${from} and g.finished_at < ${to})
     order by b.run_id, b.finished_at, b.number`.execute(db);

  const byRun = new Map<string, LoopJob[]>();

  for (const job of rows) {
    byRun.set(job.run_id, [...(byRun.get(job.run_id) ?? []), job]);
  }

  const ratios: Ratios = new Map();

  for (const jobs of byRun.values()) {
    for (const recovery of recoveries(jobs)) {
      if (recovery.at >= from) {
        addRatio(ratios, jobs[0].repo_ref, recovery.ms, 1);
      }
    }
  }

  return ratios;
}

export const doraExtractor: FamilyExtractor = {
  family: "dora",
  metrics: { deploy_frequency: 1, lead_time: 1, change_failure_rate: 1, mttr: 1 },

  async extract(db, organizationId, day): Promise<RollupRow[]> {
    const { from, to } = dayBounds(day);

    const deploys = await sql<DeployGroup>`
      select ${REPO_REF} as repo_ref, count(*) as deploys
        from ouroboros.build_jobs b
        ${joinRepo("b")}
       where b.organization_id = ${organizationId} and b.status = 'succeeded'
         and b.finished_at >= ${from} and b.finished_at < ${to}
         and gr.default_branch is not null
         and b.git_ref in (gr.default_branch, 'refs/heads/' || gr.default_branch)
       group by 1`.execute(db);

    const merged = await sql<MergedPr>`
      select ${REPO_REF} as repo_ref, pr.title, pr.external_url, pr.merged_at,
             greatest(0, ouroboros.lead_time_ms(r.started_at, pr.merged_at)) as lead_ms
        from ouroboros.pull_requests pr
        join ouroboros.runs r on r.id = pr.run_id
        ${joinRepo("r")}
       where pr.organization_id = ${organizationId} and pr.state = 'merged'
         and pr.merged_at >= ${from} and pr.merged_at < ${to}`.execute(db);

    const out: RollupRow[] = deploys.rows.map((group) =>
      sumRow({ repoRef: group.repo_ref, metricId: "deploy_frequency" }, num(group.deploys)),
    );

    if (merged.rows.length > 0) {
      const revertPrs = await sql<RevertPr>`
        select title, external_url, merged_at
          from ouroboros.pull_requests
         where organization_id = ${organizationId} and state = 'merged'
           and merged_at > ${from} and title ilike '%revert%'`.execute(db);

      const revertCommits = await sql<RevertCommit>`
        select ${REPO_REF} as repo_ref, c.message, c.committed_at
          from ouroboros.run_commits c
          join ouroboros.runs r on r.id = c.run_id
          ${joinRepo("r")}
         where r.organization_id = ${organizationId}
           and c.committed_at > ${from} and c.message ilike '%revert%'`.execute(db);

      const lead: Ratios = new Map();
      const failures: Ratios = new Map();

      for (const pr of merged.rows) {
        addRatio(lead, pr.repo_ref, num(pr.lead_ms), 1);
        addRatio(
          failures,
          pr.repo_ref,
          isReverted(pr, revertPrs.rows, revertCommits.rows) ? 1 : 0,
          1,
        );
      }

      for (const [repoRef, totals] of lead) {
        out.push(
          ratioRow({ repoRef, metricId: "lead_time" }, totals.numerator, totals.denominator, 1),
        );
      }

      for (const [repoRef, totals] of failures) {
        out.push(
          ratioRow(
            { repoRef, metricId: "change_failure_rate" },
            totals.numerator,
            totals.denominator,
            100,
          ),
        );
      }
    }

    for (const [repoRef, totals] of await mttr(db, organizationId, from, to)) {
      out.push(ratioRow({ repoRef, metricId: "mttr" }, totals.numerator, totals.denominator, 1));
    }

    return out;
  },
};
