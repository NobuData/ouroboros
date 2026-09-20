"use client";

import { type ReactNode, createContext, useContext, useMemo, useState } from "react";

/**
 * Which runner the reader has selected in the table — held above the table, because since AI.6
 * ([#261](https://github.com/NobuData/ouroboros/issues/261)) two regions read it.
 *
 * It was the runners card's own state (AI.2, #257) while the card was its only reader. The live
 * log card binds to *a job selected from the table*, which makes the selection a fact about the
 * screen rather than about one card: the table draws it and moves it, and the live card follows
 * the build the selected machine is running (`app/farm/live.ts`). `app/farm/pool-store.tsx` is
 * the same move, made for the same reason — a second reader.
 *
 * It holds a runner's **id and nothing else**. What that runner is doing is the farm page's to
 * say, poll by poll; a copy of its job kept here would be a second answer to that question.
 */

/** What the table writes and the live card reads. */
export interface FarmSelection {
  /** The selected runner's id, or `null` when nothing is selected. */
  readonly runnerId: string | null;
  /** Select a runner. */
  readonly select: (runnerId: string) => void;
}

/** What is read outside a provider: nothing is selected, and selecting does nothing. */
const NO_SELECTION: FarmSelection = Object.freeze({ runnerId: null, select: () => {} });

/** Defaulted for `app/farm/farm-store.tsx`'s reason: a region rendered alone reads *unknown*. */
const SelectionContext = createContext<FarmSelection>(NO_SELECTION);

/**
 * Put the table's selection within reach of the regions that read it.
 *
 * @param props.children The regions.
 * @returns The regions, wrapped.
 */
export function SelectionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [runnerId, setRunnerId] = useState<string | null>(null);

  // `setRunnerId` is identity-stable, so the value moves only when the selection does.
  const selection = useMemo<FarmSelection>(
    () => ({ runnerId, select: setRunnerId }),
    [runnerId],
  );

  return <SelectionContext.Provider value={selection}>{children}</SelectionContext.Provider>;
}

/**
 * The table's selection.
 *
 * @returns See {@link FarmSelection}.
 */
export function useFarmSelection(): FarmSelection {
  return useContext(SelectionContext);
}
