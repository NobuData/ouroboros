/**
 * Every decision the build & test performance strip and the builds-per-day card make
 * (BK.5, [#446](https://github.com/NobuData/ouroboros/issues/446)).
 *
 * Mockup 15's **BUILD & TEST PERFORMANCE · 30D** strip is BJ.2's six cells
 * (`InsightsPerformanceCell`) in their served order, and **BUILDS PER DAY — SUCCEEDED VS FAILED**
 * is the `StackedVBars` primitive over `series.builds`.
 *
 * **Framework-free and pure**, the way `app/insights/view.ts` is.
 *
 * ### The cost cell inherits the money rules (decision I8)
 *
 * `$563.20` is drawn only where the window's usage was priced. Where none of it was, the service
 * sends `total_cost` as `null` and the page's `usage.pricing` as `unpriced`: the cell then states
 * the tokens and **no dollar figure** — the discipline of every other cost surface, applied to a
 * cell that is easy to overlook. Where only part was priced, the dollars carry a note naming the
 * tokens they do not cover.
 *
 * ### The deps-refresh line is absent
 *
 * *"Failures cluster on deps-refresh days — the analyzer noticed too"* asserts a correlation the
 * build analyzer computes — its `cache_window` finding (BV.3,
 * [#512](https://github.com/NobuData/ouroboros/issues/512)). Until that finding is in the payload
 * the page has no key for it, and this card draws **no** line — not a softened one, not one
 * computed a second way here (decision I10).
 */

import type { InsightsMoney, InsightsPage, InsightsPerformanceCell } from "@/app/api/insights";
import type { VBarDay, VBarNote } from "@/app/charts";
import { compactNumber, moneyOfCents, percentOf, tokenCount } from "@/app/format";

import { type SeriesEmpty, dayLabel, windowTag } from "./series-view";
import { NOT_MEASURED } from "./view";

/* ------------------------------------------------------------------ the strip */

/** The strip's heading, from the mockup — the range is appended. */
export const PERFORMANCE_TITLE = "Build & test performance";

/** Each cell's caption, from the mockup. */
export const CELL_LABELS: Readonly<Record<InsightsPerformanceCell["key"], string>> = {
  builds: "Builds",
  build_success_rate: "Build success",
  test_cases_run: "Test cases run",
  test_pass_rate: "Test pass rate",
  tokens: "Tokens",
  total_cost: "Total cost",
};

/** The scope tag's second half: the page is never filtered by workflow. */
export const ALL_WORKFLOWS = "all workflows";

/** The scope tag's first half when the page covers the whole workspace. */
export const ALL_REPOSITORIES = "all repositories";

/** Said beside the tokens in the cost cell when nothing was priced. */
export const UNPRICED = "unpriced";

/** The build-success split — `377 ✓ / 35 ✗` — with its words for a screen reader. */
export interface SplitView {
  /** Succeeded builds. */
  readonly succeeded: string;
  /** Failed builds — drawn in the error hue. */
  readonly failed: string;
  /** `377 succeeded, 35 failed`. */
  readonly words: string;
}

/** One drawn cell. */
export interface PerformanceCellView {
  /** The cell's key — the React key. */
  readonly key: InsightsPerformanceCell["key"];
  /** The caption. */
  readonly label: string;
  /** The figure — `412`, `91.5%`, `$563.20`, `126M tokens` — or the em dash. */
  readonly value: string;
  /** The build-success split, on that cell only and only when its parts were sent. */
  readonly split: SplitView | null;
  /** A muted note after the figure — `unpriced`, `+ 12M unpriced tokens` — or `null`. */
  readonly note: string | null;
}

/** What the strip draws. */
export interface PerformanceView {
  /** The heading — `Build & test performance · 30d`. */
  readonly title: string;
  /** The scope tag — `helios-firmware · all workflows`. */
  readonly scope: string;
  /** The cells, in the served order. */
  readonly cells: readonly PerformanceCellView[];
}

/**
 * A cell's figure in its unit.
 *
 * @param cell The cell. Its value is not null.
 * @param value The value.
 * @returns The figure.
 */
function figureOf(cell: InsightsPerformanceCell, value: number): string {
  switch (cell.unit) {
    case "pct":
      return percentOf(value / 100);
    case "cents":
      return moneyOfCents(value);
    case "tokens":
      return tokenCount(value);
    case "duration_ms":
    case "count":
      return compactNumber(value);
  }
}

/**
 * The cost cell — dollars where priced, tokens and no dollars where not (decision I8).
 *
 * @param cell The `total_cost` cell.
 * @param usage The page's usage.
 * @returns The cell's figure and note.
 */
export function costCell(
  cell: InsightsPerformanceCell,
  usage: InsightsMoney,
): Pick<PerformanceCellView, "value" | "note"> {
  if (usage.pricing === "unpriced") return { value: `${tokenCount(usage.tokens)} tokens`, note: UNPRICED };
  if (cell.value === null || usage.pricing === "none") return { value: NOT_MEASURED, note: null };

  return {
    value: moneyOfCents(cell.value),
    note: usage.unpricedTokens > 0 ? `+ ${tokenCount(usage.unpricedTokens)} unpriced tokens` : null,
  };
}

/**
 * The build-success split.
 *
 * @param cell The `build_success_rate` cell.
 * @returns `377 ✓ / 35 ✗`'s parts, or `null` when the cell carried none.
 */
export function splitOf(cell: InsightsPerformanceCell): SplitView | null {
  if (cell.components === undefined) return null;

  const succeeded = cell.components.numerator;
  const failed = Math.max(0, cell.components.denominator - succeeded);

  return {
    succeeded: String(succeeded),
    failed: String(failed),
    words: `${succeeded} succeeded, ${failed} failed`,
  };
}

/**
 * The scope tag.
 *
 * @param repo The page's repository, `owner/name`, or `null` for the whole workspace.
 * @returns `helios-firmware · all workflows`, or `all repositories · all workflows`.
 */
export function scopeTag(repo: string | null): string {
  const name = repo === null ? ALL_REPOSITORIES : (repo.split("/").pop() ?? repo);

  return `${name} · ${ALL_WORKFLOWS}`;
}

/**
 * The strip.
 *
 * @param page The page.
 * @returns What the strip draws.
 */
export function performanceView(page: Pick<InsightsPage, "range" | "repo" | "usage" | "performance">): PerformanceView {
  return {
    title: `${PERFORMANCE_TITLE} · ${page.range}`,
    scope: scopeTag(page.repo),
    cells: page.performance.map((cell): PerformanceCellView => {
      const base = { key: cell.key, label: CELL_LABELS[cell.key] };

      if (cell.key === "total_cost") return { ...base, split: null, ...costCell(cell, page.usage) };

      return {
        ...base,
        value: cell.value === null ? NOT_MEASURED : figureOf(cell, cell.value),
        split: cell.key === "build_success_rate" ? splitOf(cell) : null,
        note: null,
      };
    }),
  };
}

/* ------------------------------------------------------------------ builds per day */

/** The builds card's heading, from the mockup. */
export const BUILDS_TITLE = "Builds per day — succeeded vs failed";

/** The builds card's empty state — never thirty zero-height bars. */
export const NO_BUILDS: SeriesEmpty = {
  title: "No builds ran in this range",
  note: "Each day's succeeded and failed builds stack here once the farm runs one.",
};

/** What the builds card draws. */
export interface BuildsView {
  /** The tag — the window. */
  readonly tag: string;
  /** The bars' accessible name, with the headline. */
  readonly label: string;
  /** The days, oldest first. */
  readonly days: readonly VBarDay[];
  /** The floating note — the window's worst day, `18 · 2 failed` — or `undefined` with no failures. */
  readonly note: VBarNote | undefined;
  /** What to draw instead of bars, or `null` when anything ran. */
  readonly empty: SeriesEmpty | null;
}

/**
 * The day the note floats over: the one with the most failed builds — the latest of a tie, since
 * the newest failure is the one a reader can still act on.
 *
 * @param days The days.
 * @returns Its index, or `-1` when nothing failed.
 */
export function worstDay(days: readonly VBarDay[]): number {
  let worst = -1;

  days.forEach((day, index) => {
    if (day.failed > 0 && (worst === -1 || day.failed >= days[worst]!.failed)) worst = index;
  });

  return worst;
}

/**
 * The builds card.
 *
 * @param page The page — its window and the builds series.
 * @returns What the card draws.
 */
export function buildsView(page: Pick<InsightsPage, "window" | "series">): BuildsView {
  const days: VBarDay[] = page.series.builds.points.map((point) => ({
    label: dayLabel(point.day),
    succeeded: point.succeeded,
    failed: point.failed,
  }));
  const failed = days.reduce((sum, day) => sum + day.failed, 0);
  const total = days.reduce((sum, day) => sum + day.succeeded, 0) + failed;
  const worst = worstDay(days);
  const day = days[worst];

  return {
    tag: windowTag(page.window),
    label: `Builds per day, succeeded versus failed: ${total} builds, ${failed} failed`,
    days,
    note:
      day === undefined
        ? undefined
        : { index: worst, text: `${day.succeeded + day.failed} · ${day.failed} failed` },
    empty: total === 0 ? NO_BUILDS : null,
  };
}
