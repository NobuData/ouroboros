import { Card, Eyebrow } from "@/app/ui";

import { TESTS_EYEBROW } from "./view";

import "./tests.css";

/** What the skeleton's `<main>` says to a screen reader. */
export const TESTS_LOADING_LABEL = "Loading the test results";

/** How many stat cards the skeleton's strip draws — the mockup's five. */
export const SKELETON_STATS = 5;

/** How many attempt cards the skeleton's timeline draws. */
export const SKELETON_ATTEMPTS = 3;

/** How many rows the skeleton's suites card draws. */
export const SKELETON_SUITES = 5;

/** The cards under the suites, by the rows each draws — physical, failure, route, artifacts. */
export const SKELETON_CARD_ROWS: readonly number[] = [3, 4, 2, 3];

/**
 * The test-results page while its first read is in flight
 * ([#342](https://github.com/NobuData/ouroboros/issues/342); a sentence since
 * [#335](https://github.com/NobuData/ouroboros/issues/335)).
 *
 * Every region's own geometry — the head's eyebrow, headline and meta row, the attempts timeline,
 * the five-stat strip, the suites card and the cards under it — so the page does not jump when
 * the answer lands. The bars do not pulse, for the run console skeleton's reason, and are hidden
 * from the accessibility tree; the `<main>` says *loading* once.
 *
 * @returns The skeleton.
 */
export function TestsLoading() {
  return (
    <main aria-busy="true" aria-label={TESTS_LOADING_LABEL} className="tests">
      <div className="tests-head">
        <div className="tests-head__main">
          <Eyebrow>{TESTS_EYEBROW}</Eyebrow>
          <div aria-hidden className="tests-skeleton__head">
            <span className="tests-skeleton__bar tests-skeleton__bar--title" />
            <span className="tests-skeleton__bar tests-skeleton__bar--meta" />
          </div>
        </div>
      </div>

      <div aria-hidden className="tests-skeleton">
        <Card className="tests-skeleton__card">
          <span className="tests-skeleton__bar tests-skeleton__bar--heading" />
          <div className="tests-skeleton__attempts">
            {Array.from({ length: SKELETON_ATTEMPTS }, (_, index) => (
              <span className="tests-skeleton__attempt" key={index} />
            ))}
          </div>
        </Card>

        <div className="tests-strip">
          {Array.from({ length: SKELETON_STATS }, (_, index) => (
            <Card
              className={
                index === SKELETON_STATS - 1
                  ? "tests-strip__stat tests-strip__stat--wide tests-skeleton__stat"
                  : "tests-strip__stat tests-skeleton__stat"
              }
              key={index}
            >
              <span className="tests-skeleton__bar tests-skeleton__bar--label" />
              <span className="tests-skeleton__bar tests-skeleton__bar--figure" />
            </Card>
          ))}
        </div>

        <Card className="tests-skeleton__card">
          <span className="tests-skeleton__bar tests-skeleton__bar--heading" />
          {Array.from({ length: SKELETON_SUITES }, (_, index) => (
            <span className="tests-skeleton__bar tests-skeleton__bar--row" key={index} />
          ))}
        </Card>

        {SKELETON_CARD_ROWS.map((rows, card) => (
          <Card className="tests-skeleton__card" key={card}>
            <span className="tests-skeleton__bar tests-skeleton__bar--heading" />
            {Array.from({ length: rows }, (_, index) => (
              <span className="tests-skeleton__bar tests-skeleton__bar--row" key={index} />
            ))}
          </Card>
        ))}
      </div>
    </main>
  );
}
