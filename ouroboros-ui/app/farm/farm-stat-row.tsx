"use client";

import { Meter, StatCard } from "@/app/ui";

import { useFarm } from "./farm-store";
import { farmStatRow } from "./view";

/**
 * The build farm's stat row — mockup 08's four tiles
 * (AI.1, [#256](https://github.com/NobuData/ouroboros/issues/256)).
 *
 * The tile is the shared `StatCard` (DASH-I.2, [#81](https://github.com/NobuData/ouroboros/issues/81),
 * in `app/ui` since this row became its second caller), and what each one says is
 * `farmStatRow`'s (`app/farm/view.ts`): this reads the farm's store, so the row moves with every
 * poll, and maps a tile to the primitive's props. It decides nothing.
 *
 * **The cache tile's meter is a picture of the figure above it**, so it takes no label and is
 * hidden from the accessibility tree — `78%` is already said, and a `progressbar` beside it
 * would say it twice (`app/ui/meter.tsx`). A tile with nothing measured draws no meter at all.
 *
 * @returns The four tiles, as direct children of the farm's grid.
 */
export function FarmStatRow() {
  const { page } = useFarm();

  return (
    <>
      {farmStatRow(page).map((stat) => (
        <StatCard
          accent={stat.accent}
          className="farm-col--3"
          delta={stat.delta}
          key={stat.id}
          label={stat.label}
          tone={stat.tone}
          value={stat.value}
          valueSuffix={stat.valueSuffix ?? undefined}
        >
          {stat.meter !== null && <Meter value={stat.meter} />}
        </StatCard>
      ))}
    </>
  );
}
