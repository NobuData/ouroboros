/**
 * The Spend card's rollup — loop total, its verification-tagged share, and the route cap (AX.5,
 * [#361](https://github.com/NobuData/ouroboros/issues/361), decision **V8**).
 *
 * ```
 * SPEND                                    Routing →
 * Loop total        284k tokens · $1.52    ← every token_usage row of the PR's run
 * Verification      41k · $0.19            ← the rows tagged task_kind = 'verify'
 * within $2.50 cap                         ← the budget stage's route (routes.max_cost_cents_per_run)
 * ```
 *
 * **A grouping, not a counter.** Both lines are `readSpendTotals` over the run's ledger — the same
 * statement the run console's Resources card and the merge executor's evidence summary sum with —
 * the second one narrowed by V020's `task_kind`. Nothing here counts anything new.
 *
 * **Pricing honesty (M7/N10).** An unpriced ledger has a `null` cost, never `"0"`: zero reads as
 * free, and the truth is *unknown*. The same rule decides the cap line — {@link withinCap} is:
 *
 * ```
 * cost      unpriced rows   cap     withinCap
 * null      any             any     null    — nothing priced: we cannot say
 * any       any             null    null    — no cap to be within
 * > cap     any             set     false   — even the lower bound is over
 * ≤ cap     0               set     true
 * ≤ cap     ≥ 1             set     null    — a lower bound under the cap proves nothing
 * ```
 */

import type { SpendTotals } from "../../runs/run.spend";

/** The `task_kind` the verification pass's usage carries (the seed's, and AZ.1's #371). */
export const VERIFICATION_TASK_KIND = "verify";

/** One line of the card. */
export interface SpendLineResource {
  /** Prompt plus completion tokens — the `284k`. */
  readonly tokens: number;
  /** Prompt tokens. */
  readonly tokensIn: number;
  /** Completion tokens. */
  readonly tokensOut: number;
  /** Cost in cents as a decimal string, or `null` when every row is unpriced — never `"0"` for that. */
  readonly costCents: string | null;
  /** How many rows carry no price; a non-null cost beside a non-zero count is a lower bound. */
  readonly unpricedEvents: number;
}

/** The route whose cap the loop is measured against. */
export interface SpendCapResource {
  /** `routes.max_cost_cents_per_run` — `250` for `$2.50`. */
  readonly cents: number;
  /** `routes.tag` — which route set it. */
  readonly routeTag: string;
}

/** The card. */
export interface SpendRollupResource {
  /** Everything the run spent. */
  readonly loop: SpendLineResource;
  /** The share tagged {@link VERIFICATION_TASK_KIND}. */
  readonly verification: SpendLineResource;
  /** The tag the verification line is summed by. */
  readonly verificationTag: string;
  /** The cap, or `null` when the budget stage's route sets none (or it pins a model). */
  readonly cap: SpendCapResource | null;
  /** Whether the loop is within the cap — `null` when that cannot honestly be said. */
  readonly withinCap: boolean | null;
}

/** The route a cap was read from, as the repository answers it. */
export interface RouteCapRow {
  /** `routes.tag`. */
  readonly tag: string;
  /** `routes.max_cost_cents_per_run`, or `null`. */
  readonly maxCostCentsPerRun: number | null;
}

/**
 * One line of the card from a ledger sum.
 *
 * @param totals - `readSpendTotals`'s answer.
 * @returns The line, tokens added up, the cost exactly as summed.
 */
export function spendLine(totals: SpendTotals): SpendLineResource {
  return {
    tokens: totals.tokensIn + totals.tokensOut,
    tokensIn: totals.tokensIn,
    tokensOut: totals.tokensOut,
    costCents: totals.costCents,
    unpricedEvents: totals.unpricedEvents,
  };
}

/**
 * Whether a loop is within its cap, by the table in this file's header.
 *
 * @param loop - The loop total.
 * @param capCents - The cap in cents, or `null`.
 * @returns `true`, `false`, or `null` when it cannot be said.
 */
export function withinCap(loop: SpendLineResource, capCents: number | null): boolean | null {
  if (loop.costCents === null || capCents === null) {
    return null;
  }

  const cost = Number(loop.costCents);

  if (cost > capCents) {
    return false;
  }

  return loop.unpricedEvents === 0 ? true : null;
}

/**
 * The card.
 *
 * @param loop - The run's whole ledger.
 * @param verification - The verification-tagged slice of it.
 * @param route - The budget stage's route, or `undefined`.
 * @returns The rollup.
 */
export function spendRollup(
  loop: SpendTotals,
  verification: SpendTotals,
  route: RouteCapRow | undefined,
): SpendRollupResource {
  const total = spendLine(loop);
  const cap =
    route === undefined || route.maxCostCentsPerRun === null
      ? null
      : { cents: route.maxCostCentsPerRun, routeTag: route.tag };

  return {
    loop: total,
    verification: spendLine(verification),
    verificationTag: VERIFICATION_TASK_KIND,
    cap,
    withinCap: withinCap(total, cap?.cents ?? null),
  };
}
