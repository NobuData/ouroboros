"use client";

import { type Ref, useId } from "react";

import { Card, CardHead } from "@/app/ui";

/** The element id *Merge when all gates green* lands on — AY.7's card keeps it (#369). */
export const MERGE_PLAN_ID = "merge-plan";

/** The card's title — the mockup's `MERGE PLAN`. */
export const MERGE_PLAN_TITLE = "Merge plan";

/** What the slot says before the head has handed anything to it. */
export const NOTHING_CHOSEN =
  "Nothing is armed. Merge when all gates green brings the reader here to confirm its terms.";

/**
 * What the slot says once the head has handed off, until AY.7 draws the card.
 *
 * @param revisionSeq The revision the reader was looking at.
 * @returns The sentence — which says, above all, that nothing has been armed.
 */
export function handedOff(revisionSeq: number): string {
  return (
    `Merge when all gates green was chosen for revision ${revisionSeq}. Confirming its terms and ` +
    "arming arrives with the Merge plan card (#369) — nothing has been armed."
  );
}

/**
 * Where *Merge when all gates green* lands ([#363](https://github.com/NobuData/ouroboros/issues/363))
 * — the Merge plan card's place on the page.
 *
 * Arming is a promise about the future, and the card that states its exact terms is AY.7's
 * ([#369](https://github.com/NobuData/ouroboros/issues/369)). Until it is drawn, this is the honest
 * slot: it takes focus, names the revision the reader chose to arm against, and says that nothing
 * has been armed — rather than arming on a single click, or offering a control that does nothing.
 * AY.7 replaces the body and keeps {@link MERGE_PLAN_ID}, the ref and the `chosen` prop.
 *
 * @param props.chosen The revision the head handed off for, by its ordinal, or `null`.
 * @param props.ref The region, for the screen to scroll to and focus.
 * @returns The slot.
 */
export function MergePlanSlot({
  chosen,
  ref,
}: Readonly<{ chosen: number | null; ref?: Ref<HTMLElement> }>) {
  const titleId = useId();

  return (
    <section
      aria-labelledby={titleId}
      className="prv-merge"
      id={MERGE_PLAN_ID}
      ref={ref}
      tabIndex={-1}
    >
      <Card>
        <CardHead title={MERGE_PLAN_TITLE} titleId={titleId} />
        <p className="prv-merge__note">{chosen === null ? NOTHING_CHOSEN : handedOff(chosen)}</p>
      </Card>
    </section>
  );
}
