import { Card } from "@/app/ui";

import type { Stat } from "./view";

/**
 * One tile of the mockup's stat row: a caption, a figure, and a line explaining the figure.
 *
 * It renders a {@link Stat} and decides nothing — what the figure is, whether it is an em
 * dash, and what the line under it says are all `app/dashboard/view.ts`'s, so each of them
 * is a unit test on a function rather than an assertion about rendered text.
 *
 * The card is the #46 primitive; the tile inside it is this screen's own composition
 * (`dashboard.css`), because a caption over a large figure is a shape the dashboard has and
 * the design system does not name.
 *
 * The caption is the tile's accessible name, so a reader moving between the four hears
 * "Members, 3" rather than four unlabelled numbers. It is a `<section>` for the same
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
        <span className="dash-stat__value">{stat.value}</span>
        <span
          className={`dash-stat__delta${stat.failed ? " dash-stat__delta--failed" : ""}`}
        >
          {stat.delta}
        </span>
      </div>
    </Card>
  );
}
