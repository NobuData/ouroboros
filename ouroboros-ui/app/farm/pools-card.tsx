"use client";

import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";

import type { RunnerPool, RunnerPoolChange } from "@/app/api/farm";
import { Button, Card, CardHead, EmptyState, Eyebrow, Toggle } from "@/app/ui";

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
import { CREATE_POOL, STEP_ONE, isPromoted, stepEyebrow } from "./states";
import { SUBMIT_BUILD, SUBMIT_POOL_DISABLED, submitToPoolLabel } from "./submit";
import { useSubmit } from "./submit-store";
import { useFirstRun } from "./use-first-run";

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
 * ### With no pool yet, it says how to make one
 *
 * A workspace's first pool comes before its first runner — a token always names the pool a runner
 * joins — so an empty card is a **Create a pool** control, not a sentence pointing at another one
 * (AI.7, [#262](https://github.com/NobuData/ouroboros/issues/262)). It opens the configuration
 * sheet, which opens on its blank form when there is no pool to configure. During that first run
 * the card is **Step one** and takes the promoted border (`stepEyebrow` in `app/farm/states.ts`),
 * and the grid puts it first (`app/farm/farm-grid.tsx`).
 *
 * **The control unmounts when the first pool lands**, which would leave the sheet's closing focus
 * with nowhere to return to; the card catches that and hands focus to `Configure →`, so a
 * keyboard reader is not dropped on `<body>`.
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
  const { pools, openSheet, sheetOpen } = usePools();
  const firstRun = useFirstRun();
  const step = mayAdminister ? stepEyebrow(firstRun, "pools") : null;
  const configure = useRef<HTMLSpanElement>(null);
  const wasOpen = useRef(false);

  // The sheet hands focus back to whatever opened it, and **Create a pool** is gone by then if
  // the pool was created. Rescue only: a reader whose focus is anywhere real is left there.
  useEffect(() => {
    if (sheetOpen) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;

    wasOpen.current = false;
    if (document.activeElement !== document.body) return;

    configure.current?.querySelector<HTMLElement>("button")?.focus();
  }, [sheetOpen]);

  return (
    <Card
      aria-labelledby={TITLE_ID}
      as="section"
      className={mayAdminister && isPromoted(firstRun, "pools") ? "farm-promoted" : undefined}
    >
      {step !== null && <Eyebrow tone={step === STEP_ONE ? "accent" : "quiet"}>{step}</Eyebrow>}
      <CardHead
        title={POOLS_TITLE}
        titleId={TITLE_ID}
        trailing={
          // `display: contents`: somewhere for the focus rescue to look, and no box on screen.
          <span className="farm-pools__configure" ref={configure}>
            <Button
              onClick={openSheet}
              reason={pools === null ? POOLS_UNREAD : undefined}
              size="sm"
              tone="ghost"
            >
              {CONFIGURE}
            </Button>
          </span>
        }
      />

      {pools === null ? (
        <EmptyState title={POOLS_UNREAD} />
      ) : pools.length === 0 ? (
        <EmptyState note={mayAdminister ? NO_POOLS_NOTE : NO_POOLS_MEMBER_NOTE} title={NO_POOLS_TITLE}>
          {mayAdminister && (
            <Button onClick={openSheet} size="sm" tone="primary">
              {CREATE_POOL}
            </Button>
          )}
        </EmptyState>
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
 * **Submit build** (AI.5, [#260](https://github.com/NobuData/ouroboros/issues/260)) is the
 * row's door to the submit dialog, opening it on this pool (`app/farm/submit-store.tsx`). It is
 * **absent for a member** — the issue asks that a member see no action affordances — and, for an
 * administrator, inert with the reason on a pool that is switched off, which the service would
 * refuse a build for. It follows the switch as drawn, so flipping a pool off disables its door
 * in the same moment.
 *
 * @param props.pool The pool.
 * @param props.mayAdminister Whether this reader may change it.
 * @returns The row.
 */
function PoolRow({ pool, mayAdminister }: Readonly<{ pool: RunnerPool; mayAdminister: boolean }>) {
  const { recordWrite } = usePools();
  const { open: openSubmit } = useSubmit();
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

        {mayAdminister && (
          <div className="farm-pool__submit">
            <Button
              aria-label={submitToPoolLabel(pool.name)}
              onClick={() => openSubmit(pool.name)}
              reason={enabled ? undefined : SUBMIT_POOL_DISABLED}
              size="sm"
              tone="ghost"
            >
              {SUBMIT_BUILD}
            </Button>
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
