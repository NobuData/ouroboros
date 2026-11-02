/**
 * Data origin, as the reader sees it (DJ.3, [#1316](https://github.com/NobuData/ouroboros/issues/1316)).
 *
 * `ouroboros-rest` marks every run, and everything derived from one, `live`, `simulated` or
 * `seeded` (DJ.1), and computes every aggregate from one origin — `live` unless asked (DJ.2). This
 * module is the UI's half of that contract, framework-free so a Server Component, a client
 * component and a route handler read the same table:
 *
 *   origin      badge          filter option
 *   ───────────────────────────────────────────
 *   live        (none)         Live
 *   seeded      Demo data      Demo data
 *   simulated   Simulated      Simulated
 *   —                          All origins
 *
 * **Live carries no badge.** A badge marks what is *not* real; a live row is the default reading
 * and needs no label. Every badge is words, never a hue alone.
 *
 * **The filter is remembered.** `?origin=` in the address wins, so a link opens on what it names;
 * changing the filter also writes {@link ORIGIN_COOKIE}, so the next page opened from the sidebar
 * reads the same origin. Nothing at all means {@link DEFAULT_ORIGIN}.
 */

import type { components } from "@/app/api/schema";
import { GET_STARTED_PATH } from "@/app/get-started/view";

/** Where a row came from — DJ.1's vocabulary. */
export type DataOrigin = components["schemas"]["DataOrigin"];

/** What an aggregate or list may be asked for: one origin, or every one. */
export type OriginFilter = components["schemas"]["OriginFilter"];

/** The query parameter that carries the filter. */
export const ORIGIN_PARAM = "origin";

/** The cookie that remembers the reader's last choice across pages. */
export const ORIGIN_COOKIE = "ouro_origin";

/** How long the choice is remembered: a year, like the theme. */
export const ORIGIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** What every surface reads when nothing names an origin. */
export const DEFAULT_ORIGIN: OriginFilter = "live";

/** The filter's group label — what a screen reader announces before the options. */
export const ORIGIN_GROUP_LABEL = "Data origin";

/** The filter's options, in the order they are drawn. */
export const ORIGIN_OPTIONS: readonly { readonly value: OriginFilter; readonly label: string }[] = [
  { value: "live", label: "Live" },
  { value: "seeded", label: "Demo data" },
  { value: "simulated", label: "Simulated" },
  { value: "all", label: "All origins" },
];

/** The badge's words for each non-live origin. Live has none. */
export const ORIGIN_BADGE_LABEL: Readonly<Record<Exclude<DataOrigin, "live">, string>> = {
  seeded: "Demo data",
  simulated: "Simulated",
};

/** What the badge's tooltip and accessible description say about each non-live origin. */
export const ORIGIN_BADGE_TITLE: Readonly<Record<Exclude<DataOrigin, "live">, string>> = {
  seeded: "Demo data loaded into this environment — not a real loop.",
  simulated: "Opened by the run simulator — no executor, repository or model did this work.",
};

/** The strip's link: the readiness check. DK.1 (#1318) retargets it to its preflight. */
export const READINESS_LINK = { label: "Check readiness →", href: GET_STARTED_PATH } as const;

/**
 * Narrow a raw value to a filter.
 *
 * @param value Anything — an address parameter, a cookie.
 * @returns Whether it is one of {@link ORIGIN_OPTIONS}' values.
 */
export function isOriginFilter(value: unknown): value is OriginFilter {
  return typeof value === "string" && ORIGIN_OPTIONS.some((option) => option.value === value);
}

/**
 * The filter a request asked for: the address first, then the remembered choice, then live.
 *
 * @param param The `?origin=` value, as Next.js hands search params over.
 * @param remembered The {@link ORIGIN_COOKIE} value, if any.
 * @returns The filter. Anything unrecognized is ignored, never an error.
 */
export function parseOrigin(
  param: string | readonly string[] | null | undefined,
  remembered?: string,
): OriginFilter {
  const first = typeof param === "string" ? param : param?.[0];

  if (isOriginFilter(first)) return first;
  if (isOriginFilter(remembered)) return remembered;

  return DEFAULT_ORIGIN;
}

/**
 * The badge a row of some origin carries.
 *
 * @param origin The row's origin.
 * @returns The label, or null for a live row — live carries no badge.
 */
export function originBadge(origin: DataOrigin): string | null {
  return origin === "live" ? null : ORIGIN_BADGE_LABEL[origin];
}

/** What the page-level strip says, and which kind of data it is about. */
export interface OriginStripView {
  /** The strip's sentence. */
  readonly text: string;
}

/** The second sentence every strip ends on — the fact the reader most needs. */
export const NO_LIVE_LOOP = "No real loop has run in this workspace yet.";

/**
 * The page-level strip, when a page's content is entirely non-live.
 *
 * - **The page shows only non-live rows** (the reader asked for demo, simulated or all, and the
 *   workspace holds no live data): *"This page is showing demo data. No real loop has run in this
 *   workspace yet."*
 * - **The page shows nothing because only non-live data exists** (live asked for): the same fact,
 *   and where the hidden rows are — *"No real loop has run in this workspace yet. Demo data is
 *   hidden; choose Demo data under Data origin to see it."*
 * - **Live data exists, or nothing exists at all**: no strip. A workspace with no data of any
 *   origin is a fresh one, and its empty states say so card by card.
 *
 * @param present Every origin the page's figures and rows hold — `originsPresent`.
 * @param filter The origin the page is showing.
 * @returns The strip, or null when there is none to draw.
 */
export function originStrip(
  present: readonly DataOrigin[],
  filter: OriginFilter,
): OriginStripView | null {
  if (present.length === 0 || present.includes("live")) return null;

  const kinds = present.map((origin) => ORIGIN_BADGE_LABEL[origin as Exclude<DataOrigin, "live">]);
  const named = kinds.join(" and ").toLowerCase();

  if (filter === "live") {
    const first = kinds[0] ?? "";

    return {
      text: `${NO_LIVE_LOOP} ${capitalized(named)} is hidden; choose ${first} under ${ORIGIN_GROUP_LABEL} to see it.`,
    };
  }

  return { text: `This page is showing ${named}. ${NO_LIVE_LOOP}` };
}

/**
 * A sentence's first letter in capitals.
 *
 * @param text The phrase.
 * @returns It, capitalized.
 */
function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The cookie line that remembers a choice — what the filter writes in the browser.
 *
 * @param filter The chosen origin.
 * @returns A `document.cookie` assignment: site-wide, a year, `SameSite=Lax`.
 */
export function originCookie(filter: OriginFilter): string {
  return `${ORIGIN_COOKIE}=${filter}; Path=/; Max-Age=${String(ORIGIN_COOKIE_MAX_AGE)}; SameSite=Lax`;
}
