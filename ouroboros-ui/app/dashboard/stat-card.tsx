import { Card, cx } from "@/app/ui";

import type { DeltaTone, Stat } from "./view";

/** The modifier each delta tone adds, or nothing for the default one. */
const DELTA_CLASS: Record<DeltaTone, string> = {
  muted: "",
  up: "dash-stat__delta--up",
  down: "dash-stat__delta--down",
  failed: "dash-stat__delta--failed",
};

/**
 * One tile of the mockup's stat row: a caption, a figure, and a line explaining the figure.
 *
 * It renders a {@link Stat} and decides nothing — what the figure is, whether it is an em
 * dash, what the line under it says and whether there is one at all are all
 * `app/dashboard/view.ts`'s, so each of them is a unit test on a function rather than an
 * assertion about rendered text. What this maps is presentation only: a tone to the class
 * that colours it, in the same way {@link Card} maps its own.
 *
 * The card is the #46 primitive; the tile inside it is this screen's own composition
 * (`dashboard.css`), because a caption over a large figure is a shape the dashboard has and
 * the design system does not name.
 *
 * The caption is the tile's accessible name, so a reader moving between the four hears
 * "Loops live, 3" rather than four unlabelled numbers. It is a `<section>` for the same
 * reason: an `aria-label` on a `<div>` names nothing.
 *
 * @param props.stat The tile to draw.
 * @returns The card.
 */
export function StatCard({ stat }: Readonly<{ stat: Stat }>) {
  return (
    <Card as="section" className="dash-col--3" aria-label={stat.label}>
      <div className="dash-stat">
        <span className="dash-stat__label">{stat.label}</span>
        <span className={cx("dash-stat__value", stat.accent && "dash-stat__value--accent")}>
          {stat.value}
        </span>
        {stat.delta !== null && (
          <span className={cx("dash-stat__delta", DELTA_CLASS[stat.tone])}>{stat.delta}</span>
        )}
      </div>
    </Card>
  );
}
