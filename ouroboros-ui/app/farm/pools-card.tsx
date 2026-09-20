"use client";

import { useId, useOptimistic, useState, useTransition } from "react";

import type { RunnerPool, RunnerPoolChange } from "@/app/api/farm";
import { Button, Card, CardHead, EmptyState, Toggle } from "@/app/ui";

import { updatePool } from "./pool-actions";
import { PoolSheet } from "./pool-sheet";
import { usePools } from "./pool-store";
import {
  AUTOSCALE_AFFIX,
  AUTOSCALE_KEEP,
  CONFIGURE,
  NO_POOLS_MEMBER_NOTE,
  NO_POOLS_NOTE,
  NO_POOLS_TITLE,
  POOLS_TITLE,
  POOLS_UNREAD,
  POOL_MEMBER_REASON,
  autoscaleLabel,
  autoscaleView,
  enableLabel,
  nextAutoscalePref,
  poolMeta,
} from "./pools";

/**
 * The build farm's POOLS card — mockup 08's, with switches that persist
 * (AI.4, [#259](https://github.com/NobuData/ouroboros/issues/259)).
 *
 * What it says and every judgement it makes is `app/farm/pools.ts`'s; the pools it draws and the
 * sheet it opens are `app/farm/pool-store.tsx`'s. This draws.
 *
 * - **The meta line is composed from truth** — the description, the image a container pool pins
 *   and the live runner count (`poolMeta`). It moves with every poll, like the table beside it.
 * - **The enable switch persists** through AH.6's `PATCH` (#254). A disabled pool takes no new
 *   work and keeps what it is running: operator intent, not a delete.
 * - **The auto-scale sub-toggle persists and nothing acts on it** (decision **B9**) — so it
 *   carries `arrives with cloud runners (v2)` as **text beside it**, in the switch's description
 *   too, never a tooltip somebody has to hover to find. AJ.1 (#263) removes the affix.
 * - **`Configure →`** opens the configuration sheet, as the head's **Pool settings** does.
 *
 * ### A reader who may not write
 *
 * Sees every switch in its real position, marked and explained (design system § 3.3, § 3.5), and
 * may still open the sheet to read how a pool is configured. That is *presentation*; the gate
 * that decides is the service's.
 *
 * @param props.mayAdminister Whether this reader may change a pool — `mayAdminister`, from the
 *   route.
 * @returns The card, for the farm's right-hand column.
 */
export function PoolsCard({ mayAdminister }: Readonly<{ mayAdminister: boolean }>) {
  const { pools, openSheet } = usePools();

  return (
    <Card aria-labelledby={TITLE_ID} as="section">
      <CardHead
        title={POOLS_TITLE}
        titleId={TITLE_ID}
        trailing={
          <Button onClick={openSheet} reason={pools === null ? POOLS_UNREAD : undefined} size="sm" tone="ghost">
            {CONFIGURE}
          </Button>
        }
      />

      {pools === null ? (
        <EmptyState title={POOLS_UNREAD} />
      ) : pools.length === 0 ? (
        <EmptyState note={mayAdminister ? NO_POOLS_NOTE : NO_POOLS_MEMBER_NOTE} title={NO_POOLS_TITLE} />
      ) : (
        <ul className="farm-pools__list">
          {pools.map((pool) => (
            <PoolRow key={pool.id} mayAdminister={mayAdminister} pool={pool} />
          ))}
        </ul>
      )}

      <PoolSheet mayAdminister={mayAdminister} />
    </Card>
  );
}

/** The id the card's `aria-labelledby` points at. */
const TITLE_ID = "pools-card-title";

/**
 * One pool: its name, its composed line, its switch — and its auto-scale sub-toggle where a
 * preference is stored.
 *
 * Both switches move when pressed and reconcile afterwards: the optimistic position lives as
 * long as the transition that set it, so a flip the service refused goes back on its own with
 * the reason under the row, and one it took is held by the store until the page catches up.
 *
 * @param props.pool The pool.
 * @param props.mayAdminister Whether this reader may change it.
 * @returns The row.
 */
function PoolRow({ pool, mayAdminister }: Readonly<{ pool: RunnerPool; mayAdminister: boolean }>) {
  const { recordWrite } = usePools();
  const [pending, startWrite] = useTransition();
  const [enabled, setEnabled] = useOptimistic(pool.enabled);
  const autoscale = autoscaleView(pool);
  const [scaling, setScaling] = useOptimistic(autoscale?.on ?? false);
  const [failure, setFailure] = useState<string | null>(null);
  const affixId = useId();
  const reason = mayAdminister ? undefined : POOL_MEMBER_REASON;

  /**
   * Send one change, showing it at once.
   *
   * @param change The change — one field of the pool.
   * @param show Move the switch that was pressed.
   */
  function write(change: RunnerPoolChange, show: () => void): void {
    if (pending) return;

    setFailure(null);

    startWrite(async () => {
      show();

      const outcome = await updatePool(pool.id, change);

      if (outcome.ok) recordWrite(outcome.pool);
      else setFailure(outcome.reason);
    });
  }

  return (
    <li className="farm-pool">
      <div className="farm-pool__info">
        <div className="farm-pool__name">{pool.name}</div>
        <div className="farm-pool__meta">{poolMeta(pool)}</div>

        {autoscale !== null && (
          <div className="farm-pool__subtoggle">
            <Toggle
              checked={scaling}
              describedBy={affixId}
              label={autoscaleLabel(pool.name, scaling)}
              onClick={() =>
                write({ autoscalePref: nextAutoscalePref(pool, !scaling) }, () => setScaling(!scaling))
              }
              reason={reason}
            />
            <div>
              <div className="farm-pool__scale">{autoscale.sentence}</div>
              <div className="farm-pool__keep">{AUTOSCALE_KEEP}</div>
              <div className="farm-pool__affix" id={affixId}>
                — {AUTOSCALE_AFFIX}
              </div>
            </div>
          </div>
        )}

        {failure !== null && (
          <p className="farm-pool__failure" role="alert">
            {failure}
          </p>
        )}
      </div>

      <Toggle
        checked={enabled}
        label={enableLabel({ name: pool.name, enabled })}
        onClick={() => write({ enabled: !enabled }, () => setEnabled(!enabled))}
        reason={reason}
      />
    </li>
  );
}
