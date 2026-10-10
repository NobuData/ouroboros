"use client";

import type { ReactNode } from "react";

import { Card, CardHead, EmptyState, cx } from "@/app/ui";

import { type RegionPlace, type ResearchRegion, regionTitleId } from "./view";

/**
 * A region's seat in the Research grid
 * (CN.1, [#627](https://github.com/NobuData/ouroboros/issues/627)).
 *
 * The frame owns two facts about every card and the card owns neither: **where it sits** (the
 * mockup's `c-7`, side column or `c-12`) and **the id an action or an anchor lands on**. So
 * CN.2–CN.6 mount a card by rendering it inside its seat and nothing else.
 *
 * A seat is a programmatic focus target (`tabIndex={-1}`) and never a tab stop: the head's
 * actions move the reader to one, and a keyboard reader's next <kbd>Tab</kbd> then continues from
 * it rather than from the head.
 *
 * ### Empty, it says what is coming
 *
 * A seat with no card is not blank (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.5): it draws the
 * region's heading and one line naming what fills it and the issue that builds it —
 * {@link SeatPlaceholder}.
 */

/** The class for each place — literals, so the style suite can see every one. */
const PLACE_CLASS: Record<RegionPlace, string> = {
  main: "research__seat--main",
  side: "research__seat--side",
  wide: "research__seat--wide",
};

/** What a seat takes. */
export interface ResearchSeatProps {
  /** Which region this is. */
  readonly region: ResearchRegion;
  /** Whether an action just sent the reader here, so the seat is drawn ringed. */
  readonly highlighted: boolean;
  /** Called when focus leaves the seat — what ends the highlight. */
  readonly onLeave: () => void;
  /** The region's card. Omitted, the seat draws its placeholder. */
  readonly children?: ReactNode;
}

/**
 * The seat.
 *
 * @param props See {@link ResearchSeatProps}.
 * @returns The grid cell — carrying the region's id — with the card, or the placeholder, in it.
 */
export function ResearchSeat({ region, highlighted, onLeave, children }: ResearchSeatProps) {
  return (
    <div
      className={cx(
        "research__seat",
        PLACE_CLASS[region.place],
        highlighted && "research__seat--highlight",
      )}
      id={region.id}
      onBlur={(event) => {
        // Focus moving between two things inside the seat has not left it.
        if (!event.currentTarget.contains(event.relatedTarget)) onLeave();
      }}
      tabIndex={-1}
    >
      {children ?? <SeatPlaceholder region={region} />}
    </div>
  );
}

/**
 * What a seat draws until its card exists: the region's heading, and what is coming.
 *
 * @param props.region The region.
 * @returns The card.
 */
export function SeatPlaceholder({ region }: Readonly<{ region: ResearchRegion }>) {
  const titleId = regionTitleId(region.id);

  return (
    <Card aria-labelledby={titleId} as="section">
      <CardHead title={region.title} titleId={titleId} />
      <EmptyState note={region.arrives} variant="flush" />
    </Card>
  );
}
