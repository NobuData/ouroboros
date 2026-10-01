/**
 * The `cost` family — priced spend, tokens and unpriced tokens (BI.2,
 * [#433](https://github.com/NobuData/ouroboros/issues/433); sources: #66's `token_usage`, priced
 * by #92 when it lands).
 *
 * **Priced and unpriced stay separate all the way down** (decision I8). `token_usage.cost_cents`
 * null means *unpriced*, never $0, so:
 *
 *   * `tokens` counts every token, priced or not;
 *   * `unpriced_tokens` counts the part no price covered — so priced tokens are the difference,
 *     and a tokens-only render needs no second read;
 *   * `cost_cents` sums priced spend only, and **has no row on a day with no priced usage** —
 *     an absent row is "cost unavailable", a zero row is a real $0 (a local model priced at 0).
 *
 * **`cost_per_merged_pr` is not stored per day.** Its numerator is not a subset of its denominator:
 * a day of spend with no merges has no denominator the grain can hold, so a daily ratio row would
 * drop that day's spend from every window — understating the cost of failure, which the registry
 * says is counted. A window computes it as `Σ cost_cents / Σ merged_prs` over rows this family and
 * `throughput` both store, and the oracle parity suite checks that derivation like any other.
 *
 * Usage is attributed to a repository through its run. A call with no run belongs to no
 * repository and is outside every per-repository row; it waits for #451's org-level rows.
 */

import { sql } from "kysely";

import { dayBounds } from "../rollup.days";
import { sumRow } from "../rollup.rows";
import { joinRepo, num, REPO_REF } from "../rollup.sql";
import type { FamilyExtractor, RollupRow } from "../rollup.types";

/** One repository's usage on the day. */
interface UsageGroup {
  repo_ref: string;
  tokens: string;
  unpriced_tokens: string;
  priced_events: string;
  cost_cents: string | null;
}

export const costExtractor: FamilyExtractor = {
  family: "cost",
  metrics: { cost_cents: 1, tokens: 1, unpriced_tokens: 1 },

  async extract(db, organizationId, day): Promise<RollupRow[]> {
    const { from, to } = dayBounds(day);

    const usage = await sql<UsageGroup>`
      select ${REPO_REF} as repo_ref,
             sum(tu.tokens_in::bigint + tu.tokens_out) as tokens,
             coalesce(sum(tu.tokens_in::bigint + tu.tokens_out)
                        filter (where tu.cost_cents is null), 0) as unpriced_tokens,
             count(*) filter (where tu.cost_cents is not null) as priced_events,
             sum(tu.cost_cents) as cost_cents
        from ouroboros.token_usage tu
        join ouroboros.runs r on r.id = tu.run_id
        ${joinRepo("r")}
       where tu.organization_id = ${organizationId}
         and tu.occurred_at >= ${from} and tu.occurred_at < ${to}
       group by 1`.execute(db);

    return usage.rows.flatMap((group) => {
      const repoRef = group.repo_ref;
      const out: RollupRow[] = [
        sumRow({ repoRef, metricId: "tokens" }, num(group.tokens)),
        sumRow({ repoRef, metricId: "unpriced_tokens" }, num(group.unpriced_tokens)),
      ];

      if (num(group.priced_events) === 0) {
        return out;
      }

      out.push(sumRow({ repoRef, metricId: "cost_cents" }, num(group.cost_cents)));

      return out;
    });
  },
};
