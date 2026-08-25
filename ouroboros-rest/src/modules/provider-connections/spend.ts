/**
 * The provider cards' monthly meters — what `GET /api/v1/providers/spend` answers, and the
 * one place the ledger's calendar month is turned into something a card can draw
 * ([#228](https://github.com/NobuData/ouroboros/issues/228), roadmap decision **P7**).
 *
 * ```
 * monthWindow(now) ─▶ { since: 1st 00:00 UTC, until: now }
 * RoutingStatsRepository.byProvider(org, since) ─▶ rows   (Z.5's statement, unchanged)
 * toProviderMonthlySpend(rows, window) ─▶ { month, providers: [{kind, local, spendCents, …}] }
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Why a calendar month, when everything on mockup 06 is a rolling thirty days.**
 *
 * Decision **P7**: *caps are calendar-month, stored per connection*. A cap is a figure
 * somebody agreed with a vendor for a billing period, and a meter reading `$412.80 of $600`
 * is only a true statement about that agreement if the numerator is over the same period —
 * measured from the first of the month, in the zone the vendor's invoice is cut in, which is
 * UTC here for the reason `dashboard/windows.ts` gives for the token-spend card's *today*. It
 * is the window `R__dev_seed_providers.sql` places its rows in and `tests/seed.sql` asserts
 * the meters against, so a card drawn from this endpoint reads the seed's own figures.
 *
 * **The statement is Z.5's, not a second one.** `RoutingStatsRepository.byProvider` already
 * sums priced spend, tokens and the two call counts per provider *since an instant*; the
 * only thing that differs between the routing card and this one is the instant. A second
 * `sum(cost_cents)` written here would be a second opinion about one invoice, which is the
 * failure `stats.repository.ts` exists to prevent.
 *
 * ---------------------------------------------------------------------------
 * **A row is a provider kind, because that is what the ledger records.**
 *
 * `token_usage.provider` is the kind (`anthropic`, `ollama`) and never a connection id
 * (V010, decision **F8**). A workspace with two Ollama daemons has one Ollama figure, and a
 * card is honest about that by saying so rather than by splitting a number it cannot split.
 * The seeded workspace has one connection per kind, which is why its five meters read as
 * five figures.
 *
 * **Nothing here coalesces an absence into a zero.** `spendCents` is null when none of the
 * kind's calls are priced — the state a card renders as *no metered spend* for a local
 * provider and as *unpriced* for a cloud one — and `0` only when calls were priced at
 * nothing. `local` is `locality.ts`'s answer, published so the card does not keep a list of
 * which kinds are local (decision **P8**: the `no metered spend` / `tokens on-box` lines are
 * a fact about the provider, and the fact is this service's).
 */

import { isLocalProvider } from "../routing/locality";
import type { ProviderSpendRow } from "../routing/stats.repository";

/** The two instants a month's figures are measured between. */
export interface MonthWindow {
  /** The first instant of the current UTC calendar month. Inclusive. */
  readonly since: Date;
  /** The request instant — when the figures were measured. */
  readonly until: Date;
}

/** `openapi.yaml` § `MonthWindow`. */
export interface MonthWindowResource {
  /** {@link MonthWindow.since}, ISO 8601. */
  readonly since: string;
  /** {@link MonthWindow.until}, ISO 8601. */
  readonly until: string;
}

/** One kind's month, as the card's meter is computed from — `openapi.yaml` § `ProviderMonthlySpendRow`. */
export interface ProviderMonthlySpendRowResource {
  /** `token_usage.provider` — a provider *kind*, which is how the ledger attributes spend. */
  readonly kind: string;
  /** Whether the kind is served without a credential — the same list the lease policy draws. */
  readonly local: boolean;
  /**
   * The month's priced spend in cents, or null when none of the kind's calls are priced.
   *
   * `41280` is `$412.80`. Null is *nobody priced these calls* and is never `0`, which is the
   * other fact: calls that were priced, at nothing.
   */
  readonly spendCents: number | null;
  /** `tokens_in + tokens_out` over the month — the local cards' *2.1M tokens on-box*. */
  readonly tokens: number;
  /** How many of the kind's calls carried a price. */
  readonly pricedCalls: number;
  /** How many did not. Non-zero makes {@link spendCents} a lower bound. */
  readonly unpricedCalls: number;
}

/** The cards' meters — `openapi.yaml` § `ProviderMonthlySpend`. */
export interface ProviderMonthlySpendResource {
  /** The calendar month every figure below is over. */
  readonly month: MonthWindowResource;
  /**
   * One row per kind with any usage this month, ordered by kind.
   *
   * A kind with no usage is **absent** rather than a row of zeros: a card whose kind is not
   * here has nothing to meter yet, which it draws as an absence and not as `$0.00`.
   */
  readonly providers: readonly ProviderMonthlySpendRowResource[];
}

/**
 * The window a read at this instant measures over.
 *
 * @param now - The request instant. Injected so a suite can assert the boundary without
 *   owning time, and so the boundary is computed once per read.
 * @returns The month: from the first instant of `now`'s UTC calendar month, to `now`.
 */
export function monthWindow(now: Date): MonthWindow {
  return {
    since: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    until: now,
  };
}

/**
 * The window, as the contract serves it.
 *
 * @param window - The instants.
 * @returns Both as ISO 8601.
 */
export function toMonthWindowResource(window: MonthWindow): MonthWindowResource {
  return { since: window.since.toISOString(), until: window.until.toISOString() };
}

/**
 * One ledger row as a card's row.
 *
 * `pg` hands `numeric` and `bigint` back as text so nothing rounds in transit (see
 * `stats.repository.ts`); they are narrowed here, once, at the edge.
 *
 * @param row - The row, as the statement answers it.
 * @returns The row, in the contract's vocabulary.
 */
export function toProviderMonthlySpendRow(row: ProviderSpendRow): ProviderMonthlySpendRowResource {
  return {
    kind: row.provider,
    local: isLocalProvider(row.provider),
    spendCents: row.spend_cents === null ? null : Number(row.spend_cents),
    tokens: Number(row.tokens),
    pricedCalls: row.priced_calls,
    unpricedCalls: row.unpriced_calls,
  };
}

/**
 * The cards' meters, from the month's rows.
 *
 * @param rows - What `RoutingStatsRepository.byProvider` answered for the month's `since`.
 * @param window - The month those rows were read over.
 * @returns The resource. `providers` is empty for a workspace that has spent nothing this
 *   month, which every card draws as an absence.
 */
export function toProviderMonthlySpend(
  rows: readonly ProviderSpendRow[],
  window: MonthWindow,
): ProviderMonthlySpendResource {
  return {
    month: toMonthWindowResource(window),
    providers: rows.map(toProviderMonthlySpendRow),
  };
}
