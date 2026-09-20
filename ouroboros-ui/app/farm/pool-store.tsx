"use client";

import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

import type { RunnerPool } from "@/app/api/farm";

import { useFarm } from "./farm-store";
import { NO_POOL_EDITS, type PoolEdits, mergedPools, withRemovedPool, withWrittenPool } from "./pools";

/**
 * The pools as the farm screen draws them, and the one configuration sheet over them
 * (AI.4, [#259](https://github.com/NobuData/ouroboros/issues/259)).
 *
 * Two things on the screen need this at once, which is why it is a provider rather than state in
 * the card:
 *
 * - **The sheet has two doors.** The card's `Configure →` and the head's **Pool settings** open
 *   the same sheet, so *open* is held above both.
 * - **A write is seen before the page catches up.** The card and the sheet both write, and both
 *   draw the pools. The farm's page is one observation up to ten seconds old
 *   (`app/farm/farm-store.tsx`), so a write's answer stands in for the page's copy until a read
 *   made after it lands — `mergedPools` in `app/farm/pools.ts` is the rule — and
 *   {@link PoolsView.recordWrite} asks for that read at once.
 *
 * It holds no pool of its own between writes: with nothing outstanding, what it answers is the
 * page's list, identity and all.
 */

/** What the pools card, the sheet and the head read. */
export interface PoolsView {
  /** The pools to draw, by name — or `null` when the page could not be read. */
  readonly pools: readonly RunnerPool[] | null;
  /** Whether the configuration sheet is open. */
  readonly sheetOpen: boolean;
  /** Open the sheet. */
  readonly openSheet: () => void;
  /** Close it. */
  readonly closeSheet: () => void;
  /** Record a pool as a create or a change answered it, and ask for a fresh page. */
  readonly recordWrite: (pool: RunnerPool) => void;
  /** Record a delete, and ask for a fresh page. */
  readonly recordRemoval: (id: string) => void;
}

/** What is read outside a provider: nothing is known, and nothing opens. */
const NO_POOLS: PoolsView = Object.freeze({
  pools: null,
  sheetOpen: false,
  openSheet: () => {},
  closeSheet: () => {},
  recordWrite: () => {},
  recordRemoval: () => {},
});

/** Defaulted for `app/farm/farm-store.tsx`'s reason: a region rendered alone reads *unknown*. */
const PoolsContext = createContext<PoolsView>(NO_POOLS);

/**
 * Put the pools and their sheet within reach of the head and the card.
 *
 * Must sit under `FarmProvider`: the pools are the farm page's.
 *
 * @param props.children The regions that read it.
 * @returns The regions, wrapped.
 */
export function PoolProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { page, dataAt, refresh } = useFarm();
  const [edits, setEdits] = useState<PoolEdits>(NO_POOL_EDITS);
  const [sheetOpen, setSheetOpen] = useState(false);

  const pools = useMemo(
    () => (page === null || dataAt === null ? null : mergedPools(page.pools, edits, dataAt)),
    [page, dataAt, edits],
  );

  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const recordWrite = useCallback(
    (pool: RunnerPool) => {
      const at = Date.now();

      setEdits((held) => withWrittenPool(held, pool, at));
      refresh();
    },
    [refresh],
  );

  const recordRemoval = useCallback(
    (id: string) => {
      const at = Date.now();

      setEdits((held) => withRemovedPool(held, id, at));
      refresh();
    },
    [refresh],
  );

  const view = useMemo<PoolsView>(
    () => ({ pools, sheetOpen, openSheet, closeSheet, recordWrite, recordRemoval }),
    [pools, sheetOpen, openSheet, closeSheet, recordWrite, recordRemoval],
  );

  return <PoolsContext.Provider value={view}>{children}</PoolsContext.Provider>;
}

/**
 * The pools, and the sheet over them.
 *
 * @returns See {@link PoolsView}.
 */
export function usePools(): PoolsView {
  return useContext(PoolsContext);
}
