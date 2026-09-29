/**
 * The Spend card, as data ([#369](https://github.com/NobuData/ouroboros/issues/369)) — mockup 12's
 * spend rollup, from AX.5's payload ([#361](https://github.com/NobuData/ouroboros/issues/361)).
 *
 * ```
 * SPEND                                    Routing →
 * Loop total        284k tokens · $1.52    ← everything the PR's loop spent
 * Verification      41k · $0.19            ← the share tagged as verification
 * within $2.50 cap                         ← the budget stage's route
 * ```
 *
 * **Unpriced is not free** (decision M7) — the rule the run console's Resources card keeps, and
 * its helpers are the ones used here. Where nothing is priced the row is `284k tokens · —`, never
 * `$0.00`: zero reads as *free*, and the truth is *unknown*. A cost some of whose calls were not
 * priced is a lower bound, and says so. `$0.00` is drawn only for a ledger priced at zero.
 *
 * **The cap line says only what can be said.** `withinCap` is the service's verdict, and it is
 * `null` whenever the comparison would be a guess — nothing priced, a lower bound under the cap,
 * or no cap at all. Each of those is its own sentence; none of them is *within*.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { PrSpend, PrSpendLine } from "@/app/api/pull-requests";
import { moneyOfCents } from "@/app/format";
import { MODELS_PATH, ROUTING_MATRIX_HASH } from "@/app/paths";
import { UNKNOWN, centsOf, lowerBoundNote, tokenFigure } from "@/app/runs/cards";

/** The card's title — the mockup's `SPEND`. */
export const SPEND_TITLE = "Spend";

/** The head's link — the mockup's `Routing →`. */
export const ROUTING_LINK = "Routing →";

/** Where the link leads: the routing matrix, where a route's cap is set. */
export const ROUTING_HREF = `${MODELS_PATH}#${ROUTING_MATRIX_HASH}`;

/** The two rows' names. */
export const LOOP_LABEL = "Loop total";
export const VERIFICATION_LABEL = "Verification";

/** What a PR no loop opened says instead of rows. */
export const NO_LOOP_SPEND = "No loop opened this PR, so there is no spend to show.";

/** What a row nothing was spent on says. */
export const NONE_RECORDED = "none recorded";

/** What the cap line says when the route sets none. */
export const NO_CAP = "No cap is set on this loop's route.";

/** One row of the card. */
export interface SpendRowView {
  /** `Loop total`. */
  readonly label: string;
  /** `284k tokens · $1.52`, `284k tokens · —`, or {@link NONE_RECORDED}. */
  readonly figure: string;
  /** `lower bound — 3 calls unpriced`, or `null`. */
  readonly note: string | null;
  /** What a screen reader hears for the figure — the em-dash said as *not priced*. */
  readonly spoken: string;
}

/** The cap line. */
export interface SpendCapView {
  /** `within $2.50 cap`. */
  readonly text: string;
  /** `ok` within, `err` over, `neutral` when it cannot be said. */
  readonly tone: "ok" | "err" | "neutral";
}

/** The card. */
export interface SpendCardView {
  /** The rows, or none for a PR no loop opened. */
  readonly rows: readonly SpendRowView[];
  /** The cap line, or `null` with no rows. */
  readonly cap: SpendCapView | null;
  /** What is said instead of rows, or `null`. */
  readonly empty: string | null;
}

/**
 * One row.
 *
 * @param label The row's name.
 * @param line The payload's line.
 * @param unit Whether the count is followed by `tokens` — the loop's row is, as the mockup's.
 * @returns The row: the count and the cost, the count and an em-dash when nothing is priced, and
 *   {@link NONE_RECORDED} for a line with no usage at all — a count of nothing beside an em-dash
 *   would say that something unpriced was spent.
 */
export function spendRow(label: string, line: PrSpendLine, unit: boolean): SpendRowView {
  const cents = centsOf(line.costCents);

  if (line.tokens === 0 && cents === null && line.unpricedEvents === 0) {
    return { label, figure: NONE_RECORDED, note: null, spoken: NONE_RECORDED };
  }

  const count = `${tokenFigure(line.tokens)}${unit ? " tokens" : ""}`;
  const spokenCount = `${tokenFigure(line.tokens)} tokens`;

  if (cents === null) {
    return {
      label,
      figure: `${count} · ${UNKNOWN}`,
      note: null,
      spoken: `${spokenCount}, not priced`,
    };
  }

  const note = line.unpricedEvents > 0 ? lowerBoundNote(line.unpricedEvents) : null;
  const money = moneyOfCents(cents);

  return {
    label,
    figure: `${count} · ${money}`,
    note,
    spoken: note === null ? `${spokenCount}, ${money}` : `${spokenCount}, at least ${money}`,
  };
}

/**
 * The cap line.
 *
 * @param spend The payload.
 * @returns `within $2.50 cap`, `over $2.50 cap`, the cap beside why it cannot be compared, or
 *   {@link NO_CAP}. Never *within* unless the service said so.
 */
export function capLine(spend: PrSpend): SpendCapView {
  if (spend.cap === null) return { text: NO_CAP, tone: "neutral" };

  const cap = `${moneyOfCents(spend.cap.cents)} cap`;

  if (spend.withinCap === true) return { text: `within ${cap}`, tone: "ok" };
  if (spend.withinCap === false) return { text: `over ${cap}`, tone: "err" };

  const why =
    centsOf(spend.loop.costCents) === null
      ? "nothing the loop spent is priced"
      : "some of what the loop spent is not priced";

  return { text: `${cap} — not comparable: ${why}`, tone: "neutral" };
}

/**
 * The card for one PR.
 *
 * @param spend The payload's rollup, or `null` for a PR no loop opened.
 * @returns The card.
 */
export function spendCard(spend: PrSpend | null): SpendCardView {
  if (spend === null) return { rows: [], cap: null, empty: NO_LOOP_SPEND };

  return {
    rows: [
      spendRow(LOOP_LABEL, spend.loop, true),
      spendRow(VERIFICATION_LABEL, spend.verification, false),
    ],
    cap: capLine(spend),
    empty: null,
  };
}
