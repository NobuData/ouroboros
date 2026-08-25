/**
 * Every decision the **Spend by provider · 30d** card makes, as functions with inputs and
 * outputs.
 *
 * The card ([#204](https://github.com/NobuData/ouroboros/issues/204)) renders money, and money
 * is the one thing on this page a reader will act on without checking. Which is why almost
 * nothing about it is markup: what a row is called, what its figure says, how wide its meter
 * is, and what the footnote claims are all *judgements*, and they live here so each one's
 * acceptance criteria are a unit test on a small object rather than an assertion about
 * rendered text.
 *
 * **Framework-free and pure**, like `app/models/matrix.ts` beside it: nothing here imports
 * React, `next/*` or the server-only client. The read is `app/models/data.ts`'s — the card
 * rides on the same `GET /api/v1/routing` payload as the matrix, for the reason
 * `app/api/routing.ts` gives — and the drawing is `app/models/spend-card.tsx`'s.
 *
 * ### The two ways a spend card lies, and what stops each
 *
 * 1. **It prints `$0.00` for money nobody counted.** Z.5 ([#198](https://github.com/NobuData/ouroboros/issues/198))
 *    keeps two states apart structurally — `spendCents: 0` is calls **priced at nothing**,
 *    `spendCents: null` is calls **nobody priced** — and nothing here coalesces them. A null
 *    amount renders as the word {@link UNPRICED} in its own treatment, never as a figure, and
 *    a row carrying *both* facts (a local provider whose routed calls cost nothing and whose
 *    earlier calls carry no price) says both. That is DASH-J.4's
 *    ([#92](https://github.com/NobuData/ouroboros/issues/92)) distinction, carried onto this
 *    surface.
 * 2. **It draws a row of zeros for a workspace that has spent nothing.** The contract answers
 *    an empty `providers` for that, and {@link spendRows} passes the emptiness through: the
 *    card's zero-state is `EmptyState` copy, not four meters at `$0.00`.
 *
 * ### What is deliberately not the mockup's
 *
 * Mockup 06 names its local row *Local (vLLM + Ollama)*. The ledger records a provider
 * **kind** (`openai_compatible`), not the product behind it — the seeded connection happens
 * to be vLLM, but the row is a sum over every OpenAI-compatible endpoint the workspace ever
 * spent through, and naming it after one of them would be a claim the data does not make.
 * So the row is named from its kinds, in the order the service sorts them:
 * *Local (Ollama + OpenAI-compatible)*. Recorded in `docs/ROADMAP_MOCKUP_06_MODEL_ROUTING.md`.
 */

import type { ProviderKind, ProviderSpend, RoutingSpend } from "@/app/api/routing";
import { moneyOfCents } from "@/app/format";

import { SEPARATOR } from "./view";

/* ------------------------------------------------------------------ what a row is called */

/**
 * What each provider kind the contract can name is called on this card.
 *
 * The vocabulary is V015's (`ProviderConnectionKind`), and the names are the ones mockup 06
 * and mockup 07 print for the same kinds. A `Record` over the closed union rather than a
 * lookup with a fallback, so a seventh kind added to the contract is a build error here
 * rather than a row that quietly prints its raw spelling.
 */
const KIND_NAMES: Readonly<Record<ProviderKind, string>> = {
  anthropic: "Anthropic",
  copilot: "GitHub Copilot",
  cursor: "Cursor",
  ollama: "Ollama",
  openai_compatible: "OpenAI-compatible",
  custom: "Custom",
};

/**
 * The name of one provider kind.
 *
 * The ledger's `provider` column is free text with no reference to V015 (decision **F8** —
 * retiring a connection must not rewrite the ledger that recorded spending through it), so a
 * kind the vocabulary no longer admits is a real value here. It is printed as it was recorded
 * rather than dropped: a row whose name is `vertex` tells the reader where the money went,
 * and a row named *Unknown* tells them nothing.
 *
 * @param kind A `token_usage.provider` value.
 * @returns Its name, or the value itself for one this vocabulary does not know.
 */
export function kindName(kind: string): string {
  return Object.hasOwn(KIND_NAMES, kind) ? KIND_NAMES[kind as ProviderKind] : kind;
}

/** How the kinds folded into one row are joined in its name — the mockup's `vLLM + Ollama`. */
const KIND_JOIN = " + ";

/**
 * A row's name.
 *
 * @param row The row.
 * @returns The mockup's `Anthropic` for a cloud row, and `Local (…)` naming every kind the
 *   local row sums for the one the service folds together.
 */
export function providerName(row: ProviderSpend): string {
  const kinds = row.kinds.map(kindName).join(KIND_JOIN);

  return row.local ? `Local (${kinds})` : kinds;
}

/* ------------------------------------------------------------------ what a row says */

/**
 * What an unpriced row prints where its amount would be.
 *
 * A word rather than an em-dash, deliberately. The matrix's em-dash means *nobody measured
 * this*; an unpriced row **was** measured — the calls and their tokens are in the ledger —
 * and what is missing is a price for them, which is a different fact and one the reader can
 * do something about (mockup 07's price table). The word says which fact it is.
 */
export const UNPRICED = "unpriced";

/**
 * The narrowest a priced row's meter is drawn.
 *
 * The contract serves `meterFraction: 0` as the honest width of a row that really did cost
 * nothing, and says the visible minimum is the card's own. This is that minimum: mockup 06
 * draws its `$0.00` local row with a 2% sliver so the ok-meter treatment is *visible* — a
 * track with no fill would make *priced at nothing* and *not drawn* the same picture. The
 * figure beside the meter is what carries the value; the sliver only says a meter is there.
 */
export const METER_FLOOR = 0.02;

/** Which fill a row's meter takes — the primitive's `ok` for the local row, else the accent. */
export type SpendMeterTone = "accent" | "ok";

/** One metered row of the card, decided. */
export interface SpendRow {
  /** The row's identity from the contract — the React key. */
  readonly key: string;
  /** What the row is called. */
  readonly name: string;
  /**
   * The amount, or `null` for a row nobody priced.
   *
   * Null rather than {@link UNPRICED} here so the component draws the two differently: an
   * amount is a mono figure, and the word is a state.
   */
  readonly amount: string | null;
  /**
   * The meter's width, 0–1, or `null` for a row with nothing priced to draw.
   *
   * Null means *no meter*, not an empty one — the component draws the unpriced track in its
   * place, which is the state made visible.
   */
  readonly meter: number | null;
  /** The meter's fill. */
  readonly tone: SpendMeterTone;
  /**
   * How many of the row's calls carry no price, when any do — or `null` when every call was
   * priced.
   *
   * Carried beside the amount rather than folded into it, so `$0.00` from 260 priced calls
   * and five unpriced ones says both.
   */
  readonly unpriced: string | null;
}

/**
 * The note printed beside an amount that is a floor rather than a total.
 *
 * @param calls How many calls in the window carry no price. Must be above zero — a row with
 *   none has no note, and the caller decides that.
 * @returns `5 unpriced calls`, singular where it is one.
 */
export function unpricedNote(calls: number): string {
  return `${calls} unpriced call${calls === 1 ? "" : "s"}`;
}

/**
 * A row's meter width.
 *
 * @param fraction The contract's `meterFraction`.
 * @returns The width to draw, floored at {@link METER_FLOOR} for a priced row, or `null` for
 *   a row with nothing priced — which is drawn as no meter at all.
 */
export function meterWidth(fraction: number | null): number | null {
  return fraction === null ? null : Math.max(fraction, METER_FLOOR);
}

/**
 * One row, decided.
 *
 * @param row The row as `GET /api/v1/routing` serves it.
 * @returns The row as the card draws it.
 */
export function spendRow(row: ProviderSpend): SpendRow {
  return {
    key: row.key,
    name: providerName(row),
    amount: row.spendCents === null ? null : moneyOfCents(row.spendCents),
    meter: meterWidth(row.meterFraction),
    tone: row.local ? "ok" : "accent",
    unpriced: row.unpricedCalls > 0 ? unpricedNote(row.unpricedCalls) : null,
  };
}

/**
 * The card's rows, in the order the service sends them — largest spend first, unpriced rows
 * last.
 *
 * Not sorted again here: the meters are widths relative to the largest row, and the service
 * computed both the widths and the order from one snapshot. A second opinion about order
 * would put a wider meter under a narrower one the first time two rows tied.
 *
 * @param spend The card's payload.
 * @returns One decided row per provider. Empty for a workspace that has spent nothing, which
 *   is the card's zero-state and not four rows of `$0.00`.
 */
export function spendRows(spend: RoutingSpend): readonly SpendRow[] {
  return spend.providers.map(spendRow);
}

/* ------------------------------------------------------------------ the footnote */

/**
 * The share of the window's tokens local models served, as the footnote prints it.
 *
 * **`null` and `0` are different sentences**, and only the first is silence: a window holding
 * no tokens has no share to report, while a window in which nothing ran locally served `0%`
 * of them — a true statement about a workspace that routes everything to the cloud.
 *
 * A share too small to round to a whole percent is drawn as `<1%` rather than `0%`, because
 * `0%` would say nothing ran locally when something did — the same reason
 * `app/format.ts`'s latency formatter refuses to print `0.0s` for a call that took time.
 *
 * @param share The contract's `localTokenShare`, 0–1 or `null`.
 * @returns The percentage as printed, or `null` when there is nothing to say.
 */
export function localSharePercent(share: number | null): string | null {
  if (share === null) return null;

  const percent = Math.round(share * 100);
  return share > 0 && percent === 0 ? "<1%" : `${percent}%`;
}

/**
 * The footnote — mockup 06's *"Local models served 31% of all tokens."*
 *
 * @param spend The card's payload.
 * @returns The sentence, or `null` when the window holds no tokens and there is no share to
 *   claim. The component draws nothing for null rather than an empty line.
 */
export function localShareNote(spend: RoutingSpend): string | null {
  const percent = localSharePercent(spend.localTokenShare);

  return percent === null ? null : `Local models served ${percent} of all tokens.`;
}

/* ------------------------------------------------------------------ the copy */

/**
 * The card's title, from the window it was measured over — mockup 06's
 * *SPEND BY PROVIDER · 30D*.
 *
 * Computed from `window.days` rather than written down, so the title and the figures cannot
 * disagree about the span: a service that widened the window would widen the title with it.
 *
 * @param days How many days wide the window is.
 * @returns The title.
 */
export function spendTitle(days: number): string {
  return `Spend by provider${SEPARATOR}${days}d`;
}

/** The link the mockup draws in the card head. */
export const FULL_REPORT = "Full report →";

/**
 * Why **Full report →** does not go anywhere yet.
 *
 * The report is AB.4's ([#210](https://github.com/NobuData/ouroboros/issues/210)) and does
 * not exist, so the control is inert and says so rather than linking to a `404` — the same
 * treatment the Models tab set gives the Spend tab, in the same words, so the two ways of
 * reaching the report agree about when it arrives.
 */
export const FULL_REPORT_REASON = "The full spend report arrives with #210.";

/** What the card says to a workspace that has spent nothing in the window. */
export const NO_SPEND_TITLE = "No spend recorded";

/**
 * …and what that means, without pretending it is `$0.00`.
 *
 * @param days How many days wide the window is.
 * @returns The note.
 */
export function noSpendNote(days: number): string {
  return (
    `Nothing routed through a provider in the last ${days} days. The meters and the local ` +
    "share appear here once a loop has run."
  );
}
