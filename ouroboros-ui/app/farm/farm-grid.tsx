"use client";

import { Fragment, type ReactNode } from "react";

import { cx } from "@/app/ui/class-names";

import { useFirstRun } from "./use-first-run";

/**
 * The build farm's card grid, which puts step one first during a first run
 * (AI.7, [#262](https://github.com/NobuData/ouroboros/issues/262)).
 *
 * Mockup 08's order is the populated page's: the stat row, the runners table beside the
 * right-hand column, the live log under both. A workspace with nothing enrolled has no table to
 * read, and the card the reader needs is the one the mockup draws second — so while
 * `useFirstRun` says so, the right-hand column comes **before** the runners card, and inside it
 * the card that is step one comes first (the pools card when there is no pool to enrol into, the
 * enroll card otherwise — `stepEyebrow` in `app/farm/states.ts`).
 *
 * **The order is the DOM's, not a CSS `order`.** Reordering visually alone would leave a keyboard
 * reader tabbing through the table's seat before the card the page has just told them to start
 * at. The modifier class is what the sheet hangs the first run's measure on: the promoted column
 * takes five columns and the table's seat seven, because the command is one long line and the
 * seat is a short list.
 *
 * The regions arrive as slots rather than being imported here, so `app/farm/farm-screen.tsx`
 * stays the one place that says what the page is made of and who may do what on it. This is a
 * Client Component only because the order is read from the farm's store; the screen itself reads
 * none.
 *
 * @param props.stats The stat row — four grid items.
 * @param props.runners The runners card.
 * @param props.enroll The enroll card.
 * @param props.pools The pools card.
 * @param props.live The live log card.
 * @returns The grid.
 */
export function FarmGrid({
  stats,
  runners,
  enroll,
  pools,
  live,
}: Readonly<{
  stats: ReactNode;
  runners: ReactNode;
  enroll: ReactNode;
  pools: ReactNode;
  live: ReactNode;
}>) {
  const firstRun = useFirstRun();

  // Keyed, so a change of order *moves* a card rather than remounting it: the pools card holds
  // the sheet a first pool is being created in, and the state flips under it on that very write.
  const cards: readonly Slot[] =
    firstRun === "no-pools"
      ? [
          ["pools", pools],
          ["enroll", enroll],
        ]
      : [
          ["enroll", enroll],
          ["pools", pools],
        ];
  const side = <div className="farm-col--4 farm__side">{cards.map(keyed)}</div>;
  const columns: readonly Slot[] =
    firstRun === null
      ? [
          ["runners", runners],
          ["side", side],
        ]
      : [
          ["side", side],
          ["runners", runners],
        ];

  return (
    <div className={cx("farm__grid", firstRun !== null && "farm__grid--first-run")}>
      {stats}
      {columns.map(keyed)}
      {live}
    </div>
  );
}

/** One region and the key it keeps wherever it is placed. */
type Slot = readonly [key: string, node: ReactNode];

/**
 * A slot, as a keyed child.
 *
 * @param slot The region and its key.
 * @returns The region, in a fragment carrying the key.
 */
function keyed([key, node]: Slot): ReactNode {
  return <Fragment key={key}>{node}</Fragment>;
}
