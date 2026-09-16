/**
 * The generator card's footer — `est. total ~3 days of loop time · $14 est. spend` — as a pure
 * function of the drafts' estimates and the rates that price them.
 *
 * AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)), decision **N10**: pricing honesty.
 *
 * **Loop time is real.** It is the sum of `breakdown.est_minutes` over the selected drafts that have
 * an estimate — the number the estimator produced and the queue plans with — divided into days. An
 * unsized draft contributes nothing and is visible as `sizedCount < selectedCount` rather than as a
 * guess.
 *
 * **`$` appears only when a rate exists.** A draft is *priced* when its routed model resolves, through
 * `ouroboros.model_price()`, to a `token` rate (costed at its **input** rate, a lower bound, because
 * `est_tokens` is one number with no input/output split) or to a `free` rate (a real zero). A
 * `seat` or `usage` rate, or no rate at all, is *unpriced*. When no sized draft is priced, the
 * summary carries **no `spend` key at all** — never `$0`, which would claim *free* for *unknown*.
 * When some are, the figure is the priced subtotal and `partial: true` says it is a floor.
 */

import type { BillingMode } from "../db/schema";
import type { BatchSpendResource, BatchSummaryResource } from "./planning.resources";

/** Minutes in a day of loop time — the loop runs around the clock. */
export const MINUTES_PER_DAY = 24 * 60;

/** Tokens a per-1M rate is quoted over. */
export const TOKENS_PER_RATE = 1_000_000;

/** One draft, as the footer reads it. */
export interface SummaryDraft {
  /** Whether a push would include it. */
  readonly selected: boolean;
  /** Its estimate in force, or null. */
  readonly estimate: {
    readonly estMinutes: number;
    readonly estTokens: number;
    readonly estimator: string;
  } | null;
  /** The rate its routed model resolved to, or null when nothing covers it. */
  readonly price: {
    readonly billingMode: BillingMode;
    /** Cents per 1M input tokens, as `numeric` text, or null. */
    readonly inputCentsPer1m: string | null;
  } | null;
}

/**
 * The footer.
 *
 * @param drafts - Every draft of the batch.
 * @returns The counts, the loop time, and the spend only when something is priced.
 */
export function batchSummary(drafts: readonly SummaryDraft[]): BatchSummaryResource {
  const selected = drafts.filter((draft) => draft.selected);
  const sized = selected.filter((draft) => draft.estimate !== null);
  const estMinutes = sized.reduce((sum, draft) => sum + (draft.estimate?.estMinutes ?? 0), 0);
  const estimators = [...new Set(sized.map((draft) => draft.estimate?.estimator ?? ""))].sort();
  const spend = spendOf(sized);

  return {
    draftCount: drafts.length,
    selectedCount: selected.length,
    sizedCount: sized.length,
    allSized: selected.length > 0 && sized.length === selected.length,
    estimators,
    estMinutes,
    loopDays: Math.round((estMinutes / MINUTES_PER_DAY) * 10) / 10,
    ...(spend === undefined ? {} : { spend }),
  };
}

/**
 * The spend over sized drafts, or undefined when none is priced.
 *
 * @param sized - The selected drafts with an estimate.
 * @returns The spend, or undefined.
 */
function spendOf(sized: readonly SummaryDraft[]): BatchSpendResource | undefined {
  let cents = 0;
  let priced = 0;

  for (const draft of sized) {
    const rate = rateOf(draft.price);

    if (rate === undefined || draft.estimate === null) {
      continue;
    }

    priced += 1;
    cents += (draft.estimate.estTokens * rate) / TOKENS_PER_RATE;
  }

  if (priced === 0) {
    return undefined;
  }

  const rounded = Math.round(cents);

  return { cents: rounded, display: formatDollars(rounded), partial: priced < sized.length };
}

/**
 * The per-1M rate a price costs tokens at, or undefined when it does not price tokens.
 *
 * @param price - The resolved price, or null.
 * @returns Cents per 1M tokens — the input rate for `token`, zero for `free` — or undefined.
 */
export function rateOf(price: SummaryDraft["price"]): number | undefined {
  if (price === null) {
    return undefined;
  }

  if (price.billingMode === "free") {
    return 0;
  }

  if (price.billingMode !== "token" || price.inputCentsPer1m === null) {
    return undefined;
  }

  const rate = Number(price.inputCentsPer1m);

  return Number.isFinite(rate) ? rate : undefined;
}

/**
 * Cents as the footer prints them.
 *
 * @param cents - Whole cents.
 * @returns `$14` from ten dollars up, `$4.20` below — an estimate's precision, not an invoice's.
 */
export function formatDollars(cents: number): string {
  return cents >= 1000 ? `$${String(Math.round(cents / 100))}` : `$${(cents / 100).toFixed(2)}`;
}
