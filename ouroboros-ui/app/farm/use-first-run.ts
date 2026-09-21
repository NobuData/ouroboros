"use client";

import { useFarm } from "./farm-store";
import { usePools } from "./pool-store";
import { type FarmFirstRun, farmFirstRun } from "./states";

/**
 * The first-run state, as every region that draws it reads it
 * (AI.7, [#262](https://github.com/NobuData/ouroboros/issues/262)).
 *
 * Four regions change with it — the grid's order, the runners card's seat, and the eyebrows on
 * the enroll and pools cards — and they must change together, so they all ask here rather than
 * each combining the two stores its own way. The pools are the pool store's
 * (`app/farm/pool-store.tsx`), not the page's: a pool created a moment ago is held there before
 * the page catches up, so the guidance moves from *create a pool* to *copy the command* on the
 * same commit the pools card draws the new row.
 *
 * @returns The state, or `null` outside a first run — see `farmFirstRun` in `app/farm/states.ts`.
 */
export function useFirstRun(): FarmFirstRun | null {
  const { page } = useFarm();
  const { pools } = usePools();

  return farmFirstRun(page, pools);
}
