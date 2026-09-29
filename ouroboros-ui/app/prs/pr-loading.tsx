import { Card, Eyebrow } from "@/app/ui";

import { PR_EYEBROW } from "./view";

import "./prs.css";

/** What the skeleton's `<main>` says to a screen reader. */
export const PR_LOADING_LABEL = "Loading the pull request";

/** How many steps the skeleton's strip draws — the mockup's four. */
export const SKELETON_STEPS = 4;

/** How many rows the skeleton's gates card draws — the mockup's seven. */
export const SKELETON_GATES = 7;

/**
 * The cards under the gates, by the rows each draws — criteria, changed files, review thread,
 * merge plan and spend.
 */
export const SKELETON_CARD_ROWS: readonly number[] = [5, 3, 3, 4, 2];

/**
 * The PR verification page while its first read is in flight
 * ([#370](https://github.com/NobuData/ouroboros/issues/370); a sentence since
 * [#363](https://github.com/NobuData/ouroboros/issues/363)).
 *
 * Every region's own geometry — the head's eyebrow, headline and meta row, the revision cycle
 * strip, the gates card's seven rows and the cards under it — so the page does not jump when the
 * answer lands. The bars do not pulse, for the run console skeleton's reason: a bar is a
 * placeholder's geometry, not a progress report. They are hidden from the accessibility tree,
 * and the `<main>` says *loading* once.
 *
 * @returns The skeleton.
 */
export function PrLoading() {
  return (
    <main aria-busy="true" aria-label={PR_LOADING_LABEL} className="prv">
      <div className="prv-head">
        <div className="prv-head__main">
          <Eyebrow>{PR_EYEBROW}</Eyebrow>
          <div aria-hidden className="prv-skeleton__head">
            <span className="prv-skeleton__bar prv-skeleton__bar--title" />
            <span className="prv-skeleton__bar prv-skeleton__bar--meta" />
          </div>
        </div>
      </div>

      <div aria-hidden className="prv-skeleton">
        <Card className="prv-skeleton__card">
          <span className="prv-skeleton__bar prv-skeleton__bar--heading" />
          <div className="prv-skeleton__steps">
            {Array.from({ length: SKELETON_STEPS }, (_, index) => (
              <span className="prv-skeleton__step" key={index} />
            ))}
          </div>
        </Card>

        <Card className="prv-skeleton__card">
          <span className="prv-skeleton__bar prv-skeleton__bar--heading" />
          {Array.from({ length: SKELETON_GATES }, (_, index) => (
            <span className="prv-skeleton__bar prv-skeleton__bar--row" key={index} />
          ))}
        </Card>

        {SKELETON_CARD_ROWS.map((rows, card) => (
          <Card className="prv-skeleton__card" key={card}>
            <span className="prv-skeleton__bar prv-skeleton__bar--heading" />
            {Array.from({ length: rows }, (_, index) => (
              <span className="prv-skeleton__bar prv-skeleton__bar--row" key={index} />
            ))}
          </Card>
        ))}
      </div>
    </main>
  );
}
