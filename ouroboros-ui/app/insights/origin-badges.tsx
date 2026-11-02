"use client";

import { OriginBadge } from "@/app/origin/origin-badge";
import { OriginStrip } from "@/app/origin/origin-strip";

import { useInsights } from "./insights-store";
import { insightsBadges } from "./origin-view";

/**
 * The origin badges a card's head carries (DJ.3) — **Demo data**, **Simulated** — when the page
 * shows non-live figures, and nothing while it shows live ones. Every card reads the same page, so
 * every card carries the same badges.
 *
 * @returns The badges, or null.
 */
export function InsightsOriginBadges() {
  const { page, origin } = useInsights();
  const badges = insightsBadges(page, origin);

  if (badges.length === 0) return null;

  return (
    <span className="insights-origin">
      {badges.map((badge) => (
        <OriginBadge key={badge} origin={badge} />
      ))}
    </span>
  );
}

/**
 * The page-level strip, from the page on screen and the origin it shows.
 *
 * @returns The strip, or null while nothing has been read or live data exists.
 */
export function InsightsOriginStrip() {
  const { page, origin } = useInsights();

  if (page === null) return null;

  return <OriginStrip filter={origin} present={page.originsPresent} />;
}

