/**
 * The states a working insights page never shows — every decision they make, and every sentence
 * they say (BK.6, [#447](https://github.com/NobuData/ouroboros/issues/447)).
 *
 * - **A cold workspace.** A new workspace has nothing merged, built or priced, so every chart has
 *   nothing to draw. The wrong answer is a flat line at zero, which reads as *your loops are
 *   failing* rather than *nothing has run yet*; each card's designed empty state is re-framed as
 *   **not enough data to measure**, and no chart invents a curve.
 * - **Rollup lag.** The figures are read from daily rollups that fill hourly (#433). When the
 *   rollups are behind, the page says through which day its figures run and when they were last
 *   filled — the real time, from the payload's `freshness` — rather than presenting old numbers
 *   as current.
 * - **A card that cannot draw.** One card failing degrades that card, not the page.
 *
 * Framework-free and pure, as `app/insights/view.ts` is.
 */

import type { InsightsPage } from "@/app/api/insights";
import { relativeAgo } from "@/app/format";

import { type SeriesEmpty, dayLabel } from "./series-view";

/* ------------------------------------------------------------------ the cold workspace */

/** The title every card's empty state takes in a cold workspace. */
export const COLD_TITLE = "Not enough data to measure yet";

/** What a cold card adds before its own note: why there is nothing, framed as time, not failure. */
export const COLD_LEAD = "The loop hasn't run enough to measure this.";

/**
 * Whether the workspace is cold — nothing has run in it enough to measure.
 *
 * It is cold when no rollup has filled a day yet, or when the window holds no merge, no build and
 * no model usage at all: every card would be empty for the same reason, and that reason is that
 * the loop has not run, not that it failed.
 *
 * @param page The page, as served.
 * @returns Whether to frame every empty state as *not enough data*.
 */
export function isColdWorkspace(page: InsightsPage): boolean {
  if (page.freshness.filledThrough === null && page.freshness.lastFilledAt === null) return true;

  const merged = page.series.throughput.points.some((point) => point.mergedPrs > 0);
  const built = page.series.builds.points.some((point) => point.succeeded + point.failed > 0);

  return !merged && !built && page.usage.pricing === "none";
}

/**
 * A card's empty state, re-framed for a cold workspace.
 *
 * @param empty The card's own empty state — what is not there and what will fill it.
 * @param cold Whether the workspace is cold.
 * @returns The empty state unchanged on a working workspace; on a cold one, {@link COLD_TITLE}
 *   over {@link COLD_LEAD} and the card's own note, so it still says what will fill it.
 */
export function emptyFor(empty: SeriesEmpty, cold: boolean): SeriesEmpty {
  return cold ? { title: COLD_TITLE, note: `${COLD_LEAD} ${empty.note}` } : empty;
}

/* ------------------------------------------------------------------ the rollup-lag banner */

/** The banner's headline over rollups that are behind. */
export const LAG_HEADLINE = "These figures are behind.";

/** The banner's headline over rollups whose latest run failed while the figures are current. */
export const FAILING_HEADLINE = "The latest metrics refresh failed.";

/** What the banner says when nothing was ever filled — never drawn for a cold workspace. */
export const NEVER_FILLED = "The rollups have not filled a day yet.";

/** The rollup-lag banner, ready to draw. */
export interface LagBannerView {
  /** The headline. */
  readonly headline: string;
  /** The detail: through which day, and when last filled. */
  readonly detail: string;
}

/**
 * The rollup-lag banner.
 *
 * Drawn when the rollups are `behind` or `failing`; silent otherwise — including on a cold
 * workspace, whose cards already say *not enough data*.
 *
 * @param page The page, as served.
 * @param now The instant the page was read, so `3h ago` is measured from the same clock the
 *   rest of the page was.
 * @returns The banner, or `null` while the rollups are current.
 */
export function lagBanner(page: InsightsPage, now: Date): LagBannerView | null {
  const { behind, failing, filledThrough, lastFilledAt } = page.freshness;

  if (!behind && !failing) return null;

  const through = filledThrough === null ? NEVER_FILLED : `Figures run through ${dayLabel(filledThrough)}`;
  const filled = lastFilledAt === null ? "" : `, last filled ${relativeAgo(lastFilledAt, now)}`;
  const tail = failing ? " The rollup job's latest run failed; it retries every hour." : "";

  return {
    headline: behind ? LAG_HEADLINE : FAILING_HEADLINE,
    detail: filledThrough === null ? `${through}${tail}` : `${through}${filled}.${tail}`,
  };
}

/* ------------------------------------------------------------------ a card that cannot draw */

/** The title of a card that failed to draw. */
export const CARD_FAILED_TITLE = "This card could not be drawn";

/** Its note: the rest of the page is unaffected, and a reload retries. */
export const CARD_FAILED_NOTE =
  "Something in its figures could not be shown. The rest of the page is unaffected — reload to try again.";
