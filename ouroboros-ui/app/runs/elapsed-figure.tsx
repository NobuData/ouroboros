import { Elapsed } from "@/app/dashboard/elapsed";
import { elapsedOfSeconds } from "@/app/format";

import type { RunElapsed } from "./view";

/**
 * A run's elapsed time as a figure — the head's *elapsed* and the Resources card's *Wall clock*
 * ([#313](https://github.com/NobuData/ouroboros/issues/313)), which are the same number from the
 * same stage history, so they tick together rather than drifting apart by a poll's worth.
 *
 * @param props.elapsed The anchor for a live run, or the fixed duration of a finished one
 *   (`runElapsed`).
 * @returns `12m 40s`, re-rendered once a second while the run is live.
 */
export function ElapsedFigure({ elapsed }: Readonly<{ elapsed: RunElapsed }>) {
  return elapsed.live ? (
    <Elapsed serverSeconds={elapsed.serverSeconds} startedAtSeconds={elapsed.startedAtSeconds} />
  ) : (
    elapsedOfSeconds(elapsed.seconds)
  );
}
