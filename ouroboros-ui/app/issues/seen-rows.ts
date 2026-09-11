import type { TableRow } from "./table";

/**
 * The rows the table has drawn since the page mounted, by id — what the selection bar reads
 * a selected issue's facts from ([#118](https://github.com/NobuData/ouroboros/issues/118)).
 *
 * ### Why the bar cannot read the table
 *
 * The selection outlives the page it was made on: a chip press or a page turn redraws the rows
 * and the ids stay selected (`app/issues/selection.tsx`). The bar has to say *"5 issues selected
 * · est. 2h 5m combined"* over all five, and two of them may be on a page the table is no
 * longer drawing. So every listing the table draws is published here, keyed by id and kept for
 * as long as the provider lives, and the bar sums what it finds — the row **as last seen**,
 * which the poll refreshes for every row still on screen. A selected issue that was never seen
 * cannot happen through the table, since a row is selected by being drawn; the bar treats one
 * as carrying no estimate, which is the honest reading of a number nobody has.
 *
 * ### Why an external store rather than state in the provider
 *
 * The table learns its rows from a poll, and the moment it has them is an effect. A `setState`
 * on the provider from that effect is the shape `react-hooks` refuses, for the reason it gives
 * — a render, a commit, and then a second render for the same fact. `app/poll.ts` faces the
 * same moment and answers it the same way: a store React subscribes to, written from wherever
 * the fact arrives and read through `useSyncExternalStore`, so the bar re-renders exactly when
 * a row it may be summing has changed and not when a listing merely repeated itself.
 *
 * Framework-free, in that file's way: nothing here imports React, so the merging is tested as
 * a function and the subscription as a contract.
 */

/** The rows seen so far, by id. A new map on every change, so a subscriber compares by identity. */
export type SeenRowMap = ReadonlyMap<string, TableRow>;

/** The store: the table writes, the bar subscribes. */
export interface SeenRows {
  /**
   * Record the rows a listing drew. Rows already known are replaced where a field the bar
   * reads has changed and left alone otherwise, so a poll that answered the same page again
   * wakes nobody.
   *
   * @param rows The rows, as the table draws them.
   */
  readonly publish: (rows: readonly TableRow[]) => void;
  /**
   * Be told when the map changes.
   *
   * @param listener What to call.
   * @returns The way to stop.
   */
  readonly subscribe: (listener: () => void) => () => void;
  /** The map as it stands — the same object until {@link SeenRows.publish} changes something. */
  readonly snapshot: () => SeenRowMap;
}

/**
 * Whether two sightings of a row agree on everything the bar reads.
 *
 * The title and the labels are deliberately not compared: the bar prints neither, and a row
 * whose title was edited on GitHub is not a reason to re-sum an estimate.
 *
 * @param before The row as last recorded.
 * @param after The row as just drawn.
 * @returns `true` when the number, the estimate, the workflow and the status are the same.
 */
export function sameSighting(before: TableRow, after: TableRow): boolean {
  return (
    before.number === after.number &&
    before.estMinutes === after.estMinutes &&
    before.workflow === after.workflow &&
    before.status === after.status
  );
}

/**
 * The map after a listing, or the same map when the listing changed nothing.
 *
 * @param seen The map as it stands.
 * @param rows The rows just drawn.
 * @returns A new map with the rows merged in, or `seen` itself — the identity is the signal.
 */
export function withSightings(seen: SeenRowMap, rows: readonly TableRow[]): SeenRowMap {
  const changed = rows.filter((row) => {
    const before = seen.get(row.id);
    return before === undefined || !sameSighting(before, row);
  });

  if (changed.length === 0) return seen;

  const next = new Map(seen);
  for (const row of changed) next.set(row.id, row);
  return next;
}

/**
 * A store with nothing seen yet.
 *
 * @returns The store. One per provider: the map is the page's memory, and it ends with the page.
 */
export function createSeenRows(): SeenRows {
  let seen: SeenRowMap = new Map();
  const listeners = new Set<() => void>();

  return {
    publish(rows) {
      const next = withSightings(seen, rows);
      if (next === seen) return;

      seen = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => seen,
  };
}
