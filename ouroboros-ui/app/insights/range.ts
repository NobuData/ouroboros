/**
 * The insights page's range — the segment's options, and how the choice lives in the URL
 * (BK.2, [#443](https://github.com/NobuData/ouroboros/issues/443)).
 *
 * **The range is the page's main control**, and it is kept in the address so that a link to
 * *insights, 90 days* opens on 90 days: the route reads `?range=` on the server for the first
 * paint, and the segment writes it back with `router.replace` (`app/insights/range-segment.tsx`).
 * The default — `30d`, the mockup's and the service's — is the address with no `range` at all,
 * so `/insights` stays the page's one canonical link.
 *
 * Anything else in the address — a typo, a stale `custom` — reads as the default rather than as an
 * error: the page has one honest thing to draw for a range it does not know, and it is the default
 * one, which the segment then shows as chosen.
 *
 * Framework-free and pure, so the server, the route handler and the segment share one parser.
 */

import type { InsightsRange } from "@/app/api/insights";

/** The query parameter the range travels in. */
export const RANGE_PARAM = "range";

/** The range the page shows when the address names none — the mockup's and the service's. */
export const DEFAULT_RANGE: InsightsRange = "30d";

/** Every range the service answers, in the segment's order. */
export const RANGES: readonly InsightsRange[] = ["7d", "30d", "90d"];

/** How many days each range covers — what a per-week figure is scaled by. */
export const RANGE_DAYS: Readonly<Record<InsightsRange, number>> = { "7d": 7, "30d": 30, "90d": 90 };

/** The segment's accessible name, verbatim from the mockup's `aria-label`. */
export const RANGE_GROUP_LABEL = "Time range";

/** The fourth option's label: present, and honestly unavailable. */
export const CUSTOM_LABEL = "custom";

/**
 * Why `custom` cannot be chosen yet — its tooltip and its visually hidden reason.
 *
 * Custom ranges are BL.3's ([#450](https://github.com/NobuData/ouroboros/issues/450)), and the
 * service refuses one today, so the option says when it arrives rather than looking broken.
 */
export const CUSTOM_REASON = "Custom ranges arrive with #450.";

/**
 * Whether a value is a range the service answers.
 *
 * @param value Anything.
 * @returns `true` for `7d`, `30d` or `90d`.
 */
export function isInsightsRange(value: unknown): value is InsightsRange {
  return typeof value === "string" && (RANGES as readonly string[]).includes(value);
}

/**
 * The range an address asks for.
 *
 * @param value The `range` parameter as Next.js or `URLSearchParams` hands it — a string, a
 *   repeated parameter's array (the first one counts), or nothing.
 * @returns The range, or {@link DEFAULT_RANGE} for anything that is not one.
 */
export function parseRange(value: string | readonly string[] | null | undefined): InsightsRange {
  const first = typeof value === "string" ? value : value?.[0];

  return isInsightsRange(first) ? first : DEFAULT_RANGE;
}

/**
 * The query string for a range, with its `?` — empty for the default.
 *
 * @param range The range.
 * @returns `?range=7d`, `?range=90d`, or `""` for `30d`.
 */
export function rangeSearch(range: InsightsRange): string {
  return range === DEFAULT_RANGE ? "" : `?${RANGE_PARAM}=${range}`;
}
