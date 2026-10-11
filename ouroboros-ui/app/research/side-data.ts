import "server-only";

/**
 * The regression watch's first paint (CN.3, [#629](https://github.com/NobuData/ouroboros/issues/629)),
 * read once on the server so the card arrives whole. The tools card's first paint is the
 * composer's own reading of the catalog (`composer-data.ts`) — one read draws both.
 */

import { type Reading, attempt } from "@/app/api/reading";
import { type RegressionWatchCard, research } from "@/app/api/research";

/**
 * Read the regression watch card.
 *
 * @returns The reading; a failure carries the service's sentence.
 */
export function readWatch(): Promise<Reading<RegressionWatchCard>> {
  return attempt(() => research.watch());
}
