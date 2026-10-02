/**
 * Every decision the model scoreboard makes, and every sentence it says
 * (BK.4, [#445](https://github.com/NobuData/ouroboros/issues/445)).
 *
 * The scoreboard is a **routing decision surface**: somebody will re-route a task kind on what it
 * shows. So the details that keep a reader from acting on noise are decided here, each a unit test
 * on a small value:
 *
 * - **Low-sample rows carry a badge.** A model with three merges at 100 % untouched is noise; the
 *   service flags rows under its `minSample` and the row says so, with the threshold.
 * - **Fallback rows name their hop.** A fallback's numbers describe the cases where the primary
 *   already failed, so a lower untouched rate there is expected rather than damning.
 * - **`$ / success` is honest about pricing** (decision I8): dollars only when every token was
 *   priced — `$0.00` for a local model priced at zero — tokens per success when any was not, and
 *   `—` when there is nothing to divide.
 * - **The trend arrow is coloured by goodness, not by sign.** It is the row's untouched rate
 *   against the prior window's, and more untouched merges is better, so `▲` is good news.
 *
 * ### The suggestion is AB.3's, never composed here
 *
 * The suggestion row renders learned routing suggestion AB.3's payload
 * ([#209](https://github.com/NobuData/ouroboros/issues/209)), which the service passes through
 * untouched and leaves **absent** until AB.3 exists. Its shape is AB.3's to define, so it is read
 * defensively: a payload with a `claim` sentence draws the band — with `monthlySavingCents` as its
 * saving estimate and `taskKind` as the deep link's target when present — and anything else draws
 * nothing. Composing plausible advice locally would be the page inventing a recommendation a
 * person would act on.
 *
 * **Framework-free and pure.**
 */

import type { Scoreboard, ScoreboardRow } from "@/app/api/insights";
import { tokenCount, moneyOfCents } from "@/app/format";
import { ROUTE_PARAM } from "@/app/models/matrix";
import { MODELS_PATH } from "@/app/paths";

import { wholeDollars } from "./series-view";
import { NOT_MEASURED } from "./view";

/* ------------------------------------------------------------------ the frame */

/** The card's heading, from the mockup. */
export const SCOREBOARD_TITLE = "Model scoreboard";

/** The head's link to the routing table, from the mockup. */
export const ROUTING_RULES_LABEL = "Routing rules →";

/** The suggestion band's deep link, from the mockup. */
export const APPLY_LABEL = "Apply in Models →";

/** The table's accessible caption. */
export const SCOREBOARD_CAPTION = "Merge-untouched rate and cost per success, by task and serving model";

/** The column headings, from the mockup. */
export const COLUMN = {
  task: "Task",
  model: "Model",
  untouched: "Merge-untouched %",
  cost: "$ / success",
  trend: "Trend",
} as const;

/** The empty state: a range with no merged loop has no row to rank. */
export const NO_SCOREBOARD = {
  title: "No loop merged in this range",
  note: "Each task kind's serving model is ranked here once its loops merge.",
} as const;

/* ------------------------------------------------------------------ a row */

/** The mark a low-sample row carries. */
export const LOW_SAMPLE = "low sample";

/** What a `$ / success` cell says, and how. */
export interface CostCell {
  /** The figure — `$0.87`, `$0.00`, `41.2k tok`, or {@link NOT_MEASURED}. */
  readonly text: string;
  /** A tooltip saying what the figure is, when it is not plain dollars. */
  readonly note: string | null;
}

/** How a trend arrow is coloured: good news, bad news, or no judgement. */
export type TrendTone = "up" | "down" | "muted";

/** The trend cell. */
export interface TrendCell {
  /** `▲`, `▼` or `—`. */
  readonly glyph: string;
  /** How it is coloured: by goodness, never by sign. */
  readonly tone: TrendTone;
  /** The trend in words — what a screen reader hears in the glyph's place. */
  readonly label: string;
}

/** One scoreboard row, ready to draw. */
export interface ScoreboardRowView {
  /** A stable key: task × model × hop. */
  readonly key: string;
  /** The task kind. */
  readonly task: string;
  /** The hop annotation on a fallback row — `fallback · hop 2` — or `null` on a primary. */
  readonly role: string | null;
  /** The serving model, opaque. */
  readonly model: string;
  /** The untouched rate as a 0–1 fraction for the meter, or `null` when nothing merged. */
  readonly untouched: number | null;
  /** The untouched rate as drawn — `84%` or {@link NOT_MEASURED}. */
  readonly untouchedText: string;
  readonly cost: CostCell;
  readonly trend: TrendCell;
  /** The low-sample badge's tooltip, or `null` on a row with enough merges. */
  readonly lowSample: string | null;
}

/**
 * The hop annotation — the mockup's `implement (fallback)`, with the hop it served from.
 *
 * @param row The row.
 * @returns `fallback · hop 2`, or `null` for the primary.
 */
export function roleNote(row: ScoreboardRow): string | null {
  return row.role === "fallback" ? `fallback · hop ${row.hop}` : null;
}

/**
 * The `$ / success` cell.
 *
 * @param cost The row's cost.
 * @returns The figure and, when it is not plain dollars, what it is.
 */
export function costCell(cost: ScoreboardRow["cost"]): CostCell {
  switch (cost.pricing) {
    case "priced":
      return cost.centsPerSuccess === null
        ? { text: NOT_MEASURED, note: "Nothing merged to divide the spend by." }
        : { text: moneyOfCents(cost.centsPerSuccess), note: null };
    case "unpriced":
      return cost.tokensPerSuccess === null
        ? { text: NOT_MEASURED, note: "Nothing merged to divide the tokens by." }
        : {
            text: `${tokenCount(cost.tokensPerSuccess)} tok`,
            note: "Tokens per success: some of this usage has no price, so no dollar figure is claimed.",
          };
    case "none":
      return { text: NOT_MEASURED, note: "No usage was recorded for this task kind in the range." };
  }
}

/**
 * The untouched rate's polarity: more merges with no human edit is better, so a rise is good news.
 * Written once so the arrow's colour is a statement about the metric, not about the glyph.
 */
const UNTOUCHED_RISE_IS_GOOD = true;

/**
 * The trend cell — the untouched rate against the prior window's, coloured by goodness.
 *
 * @param trend The row's trend.
 * @returns The glyph, its tone and its words.
 */
export function trendCell(trend: ScoreboardRow["trend"]): TrendCell {
  if (trend.direction === "flat" || trend.delta === null) {
    return {
      glyph: NOT_MEASURED,
      tone: "muted",
      label: trend.delta === null ? "No prior range to compare" : "No change on the prior range",
    };
  }

  const rose = trend.direction === "up";
  const good = rose === UNTOUCHED_RISE_IS_GOOD;
  const points = Math.round(Math.abs(trend.delta));

  return {
    glyph: rose ? "▲" : "▼",
    tone: good ? "up" : "down",
    label: `${rose ? "Up" : "Down"} ${points}pts on the prior range`,
  };
}

/**
 * One row.
 *
 * @param row The row, as served.
 * @param minSample The service's low-sample threshold.
 * @returns What the table draws.
 */
export function scoreboardRow(row: ScoreboardRow, minSample: number): ScoreboardRowView {
  return {
    key: `${row.taskKind}|${row.model}|${row.hop}`,
    task: row.taskKind,
    role: roleNote(row),
    model: row.model,
    untouched: row.untouchedRate === null ? null : row.untouchedRate / 100,
    untouchedText: row.untouchedRate === null ? NOT_MEASURED : `${Math.round(row.untouchedRate)}%`,
    cost: costCell(row.cost),
    trend: trendCell(row.trend),
    lowSample: row.lowSample
      ? `${row.merged} ${row.merged === 1 ? "merge" : "merges"} — fewer than ${minSample}, too few to route on.`
      : null,
  };
}

/* ------------------------------------------------------------------ the column popovers */

/** One column popover: the column it explains and the registry's words. */
export interface ColumnNote {
  /** The heading it opens from. */
  readonly label: string;
  /** What it says. */
  readonly text: string;
}

/**
 * The two column popovers: the untouched definition (I6 — the KPI row's own entry) and the
 * `$ / success` denominator, both the registry's formula, never written here.
 *
 * @param methodology The scoreboard's per-column registry entries.
 * @returns The popover for each column.
 */
export function columnNotes(methodology: Scoreboard["methodology"]): {
  untouched: ColumnNote;
  cost: ColumnNote;
} {
  return {
    untouched: { label: COLUMN.untouched, text: methodology.untouched.formula },
    cost: { label: COLUMN.cost, text: methodology.costPerSuccess.formula },
  };
}

/* ------------------------------------------------------------------ the suggestion */

/** The suggestion band, ready to draw. */
export interface SuggestionView {
  /** AB.3's claim, verbatim. */
  readonly claim: string;
  /** Its saving estimate — `would save ~$14/mo` — or `null` when it carries none. */
  readonly saving: string | null;
  /** Where `Apply in Models →` goes: the routing table, on the suggestion's task when it names one. */
  readonly href: string;
}

/**
 * The suggestion band, from AB.3's payload — or nothing.
 *
 * @param payload `scoreboard.suggestion`, absent until AB.3 exists.
 * @returns The band, or `null` when the payload is absent or carries no claim to show.
 */
export function suggestionView(payload: Scoreboard["suggestion"]): SuggestionView | null {
  if (payload === undefined) return null;

  const { claim, monthlySavingCents, taskKind } = payload;

  if (typeof claim !== "string" || claim.trim() === "") return null;

  const saving =
    typeof monthlySavingCents === "number" && Number.isFinite(monthlySavingCents) && monthlySavingCents > 0
      ? `would save ~${wholeDollars(monthlySavingCents)}/mo`
      : null;
  const href =
    typeof taskKind === "string" && taskKind.trim() !== ""
      ? `${MODELS_PATH}?${ROUTE_PARAM}=${encodeURIComponent(taskKind)}`
      : MODELS_PATH;

  return { claim: claim.trim(), saving, href };
}
