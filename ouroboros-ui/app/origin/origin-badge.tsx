import { cx } from "@/app/ui";

import { type DataOrigin, ORIGIN_BADGE_TITLE, originBadge } from "./origin";

import "./origin.css";

/**
 * The origin badge (DJ.3, [#1316](https://github.com/NobuData/ouroboros/issues/1316)): **Demo data**
 * or **Simulated** beside a row, card or chart that shows or counts non-live data, and nothing at
 * all for a live one. Words, never a hue alone — the tint only repeats what the label says.
 *
 * @param props.origin The row's or figure's origin.
 * @param props.className Classes from the surface, for placement only.
 * @returns The badge, or null for live data.
 */
export function OriginBadge({
  origin,
  className,
}: Readonly<{ origin: DataOrigin; className?: string }>) {
  const label = originBadge(origin);

  if (label === null || origin === "live") return null;

  return (
    <span className={cx("origin-badge", className)} title={ORIGIN_BADGE_TITLE[origin]}>
      {label}
    </span>
  );
}
