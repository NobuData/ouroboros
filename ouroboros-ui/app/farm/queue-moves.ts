/**
 * Which runners' queue depth has just moved (AI.5,
 * [#260](https://github.com/NobuData/ouroboros/issues/260)).
 *
 * Submitting a build changes queue depths on runners the reader can see, *so the affected rows
 * should reflect the new `q:N` rather than leaving the user to wonder whether the click worked*.
 * The figure itself already follows the page; what this adds is the **visible change**: a chip
 * whose depth differs from the page before it is marked for as long as that page is on screen,
 * and the move is said out loud.
 *
 * It marks every move, not only the ones this reader's submission caused. The page cannot tell
 * them apart — a build submitted through the API moves the same chip — and a reader watching a
 * queue wants to see it move whoever moved it.
 *
 * **Framework-free and pure**: two pages in, the moves out. Holding the previous page is
 * `app/farm/runners-card.tsx`'s.
 */

import type { FarmPage } from "@/app/api/farm";

import { queueReading } from "./runners";

/** One runner's move. */
export interface QueueMove {
  /** The runner's name, for saying it. */
  readonly name: string;
  /** The depth on the page before. */
  readonly from: number;
  /** The depth now. */
  readonly to: number;
}

/** No runner moved. Identity-stable, so a page that moved nothing re-renders nothing. */
export const NO_QUEUE_MOVES: ReadonlyMap<string, QueueMove> = new Map();

/**
 * The runners whose queue depth differs between two pages.
 *
 * @param before The page that was on screen, or `null` when there was none.
 * @param after The page that is.
 * @returns The moves by runner id — {@link NO_QUEUE_MOVES} itself when there are none. **A
 *   runner on only one of the two pages has not moved**: it enrolled or left, and a machine's
 *   first appearance at `q:0` is not a change in its queue.
 */
export function queueMoves(
  before: FarmPage | null,
  after: FarmPage | null,
): ReadonlyMap<string, QueueMove> {
  if (before === null || after === null) return NO_QUEUE_MOVES;

  const was = new Map(before.runners.map((runner) => [runner.id, runner.queueDepth]));
  const moves = new Map<string, QueueMove>();

  for (const runner of after.runners) {
    const from = was.get(runner.id);

    if (from !== undefined && from !== runner.queueDepth) {
      moves.set(runner.id, { name: runner.name, from, to: runner.queueDepth });
    }
  }

  return moves.size === 0 ? NO_QUEUE_MOVES : moves;
}

/**
 * The moves, as a sentence for the table's status region.
 *
 * @param moves What moved.
 * @returns `forge-01 queue q:2 → q:3` — several joined by `; `, in name order so the sentence
 *   does not depend on the payload's — or `""` when nothing moved.
 */
export function queueMovesAnnouncement(moves: ReadonlyMap<string, QueueMove>): string {
  return [...moves.values()]
    .map((move) => `${move.name} queue ${queueReading(move.from)} → ${queueReading(move.to)}`)
    .sort()
    .join("; ");
}
