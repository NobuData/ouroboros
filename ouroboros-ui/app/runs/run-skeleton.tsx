import { Card, Eyebrow } from "@/app/ui";

import { RUN_EYEBROW } from "./view";

import "./runs.css";

/** What the skeleton's `<main>` says to a screen reader. */
export const RUN_LOADING_LABEL = "Loading the run";

/** How many stepper nodes the skeleton draws — the seeded workflow's eight. */
export const SKELETON_STEPS = 8;

/** How many transcript lines the skeleton's well draws. */
export const SKELETON_ENTRIES = 6;

/** The right column's cards, by the rows each one draws — Changes, Resources, Guardrails. */
export const SKELETON_SIDE_ROWS: readonly number[] = [4, 4, 4];

/**
 * The run console while its first read is in flight
 * ([#309](https://github.com/NobuData/ouroboros/issues/309); the whole page since
 * [#314](https://github.com/NobuData/ouroboros/issues/314)).
 *
 * Every region's own geometry — the head's eyebrow, headline and meta row, the stage timeline's
 * row of nodes, the transcript's well, and the right column's three cards in the 7/5 split — so
 * the page does not jump when the answer lands. The bars do not pulse, for the farm skeleton's
 * reason, and are hidden from the accessibility tree; the `<main>` says *loading* once.
 *
 * @returns The skeleton.
 */
export function RunSkeleton() {
  return (
    <main aria-busy="true" aria-label={RUN_LOADING_LABEL} className="run">
      <div className="run-head">
        <div className="run-head__main">
          <Eyebrow>{RUN_EYEBROW}</Eyebrow>
          <div aria-hidden className="run-skeleton">
            <span className="run-skeleton__bar run-skeleton__bar--title" />
            <span className="run-skeleton__bar run-skeleton__bar--meta" />
          </div>
        </div>
      </div>

      <div aria-hidden className="run-skeleton__region">
        <Card className="run-skeleton__timeline">
          <span className="run-skeleton__bar run-skeleton__bar--heading" />
          <div className="run-skeleton__steps">
            {Array.from({ length: SKELETON_STEPS }, (_, index) => (
              <span className="run-skeleton__step" key={index} />
            ))}
          </div>
        </Card>

        <div className="run__body">
          <div className="run__main">
            <Card className="run-skeleton__transcript">
              <span className="run-skeleton__bar run-skeleton__bar--heading" />
              <div className="run-skeleton__well">
                {Array.from({ length: SKELETON_ENTRIES }, (_, index) => (
                  <span className="run-skeleton__bar run-skeleton__bar--line" key={index} />
                ))}
              </div>
            </Card>
          </div>

          <div className="run__side">
            {SKELETON_SIDE_ROWS.map((rows, card) => (
              <Card className="run-skeleton__card" key={card}>
                <span className="run-skeleton__bar run-skeleton__bar--heading" />
                {Array.from({ length: rows }, (_, index) => (
                  <span className="run-skeleton__bar run-skeleton__bar--row" key={index} />
                ))}
              </Card>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
