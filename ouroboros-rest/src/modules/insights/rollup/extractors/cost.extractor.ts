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
 * **Two breakdowns ride the same pass** (BJ.2, [#438](https://github.com/NobuData/ouroboros/issues/438),
 * V083) — mockup 15's *Tokens by stage* card:
 *
 *   * `tokens_by_task_kind` is `tokens` by the task kind the usage was recorded for. Usage with no
 *     task kind has no label, so it is in `tokens` and in no bar; the bars may sum to less than the
 *     total, and the registry's caveat says so.
 *   * `local_tokens` is the part of `tokens` a local provider served — where the model ran, not
 *     what it cost. The local kinds are the control plane's own list (`LOCAL_PROVIDER_KINDS`), so
 *     the card's local share and the routing matrix's *local* can never disagree.
 *
 * Usage is attributed to a repository through its run. A call with no run belongs to no
 * repository and is outside every per-repository row; it waits for #451's org-level rows.
 */

import { sql } from "kysely";

import { LOCAL_PROVIDER_KINDS } from "../../../internal/providers";
import { dayBounds } from "../rollup.days";
import { sumRow } from "../rollup.rows";
import { joinRepo, num, REPO_REF } from "../rollup.sql";
import type { FamilyExtractor, RollupRow } from "../rollup.types";

/** The longest label `metric_daily.dimension` admits (V078's `metric_daily_dimension_format`). */
const DIMENSION_MAX_LENGTH = 200;

/** One repository's usage on the day, for one task kind (or for usage that names none). */
interface UsageGroup {
  repo_ref: string;
  /** The trimmed task kind, or null for usage recorded with none. */
  task_kind: string | null;
  tokens: string;
  unpriced_tokens: string;
  local_tokens: string;
  priced_events: string;
  cost_cents: string | null;
}

/** One repository's day, folded across its task kinds. */
interface RepoUsage {
  tokens: number;
  unpricedTokens: number;
  localTokens: number;
  pricedEvents: number;
  costCents: number;
  /** Tokens per named task kind. */
  byTaskKind: Map<string, number>;
}

/**
 * Fold the per-task-kind groups into one total per repository, keeping each kind's tokens.
 *
 * @param groups - The query's rows: one per repository and task kind.
 * @returns Each repository's day, in the order the query answered them.
 */
function foldByRepo(groups: readonly UsageGroup[]): Map<string, RepoUsage> {
  const repos = new Map<string, RepoUsage>();

  for (const group of groups) {
    const usage = repos.get(group.repo_ref) ?? {
      tokens: 0,
      unpricedTokens: 0,
      localTokens: 0,
      pricedEvents: 0,
      costCents: 0,
      byTaskKind: new Map<string, number>(),
    };

    usage.tokens += num(group.tokens);
    usage.unpricedTokens += num(group.unpriced_tokens);
    usage.localTokens += num(group.local_tokens);
    usage.pricedEvents += num(group.priced_events);
    usage.costCents += num(group.cost_cents);

    if (group.task_kind !== null) {
      usage.byTaskKind.set(group.task_kind, num(group.tokens));
    }

    repos.set(group.repo_ref, usage);
  }

  return repos;
}

export const costExtractor: FamilyExtractor = {
  family: "cost",
  metrics: {
    cost_cents: 1,
    tokens: 1,
    unpriced_tokens: 1,
    tokens_by_task_kind: 1,
    local_tokens: 1,
  },

  async extract(db, organizationId, day): Promise<RollupRow[]> {
    const { from, to } = dayBounds(day);

    const usage = await sql<UsageGroup>`
      select ${REPO_REF} as repo_ref,
             nullif(btrim(left(btrim(tu.task_kind), ${DIMENSION_MAX_LENGTH})), '') as task_kind,
             sum(tu.tokens_in::bigint + tu.tokens_out) as tokens,
             coalesce(sum(tu.tokens_in::bigint + tu.tokens_out)
                        filter (where tu.cost_cents is null), 0) as unpriced_tokens,
             coalesce(sum(tu.tokens_in::bigint + tu.tokens_out)
                        filter (where tu.provider = any(${sql.val([...LOCAL_PROVIDER_KINDS])}::text[])),
                      0) as local_tokens,
             count(*) filter (where tu.cost_cents is not null) as priced_events,
             sum(tu.cost_cents) as cost_cents
        from ouroboros.token_usage tu
        join ouroboros.runs r on r.id = tu.run_id
        ${joinRepo("r")}
       where tu.organization_id = ${organizationId}
         and tu.occurred_at >= ${from} and tu.occurred_at < ${to}
       group by 1, 2
       order by 1, 2`.execute(db);

    return [...foldByRepo(usage.rows)].flatMap(([repoRef, repo]) => {
      const out: RollupRow[] = [
        sumRow({ repoRef, metricId: "tokens" }, repo.tokens),
        sumRow({ repoRef, metricId: "unpriced_tokens" }, repo.unpricedTokens),
        sumRow({ repoRef, metricId: "local_tokens" }, repo.localTokens),
      ];

      if (repo.pricedEvents > 0) {
        out.push(sumRow({ repoRef, metricId: "cost_cents" }, repo.costCents));
      }

      for (const [taskKind, tokens] of repo.byTaskKind) {
        out.push(sumRow({ repoRef, metricId: "tokens_by_task_kind", dimension: taskKind }, tokens));
      }

      return out;
    });
  },
};
