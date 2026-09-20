import { StatCard as StatTile } from "@/app/ui";

import type { Stat } from "./view";

/**
 * One tile of the mockup's stat row, placed on the dashboard's grid.
 *
 * It renders a {@link Stat} and decides nothing — what the figure is, whether it is an em
 * dash, what the line under it says and whether there is one at all are all
 * `app/dashboard/view.ts`'s, so each of them is a unit test on a function rather than an
 * assertion about rendered text.
 *
 * **The tile itself is the design system's** since the build farm's stat row
 * ([#256](https://github.com/NobuData/ouroboros/issues/256)) drew the same shape:
 * `app/ui/stat-card.tsx` holds the caption, the figure, the line and the tone's class, and what
 * is left here is the one thing that is this page's — the column span the tile takes on the
 * dashboard's grid (`dashboard.css`).
 *
 * @param props.stat The tile to draw.
 * @returns The card.
 */
export function StatCard({ stat }: Readonly<{ stat: Stat }>) {
  return (
    <StatTile
      accent={stat.accent}
      className="dash-col--3"
      delta={stat.delta}
      label={stat.label}
      tone={stat.tone}
      value={stat.value}
    />
  );
}
