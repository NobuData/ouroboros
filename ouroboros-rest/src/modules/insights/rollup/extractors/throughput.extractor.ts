/**
 * The `throughput` family — merged PRs, the autonomous merge rate and the merged-untouched rate
 * (BI.2, [#433](https://github.com/NobuData/ouroboros/issues/433); sources: #352's PR plane).
 *
 * **The population is loop PRs** — `pull_requests.run_id` set — that closed on the day:
 *
 *   * a merged PR on the day of its `merged_at`;
 *   * a PR closed unmerged on the day its loop finished (`runs.finished_at`). The PR plane keeps
 *     no close instant, and a loop's terminal stamp is fixed once written, so a re-run of a past
 *     day cannot move a closed PR to a different one. A closed PR whose loop has not finished is
 *     not yet in any day.
 *
 * **Autonomous** (merge rate's numerator) is a merged PR whose loop finished `merged` — not
 * handed to a person — and never had a guardrail fail: stops `interventions` counts too.
 *
 * **Untouched** is decision **I6**, exactly: a merged PR whose revisions contain no push the loop
 * did not author. A revision is the loop's when its `head_sha` is a commit its run reported in
 * `run_commits` — V052's match-by-sha, never an assertion — so a human push, a host-side edit
 * and anything pushed after the loop's last revision all leave a revision no run commit names.
 */

import { sql } from "kysely";

import { dayBounds } from "../rollup.days";
import { ratioRow, sumRow } from "../rollup.rows";
import { joinRepo, num, REPO_REF } from "../rollup.sql";
import type { FamilyExtractor, RollupRow } from "../rollup.types";

/** One repository's day, as the statement groups it. */
interface ThroughputGroup {
  repo_ref: string;
  closed: string;
  merged: string;
  autonomous: string;
  untouched: string;
}

export const throughputExtractor: FamilyExtractor = {
  family: "throughput",
  metrics: { merged_prs: 1, merge_rate: 1, merged_untouched_rate: 1 },

  async extract(db, organizationId, day): Promise<RollupRow[]> {
    const { from, to } = dayBounds(day);

    const { rows } = await sql<ThroughputGroup>`
      with closed_prs as (
        select pr.id, pr.state, pr.run_id, r.status as run_status, ${REPO_REF} as repo_ref
          from ouroboros.pull_requests pr
          join ouroboros.runs r on r.id = pr.run_id
          ${joinRepo("r")}
         where pr.organization_id = ${organizationId}
           and ((pr.state = 'merged' and pr.merged_at >= ${from} and pr.merged_at < ${to})
             or (pr.state = 'closed' and r.finished_at >= ${from} and r.finished_at < ${to}))
      )
      select repo_ref,
             count(*) as closed,
             count(*) filter (where state = 'merged') as merged,
             count(*) filter (
               where state = 'merged' and run_status = 'merged'
                 and not exists (select 1 from ouroboros.guardrail_evaluations g
                                  where g.run_id = closed_prs.run_id and g.verdict = 'fail')
             ) as autonomous,
             count(*) filter (
               where state = 'merged'
                 and not exists (select 1 from ouroboros.pr_revisions v
                                  where v.pr_id = closed_prs.id
                                    and not exists (select 1 from ouroboros.run_commits c
                                                     where c.run_id = closed_prs.run_id
                                                       and c.sha = v.head_sha))
             ) as untouched
        from closed_prs
       group by repo_ref`.execute(db);

    return rows.flatMap((group) => {
      const repoRef = group.repo_ref;
      const merged = num(group.merged);
      const out: RollupRow[] = [
        sumRow({ repoRef, metricId: "merged_prs" }, merged),
        ratioRow(
          { repoRef, metricId: "merge_rate" },
          num(group.autonomous),
          num(group.closed),
          100,
        ),
      ];

      if (merged > 0) {
        out.push(
          ratioRow(
            { repoRef, metricId: "merged_untouched_rate" },
            num(group.untouched),
            merged,
            100,
          ),
        );
      }

      return out;
    });
  },
};
