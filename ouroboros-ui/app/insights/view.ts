/**
 * Every decision the insights head and KPI row make, and every sentence they say
 * (BK.2, [#443](https://github.com/NobuData/ouroboros/issues/443)).
 *
 * Mockup 15's frame is a head whose title is two live numbers in a sentence, three actions and
 * five KPI cards. What those draw is a handful of judgements — how the sentence reads at one and
 * at zero, which way round good news is coloured, what a card says when there is nothing to
 * compare — and each lives here so its acceptance criterion is a unit test on a small value
 * rather than an assertion about markup.
 *
 * **Framework-free and pure**, the way `app/farm/view.ts` is: nothing here imports React,
 * `next/*` or the server-only client.
 *
 * ### Goodness, not sign
 *
 * A delta's colour is whether the move is **good**, never which way it points: `▼ 2m faster` on
 * the median cycle is good news and `▼` on the merge rate would be bad. That judgement is the
 * service's — BJ.2 sends `trend.good` from each metric's polarity
 * ([#438](https://github.com/NobuData/ouroboros/issues/438)) — and this module only maps it to a
 * tone, so the page cannot come to disagree with the digest or the API about which way is up.
 *
 * ### `null` is not `0`
 *
 * A figure nobody measured is {@link NOT_MEASURED}, never `0%` or `$0.00`, and a figure with no
 * prior window to compare against says so rather than claiming `▲ 0`.
 */

import type { InsightsHead, InsightsKpi, InsightsRange, MetricMethodology } from "@/app/api/insights";
import { moneyOfCents, spanOfMs, tokenCount } from "@/app/format";
import type { StatTone, StatValueTone } from "@/app/ui/stat-card";

import { RANGE_DAYS } from "./range";

/* ------------------------------------------------------------------ the head */

/** The eyebrow over the heading, verbatim from the mockup. */
export const INSIGHTS_EYEBROW = "Insights";

/** The subline under the heading, verbatim from the mockup. */
export const INSIGHTS_SUBLINE =
  "Every loop measured: what merged untouched, what it cost, where humans still step in.";

/**
 * The heading of a page that could not be read at all — the same two beats with no number
 * claimed in either. It does not say *could not be read*: that is the banner's, once, with the
 * reason and the retry (`app/insights/insights-banner.tsx`).
 */
export const INSIGHTS_HEADLINE_UNREAD = "PRs merged this week. Humans who stepped in.";

/** The first sentence over a week with no merges — a sentence, not a bare `0 PRs`. */
export const NO_MERGES = "No PRs merged this week.";

/** The second sentence over a week with merges and no intervention. */
export const NONE_NEEDED_A_HUMAN = "None needed a human.";

/** The second sentence over a week with no merges and no intervention: a quiet week, said so. */
export const NOTHING_NEEDED_A_HUMAN = "Nothing needed a human.";

/**
 * The page heading — mockup 15's `27 PRs merged this week. 2 needed a human.`
 *
 * **Two live numbers in a sentence**, and both are always the last seven days — the head's
 * window is fixed by the service whatever range the cards below show (`InsightsHead.range`), so
 * *this week* is true at every range. Each clause pluralizes and degrades on its own: `1 PR
 * merged`, `1 needed a human`, and a week of zeros reads *No PRs merged this week. Nothing needed
 * a human.* — intentional rather than broken.
 *
 * @param head The head's numbers, or `null` when nothing has been read.
 * @returns The heading.
 */
export function insightsHeadline(head: InsightsHead | null): string {
  if (head === null) return INSIGHTS_HEADLINE_UNREAD;

  const { mergedPrs, interventions } = head;
  const merged =
    mergedPrs <= 0
      ? NO_MERGES
      : `${mergedPrs} ${mergedPrs === 1 ? "PR" : "PRs"} merged this week.`;
  const humans =
    interventions > 0
      ? `${interventions} needed a human.`
      : mergedPrs > 0
        ? NONE_NEEDED_A_HUMAN
        : NOTHING_NEEDED_A_HUMAN;

  return `${merged} ${humans}`;
}

/* ------------------------------------------------------------------ the head's actions */

/** The mark an unbuilt control carries in its text, as the sidebar's *soon* rows do. */
export const SOON_MARK = "soon";

/** One of the head's actions. */
export interface InsightsAction {
  /** A stable key. */
  readonly id: "analyzer" | "digest" | "slack";
  /** The button's text, verbatim from the mockup. */
  readonly label: string;
  /** Why it cannot be used yet — its tooltip — naming the issue that builds it. */
  readonly soonNote: string;
}

/**
 * The head's three actions, in the mockup's order — **each honestly unavailable today**.
 *
 * - **✦ Build Analyzer** is mockup 18, whose route is BW.1
 *   ([#516](https://github.com/NobuData/ouroboros/issues/516)); the amendment on #443 turns it
 *   into a link when that route lands.
 * - **Email weekly digest** opens BK.6's subscribe flow
 *   ([#447](https://github.com/NobuData/ouroboros/issues/447)), which is not built.
 * - **Send to Slack** is chat-ops' card publisher, BZ.2
 *   ([#536](https://github.com/NobuData/ouroboros/issues/536)), per the amendment on #443.
 *
 * Each is an inert button with the reason as its tooltip rather than a control that does
 * nothing when pressed.
 */
export const INSIGHTS_ACTIONS: readonly InsightsAction[] = [
  { id: "analyzer", label: "✦ Build Analyzer", soonNote: "The Build Analyzer arrives with #516." },
  { id: "digest", label: "Email weekly digest", soonNote: "Digest subscriptions arrive with #447." },
  { id: "slack", label: "Send to Slack", soonNote: "Slack sends arrive with #536." },
];

/* ------------------------------------------------------------------ the KPI row */

/** What a figure nobody measured is drawn as. */
export const NOT_MEASURED = "—";

/** The line under a card whose figure could not be measured in the window. */
export const NOTHING_MEASURED = "Nothing measured in this range yet.";

/** The *Merged w/o human edits* card's line, verbatim from the mockup: what the share is of. */
export const UNTOUCHED_CONTEXT = "of all merged PRs";

/** One KPI card, ready for `StatCard`. */
export interface KpiCardView {
  /** The card's key — stable across ranges. */
  readonly key: InsightsKpi["key"];
  /** The caption, and the card's accessible name. */
  readonly label: string;
  /** The figure, formatted, or {@link NOT_MEASURED}. */
  readonly value: string;
  /** The fainter rest of the figure — `/wk` — or `null`. */
  readonly valueSuffix: string | null;
  /** Whether the figure takes the accent — the merge rate, as the mockup draws it. */
  readonly accent: boolean;
  /** The figure's hue, when it has one — interventions in the warn hue while there are any. */
  readonly valueTone: StatValueTone | null;
  /** The line under the figure. */
  readonly delta: string;
  /** How that line is coloured — by goodness, never by sign. */
  readonly tone: StatTone;
  /** The registry entry the label's popover prints. */
  readonly methodology: MetricMethodology;
}

/** Each card's caption, verbatim from the mockup. */
const KPI_LABEL: Readonly<Record<InsightsKpi["key"], string>> = {
  autonomous_merge_rate: "Autonomous merge rate",
  merged_untouched_rate: "Merged w/o human edits",
  cycle_time: "Median cycle",
  cost_per_merged_pr: "Cost per merged PR",
  human_interventions: "Human interventions",
};

/**
 * The cost card's caption when no price covers the usage: the service answers in tokens per
 * merged PR (BJ.2), and the caption says what the figure now is rather than keeping a `$` label.
 */
export const TOKENS_PER_MERGED_PR = "Tokens per merged PR";

/** Days in a week — what a window's intervention count is scaled to. */
const DAYS_PER_WEEK = 7;

/** The suffix a per-week figure wears, as the mockup's `2/wk`. */
export const PER_WEEK = "/wk";

/**
 * A number short enough for a card — whole from ten up, one decimal below, and no `.0`.
 *
 * @param value A non-negative number.
 * @returns `14`, `2.4`, `2`.
 */
function brief(value: number): string {
  return value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
}

/**
 * A count over a window, as a rate per week — the mockup's `2/wk`.
 *
 * @param count The count over the window.
 * @param range The window.
 * @returns The weekly rate.
 */
export function perWeek(count: number, range: InsightsRange): number {
  return (count * DAYS_PER_WEEK) / RANGE_DAYS[range];
}

/**
 * A weekly rate short enough for a card — whole from one up (`2`, as the mockup's `2/wk`), one
 * decimal below it (`0.4`), so a quiet workspace is not rounded to a flat zero.
 *
 * @param count The count over the window.
 * @param range The window.
 * @returns The rate, without its `/wk`.
 */
function weekly(count: number, range: InsightsRange): string {
  const rate = perWeek(count, range);

  return rate >= 1 ? String(Math.round(rate)) : brief(rate);
}

/**
 * A percentage-point move — `3pts`, `0.4pts`.
 *
 * @param points The size of the move, non-negative.
 * @returns It, with its unit.
 */
function pointsOf(points: number): string {
  return `${points >= 1 ? Math.round(points) : brief(points)}pts`;
}

/**
 * A card's figure, in its unit.
 *
 * @param kpi The card.
 * @param range The window — what a per-week figure is scaled by.
 * @returns The figure, without its suffix.
 */
function figureOf(kpi: InsightsKpi, range: InsightsRange): string {
  const { value } = kpi;

  if (value === null) return NOT_MEASURED;
  if (kpi.key === "human_interventions") return weekly(value, range);

  switch (kpi.unit) {
    case "pct":
      return `${Math.round(value)}%`;
    case "duration_ms":
      return spanOfMs(value);
    case "cents":
      return moneyOfCents(value);
    case "tokens":
      return tokenCount(value);
    case "count":
      return brief(value);
  }
}

/**
 * The size of a card's move, in its unit and without a direction.
 *
 * @param kpi The card. Its `delta` is not null.
 * @param size The move's absolute size.
 * @param range The window.
 * @returns `3pts`, `2m`, `$0.41`, `3.1k tokens`, `1.2/wk`.
 */
function magnitudeOf(kpi: InsightsKpi, size: number, range: InsightsRange): string {
  if (kpi.key === "human_interventions") return `${weekly(size, range)}${PER_WEEK}`;

  switch (kpi.unit) {
    case "pct":
      return pointsOf(size);
    case "duration_ms":
      return spanOfMs(size);
    case "cents":
      return moneyOfCents(size);
    case "tokens":
      return `${tokenCount(size)} tokens`;
    case "count":
      return brief(size);
  }
}

/**
 * The line under a card's figure.
 *
 * - *Merged w/o human edits* says what its share is of, as the mockup does.
 * - A figure nobody measured says so; a figure with no prior window says there is nothing to
 *   compare; a figure that did not move says *no change*.
 * - Otherwise the arrow is the direction, the size is in the card's unit, and the comparison
 *   names the prior window — except the median cycle, which says *faster* or *slower*, as the
 *   mockup's `▼ 2m faster` does.
 *
 * @param kpi The card.
 * @param range The window.
 * @returns The line.
 */
function deltaOf(kpi: InsightsKpi, range: InsightsRange): string {
  if (kpi.key === "merged_untouched_rate") return UNTOUCHED_CONTEXT;
  if (kpi.value === null) return NOTHING_MEASURED;
  if (kpi.delta === null) return `No prior ${range} to compare.`;
  if (kpi.trend.direction === "flat" || kpi.delta === 0) return `No change vs prior ${range}`;

  const arrow = kpi.delta > 0 ? "▲" : "▼";
  const size = magnitudeOf(kpi, Math.abs(kpi.delta), range);

  if (kpi.key === "cycle_time") return `${arrow} ${size} ${kpi.delta < 0 ? "faster" : "slower"}`;

  return `${arrow} ${size} vs prior ${range}`;
}

/**
 * The tone of a card's line — goodness, from the service's `trend.good`.
 *
 * @param kpi The card.
 * @returns `up` for good news, `down` for bad, `muted` for no judgement.
 */
export function toneOf(kpi: InsightsKpi): StatTone {
  if (kpi.key === "merged_untouched_rate" || kpi.value === null) return "muted";
  if (kpi.trend.good === true) return "up";
  if (kpi.trend.good === false) return "down";
  return "muted";
}

/**
 * One KPI card.
 *
 * @param kpi The card, as served.
 * @param range The window the page shows.
 * @returns What `StatCard` draws, and the methodology its popover prints.
 */
export function kpiCard(kpi: InsightsKpi, range: InsightsRange): KpiCardView {
  const interventions = kpi.key === "human_interventions";

  return {
    key: kpi.key,
    label: kpi.unit === "tokens" ? TOKENS_PER_MERGED_PR : KPI_LABEL[kpi.key],
    value: figureOf(kpi, range),
    valueSuffix: interventions && kpi.value !== null ? PER_WEEK : null,
    accent: kpi.key === "autonomous_merge_rate" && kpi.value !== null,
    valueTone: interventions && kpi.value !== null && kpi.value > 0 ? "warn" : null,
    delta: deltaOf(kpi, range),
    tone: toneOf(kpi),
    methodology: kpi.methodology,
  };
}

/**
 * The KPI row, in the service's card order.
 *
 * @param kpis The cards, as served, or `null` when nothing has been read.
 * @param range The window the page shows.
 * @returns The cards — none when nothing has been read; the banner says why.
 */
export function kpiRow(kpis: readonly InsightsKpi[] | null, range: InsightsRange): KpiCardView[] {
  return kpis === null ? [] : kpis.map((kpi) => kpiCard(kpi, range));
}

/* ------------------------------------------------------------------ the methodology popover */

/** The popover's heading over the formula. */
export const FORMULA_HEADING = "Formula";

/** Its heading over the source planes. */
export const SOURCES_HEADING = "Sources";

/** Its heading over the caveats. */
export const CAVEATS_HEADING = "Caveats";

/** What a proxy metric adds: the figure stands in for something it does not measure directly. */
export const PROXY_NOTE = "A proxy: this figure stands in for what it cannot measure directly.";

/**
 * The popover's footer — which version of the registry entry produced the figure.
 *
 * @param methodology The entry.
 * @returns `merge_rate · v1`.
 */
export function methodologyVersion(methodology: MetricMethodology): string {
  return `${methodology.metricId} · v${methodology.version}`;
}

/* ------------------------------------------------------------------ the banner */

/** The banner's headline over a page that never arrived. */
export const INSIGHTS_UNREAD_HEADLINE = "Insights could not be read.";

/**
 * The banner's headline.
 *
 * @param dataAt When the page on screen was last confirmed current, in epoch milliseconds, or
 *   `null` when there is no page.
 * @param clock How to say a time of day — the reader's own locale's clock.
 * @returns The headline.
 */
export function insightsBannerHeadline(
  dataAt: number | null,
  clock: (atMs: number) => string,
): string {
  return dataAt === null
    ? INSIGHTS_UNREAD_HEADLINE
    : `Showing data from ${clock(dataAt)} — the latest refresh failed.`;
}
