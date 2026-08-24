/**
 * Rows → the two figures on a matrix row, and the whole spend card — the arithmetic, kept out
 * of the service that loads it.
 *
 * Z.5 ([#198](https://github.com/NobuData/ouroboros/issues/198)). `stats.repository.ts` issues
 * two aggregates and this file turns their rows into what mockup 06 draws. It is pure: no
 * clock, no database, no injector — which is what lets every honesty rule below be asserted
 * against a hand-written row rather than against a seeded database that has to be stood up
 * first.
 *
 * ---------------------------------------------------------------------------
 * **Three decisions, and each of them is a way a number here could have been a lie.**
 *
 * **1. Nothing is coalesced.** A null from `avg`, `sum` or `percentile_cont` reaches the
 * contract as a null. The one arithmetic this file performs on money is addition, and it adds
 * only what the database already called a number: {@link toRoutingSpend}'s total is null when
 * no row has a priced call, `0` when the priced calls really did cost nothing, and a sum
 * otherwise. Decision **M7**, and the acceptance criterion *"an empty organization yields
 * em-dashes and zero-states — never `$0.00` for unpriced usage"*.
 *
 * **2. The local kinds are merged here rather than by the client**, because the meters are
 * widths *relative to the largest row*: a client that merged after being handed fractions would
 * be rescaling numbers it had already been given, and the footnote's share is a fraction of
 * exactly the merged row's tokens. Which kinds are local is `locality.ts`'s answer, borrowed
 * from the AD.3 lease policy rather than restated. The merge preserves both counts, so a local
 * row can say `$0.00` **and** *five calls here are unpriced* at the same time — which is the
 * exact state Y.4 seeds, and the acceptance criterion *"zero-priced local usage and unpriced
 * usage are distinguishable in the payload, not merged"*.
 *
 * **3. A provider with no usage has no row, and a kind with no calls has no average.** Absence
 * is the empty state; a row of zeros would be a claim that work was done and cost nothing.
 *
 * ---------------------------------------------------------------------------
 * **Where the numbers stop being strings.** `pg` hands a `numeric` and a `bigint` back as text
 * so nothing rounds them on the way out, and this file is the one place they are converted —
 * once, at the contract's edge, exactly as `pricing/resources.ts` and `dashboard.service.ts`
 * do. Token counts are added as JavaScript numbers, which is safe by a wide margin: the
 * ledger's largest plausible total is billions of tokens and `Number.MAX_SAFE_INTEGER` is nine
 * quadrillion. Cents are added the same way and for the same reason — `numeric(14, 4)` in
 * cents tops out four orders of magnitude short of that.
 */

import { isLocalProvider } from "./locality";
import type {
  ProviderSpendResource,
  RouteStatsResource,
  RoutingSpendResource,
  StatsWindowResource,
} from "./resources";
import type { ProviderSpendRow, TaskKindStatsRow } from "./stats.repository";
import type { StatsWindow } from "./stats.window";

/**
 * Everything one read measured, over one window.
 *
 * The matrix's figures are a **map** rather than a list because the matrix is drawn from
 * `task_kinds` in `sort_order` and looks these up on it — and a kind that is missing is the
 * ordinary case, not an error: it is a kind nothing has been spent on, which renders two
 * em-dashes.
 */
export interface RoutingStatsSnapshot {
  /** Task kind → its `$/run avg`, `p50 latency` and the counts behind them. */
  readonly byTaskKind: ReadonlyMap<string, RouteStatsResource>;
  /** The **Spend by provider · 30d** card, its footnote, and the window all of it is over. */
  readonly spend: RoutingSpendResource;
}

/** What joins the kinds of a merged row into its key — `ollama+openai_compatible`. */
const KEY_SEPARATOR = "+";

/**
 * One matrix row's numerics, as the contract publishes them.
 *
 * @param row - The aggregate's row.
 * @returns The two figures and the three counts behind them. A null stays a null.
 */
export function toRouteStatsResource(row: TaskKindStatsRow): RouteStatsResource {
  return {
    costCentsPerRunAvg: row.cost_cents_avg === null ? null : Number(row.cost_cents_avg),
    latencyP50Ms: row.latency_p50_ms,
    pricedCalls: row.priced_calls,
    unpricedCalls: row.unpriced_calls,
    timedCalls: row.timed_calls,
  };
}

/**
 * Every measured kind, keyed by name, ready for the matrix to look its rows up in.
 *
 * A map rather than a list because the matrix is drawn from `task_kinds` in `sort_order` and
 * joins these onto it — and a kind that is *missing* from this map is the ordinary case, not an
 * error: it is a kind nothing was spent on, which renders two em-dashes.
 *
 * @param rows - The per-kind aggregate.
 * @returns Task kind → its figures.
 */
export function routeStatsByTaskKind(
  rows: readonly TaskKindStatsRow[],
): ReadonlyMap<string, RouteStatsResource> {
  return new Map(rows.map((row) => [row.task_kind, toRouteStatsResource(row)]));
}

/** One provider row on the way through — the ledger's text already converted, nothing merged. */
interface SpendTotals {
  /** Which `token_usage.provider` values are summed here. */
  readonly kinds: readonly string[];
  /** Priced spend in cents, or null when nothing in the group is priced. */
  readonly spendCents: number | null;
  readonly tokens: number;
  readonly pricedCalls: number;
  readonly unpricedCalls: number;
}

/**
 * The spend card, its meters, and its footnote.
 *
 * @param rows - Every provider with usage in the window.
 * @param window - The window they were measured over, for the payload's own label.
 * @returns The card. `providers` is empty and every total is a zero-state for a workspace that
 *   has spent nothing — with `localTokenShare` **null** rather than `0`, because a workspace
 *   that ran nothing did not fail to run locally.
 */
export function toRoutingSpend(
  rows: readonly ProviderSpendRow[],
  window: StatsWindow,
): RoutingSpendResource {
  const groups = groupProviders(rows);
  const largest = largestSpend(groups);

  const providers = groups
    .map((group) => toProviderSpendResource(group, largest))
    .toSorted(byMeteredOrder);

  const tokens = sum(providers.map((provider) => provider.tokens));
  const localTokens = sum(
    providers.filter((provider) => provider.local).map((provider) => provider.tokens),
  );

  return {
    window: toStatsWindowResource(window),
    providers,
    totalSpendCents: totalSpend(providers),
    tokens,
    localTokens,
    // Null and not zero for an empty window: see this function's `@returns`.
    localTokenShare: tokens === 0 ? null : localTokens / tokens,
    unpricedCalls: sum(providers.map((provider) => provider.unpricedCalls)),
  };
}

/**
 * The window as the payload states it.
 *
 * @param window - The instants the figures were measured between.
 * @returns The same window in ISO 8601.
 */
export function toStatsWindowResource(window: StatsWindow): StatsWindowResource {
  return {
    days: window.days,
    since: window.since.toISOString(),
    until: window.until.toISOString(),
  };
}

/**
 * The ledger's providers as the card's rows — every local kind folded into one.
 *
 * @param rows - The per-provider aggregate.
 * @returns One entry per cloud provider, plus at most one for the local kinds together. Order
 *   is not decided here; {@link byMeteredOrder} does that once the meters exist.
 */
function groupProviders(rows: readonly ProviderSpendRow[]): SpendTotals[] {
  const cloud = rows.filter((row) => !isLocalProvider(row.provider));
  const local = rows.filter((row) => isLocalProvider(row.provider));

  const grouped = cloud.map((row) => totalsOf([row]));

  return local.length === 0 ? grouped : [...grouped, totalsOf(local)];
}

/**
 * One or more provider rows added together.
 *
 * **`spendCents` is null only when *every* row in the group is unpriced**, which is what keeps
 * a merged local row honest: Ollama's zero-priced `docs` calls and its unpriced ones sum to
 * `0`, and the unpriced count beside it is what says the total is a lower bound. A group that
 * treated one null as poisoning the sum would render *unpriced* over calls that were priced,
 * and a group that treated it as a zero would render `$0.00` over calls nobody has priced.
 *
 * @param rows - The rows to add. Never empty.
 * @returns Their totals.
 */
function totalsOf(rows: readonly ProviderSpendRow[]): SpendTotals {
  const priced = rows.filter((row) => row.spend_cents !== null);

  return {
    kinds: rows.map((row) => row.provider).toSorted(),
    spendCents: priced.length === 0 ? null : sum(priced.map((row) => Number(row.spend_cents))),
    tokens: sum(rows.map((row) => Number(row.tokens))),
    pricedCalls: sum(rows.map((row) => row.priced_calls)),
    unpricedCalls: sum(rows.map((row) => row.unpriced_calls)),
  };
}

/**
 * The largest priced spend on the card — what every meter is a fraction of.
 *
 * @param groups - The card's rows.
 * @returns The largest {@link SpendTotals.spendCents}, or null when nothing is priced.
 */
function largestSpend(groups: readonly SpendTotals[]): number | null {
  const spends = groups.flatMap((group) => (group.spendCents === null ? [] : [group.spendCents]));

  return spends.length === 0 ? null : Math.max(...spends);
}

/**
 * One group as a metered row.
 *
 * @param group - The group's totals.
 * @param largest - The card's largest priced spend, or null when nothing is priced.
 * @returns The row. `meterFraction` is null when this row has nothing priced to draw, and `0`
 *   when the largest spend on the card is itself zero — every row cost nothing, so no row is
 *   longer than another.
 */
function toProviderSpendResource(
  group: SpendTotals,
  largest: number | null,
): ProviderSpendResource {
  const meterFraction =
    group.spendCents === null || largest === null
      ? null
      : largest === 0
        ? 0
        : group.spendCents / largest;

  return {
    key: group.kinds.join(KEY_SEPARATOR),
    kinds: group.kinds,
    local: group.kinds.every(isLocalProvider),
    spendCents: group.spendCents,
    meterFraction,
    tokens: group.tokens,
    pricedCalls: group.pricedCalls,
    unpricedCalls: group.unpricedCalls,
  };
}

/**
 * The order the card draws its rows in: biggest bill first, unpriced rows last.
 *
 * Mockup 06's own order falls out of it — Anthropic, GitHub Copilot, Cursor, then the local row
 * at `$0.00`. A row with **nothing priced** sorts after every priced row however many tokens it
 * served, because the card is about money and *we do not know* is not a large number; among
 * those, more tokens first, so the biggest unknown is the one a reader sees. `key` breaks
 * every remaining tie, so the order is total and an answer does not shuffle between reads.
 *
 * @param left - One row.
 * @param right - The other.
 * @returns The comparison.
 */
function byMeteredOrder(left: ProviderSpendResource, right: ProviderSpendResource): number {
  if (left.spendCents === null || right.spendCents === null) {
    if (left.spendCents !== right.spendCents) {
      return left.spendCents === null ? 1 : -1;
    }

    return right.tokens - left.tokens || left.key.localeCompare(right.key);
  }

  return right.spendCents - left.spendCents || left.key.localeCompare(right.key);
}

/**
 * Every row's priced spend, added.
 *
 * @param providers - The card's rows.
 * @returns The total in cents, or null when no row has a priced call — the card's own *nothing
 *   here is priced* state, distinct from a total that really is zero.
 */
function totalSpend(providers: readonly ProviderSpendResource[]): number | null {
  const priced = providers.flatMap((provider) =>
    provider.spendCents === null ? [] : [provider.spendCents],
  );

  return priced.length === 0 ? null : sum(priced);
}

/**
 * Add a list of numbers.
 *
 * @param values - The numbers.
 * @returns Their sum; `0` for an empty list, which is the arithmetic identity rather than a
 *   measurement — every caller has already decided that an empty list means zero.
 */
function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
