import type { ReactNode } from "react";

import { Card, Eyebrow } from "@/app/ui";

import { FARM_LOADING_LABEL } from "./states";
import { FARM_EYEBROW, FARM_SUBLINE } from "./view";

import "./farm.css";

/**
 * What the reader sees while the build farm's first read is in flight
 * (AI.7, [#262](https://github.com/NobuData/ouroboros/issues/262)).
 *
 * The rule is DASH-I.7's ([#86](https://github.com/NobuData/ouroboros/issues/86)), as
 * `app/(app)/dashboard/loading.tsx` sets it out: a skeleton exists to stop the page moving when
 * the data lands, and the only way it can is by reserving the shape each region will actually
 * take. So this is the screen's own frame (`app/farm/farm-screen.tsx`) — the same `<main>`, the
 * same head, the same twelve-column grid at the same spans — with bars where the live values go:
 *
 * | region | span | stands in for |
 * |---|---|---|
 * | four stat tiles | 3 each | a caption, a tall figure, the line under it |
 * | the runners card | 8 | a card head over five ruled rows — the seeded fleet's five |
 * | the right-hand column | 4 | the enroll card's prose and command block, over the pools' two rows |
 * | the live log card | 12 | a card head over a block of log lines |
 *
 * **What is known before any read is drawn for real**: the eyebrow and the subline are fixed copy,
 * so only the headline — three live values in a sentence — is a bar.
 *
 * **It says one thing to a screen reader, not forty.** The bars carry no text: the `<main>` is
 * marked `aria-busy` and labelled once, and the grid is hidden from the accessibility tree.
 *
 * **The bars do not pulse.** This sheet promises that nothing on the page animates
 * (`__tests__/farm/farm-styles.test.ts`), and a first read of one route is over before a pulse
 * would have been noticed.
 *
 * @returns The skeleton.
 */
export function FarmSkeleton() {
  return (
    <main aria-busy="true" aria-label={FARM_LOADING_LABEL} className="farm">
      <div className="farm__head">
        <div className="farm__headings">
          <Eyebrow>{FARM_EYEBROW}</Eyebrow>
          <Bar shape="title" />
          <p className="farm__sub">{FARM_SUBLINE}</p>
        </div>
      </div>

      <div aria-hidden className="farm__grid">
        {Array.from({ length: STAT_TILES }, (_, index) => (
          // Plain cards, not regions: they name nothing, and the grid is hidden anyway. `fill`
          // so a tile whose bars are shorter than its row still stretches, as the real one does.
          <Card className="farm-col--3" fill key={index}>
            <div className="farm-skeleton">
              <Bar shape="caption" />
              <Bar shape="figure" />
              <Bar shape="line" />
            </div>
          </Card>
        ))}

        <Card className="farm-col--8" fill>
          <Bar shape="head" />
          <Rows count={RUNNER_ROWS} />
        </Card>

        <div className="farm-col--4 farm__side">
          <Card>
            <Bar shape="head" />
            <div className="farm-skeleton">
              <Bar shape="line" />
              <span className="farm-skeleton__block" />
              <Bar shape="line" />
            </div>
          </Card>
          <Card>
            <Bar shape="head" />
            <Rows count={POOL_ROWS} />
          </Card>
        </div>

        <Card className="farm-col--12">
          <Bar shape="head" />
          <span className="farm-skeleton__block" />
        </Card>
      </div>
    </main>
  );
}

/** How many stat tiles the row has — `farmStatRow`'s four. */
const STAT_TILES = 4;

/** How many rows the runners card reserves — the seeded fleet's five, mockup 08's table. */
const RUNNER_ROWS = 5;

/** How many rows the pools card reserves — the mockup's two pools. */
const POOL_ROWS = 2;

/** The bars a region is drawn from, each at the measure of what it stands in for. */
type BarShape = "title" | "caption" | "figure" | "line" | "head";

/**
 * Each shape's classes, as literals — `__tests__/farm/farm-styles.test.ts` holds the sheet and
 * the components to the same class names, and can only see a name that is written out.
 */
const BAR_CLASS: Readonly<Record<BarShape, string>> = {
  title: "farm-skeleton__bar farm-skeleton__bar--title",
  caption: "farm-skeleton__bar farm-skeleton__bar--caption",
  figure: "farm-skeleton__bar farm-skeleton__bar--figure",
  line: "farm-skeleton__bar farm-skeleton__bar--line",
  head: "farm-skeleton__bar farm-skeleton__bar--head",
};

/**
 * One bar, in a line of its own.
 *
 * The line is a flex row and the bar a flex item with its measure as the basis, so a bar wider
 * than a narrow card shrinks to fit rather than pushing the card sideways — without a percentage,
 * which this sheet does not use.
 *
 * @param props.shape Which bar.
 * @returns The line.
 */
function Bar({ shape }: Readonly<{ shape: BarShape }>): ReactNode {
  return (
    <span className="farm-skeleton__line">
      <span className={BAR_CLASS[shape]} />
    </span>
  );
}

/**
 * A card's ruled rows — the runners table's and the pools list's rhythm: a wide cell for the
 * name, a short one for the mark at the trailing edge, and a hairline between rows.
 *
 * @param props.count How many rows the card draws when it has data.
 * @returns The rows.
 */
function Rows({ count }: Readonly<{ count: number }>): ReactNode {
  return (
    <div className="farm-skeleton__rows">
      {Array.from({ length: count }, (_, index) => (
        <span className="farm-skeleton__row" key={index}>
          <span className="farm-skeleton__cell farm-skeleton__cell--grow" />
          <span className="farm-skeleton__cell farm-skeleton__cell--mark" />
        </span>
      ))}
    </div>
  );
}
