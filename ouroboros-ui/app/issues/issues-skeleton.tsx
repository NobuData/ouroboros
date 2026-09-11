import { Card, Eyebrow } from "@/app/ui";

import { ISSUES_EYEBROW, ISSUES_SUBLINE } from "./view";

import "./issues.css";

/**
 * What the reader sees while the intake page's four reads are in flight
 * ([#120](https://github.com/NobuData/ouroboros/issues/120)).
 *
 * The design system asks every surface to design its loading state rather than leave a
 * blank region (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.3), and Next.js's `loading.tsx` is how
 * a route says what that is: `app/(app)/issues/loading.tsx` returns this, and the framework
 * wraps the page in a Suspense boundary with it as the fallback, so the shell and the sidebar
 * paint immediately and only the page waits.
 *
 * ### The head is the real head
 *
 * The eyebrow and the subline are copy that does not depend on the reads, so they are drawn
 * as themselves — pixel-identical before and after the data lands, which is the one part of
 * the page where a skeleton would have been worse than the thing itself. The headline is a
 * bar, because its two figures are the service's; the two actions are bars, because one of
 * them is drawn for a role the skeleton cannot know.
 *
 * ### Below the head, the page's own geometry
 *
 * A skeleton exists to stop the page moving when the data lands, and the only way it can is
 * by reserving the height each region will take
 * ([#86](https://github.com/NobuData/ouroboros/issues/86)). So the filter bar is its card
 * with the three selects, the four seeded chips and the search box at their own heights; the
 * table is a card head over a ruled table of {@link SKELETON_ROWS} rows, each at the row's
 * own rhythm — the checkbox, the issue cell's title line over its tag row, the effort pair,
 * the workflow tag, the model pill and the status pill — from classes in `issues.css` that
 * mirror the cells they stand in for; and the panel is the empty seat it holds beside the
 * table. The counts are the seeded workspace's, which is the height most first paints
 * resolve to.
 *
 * **It says one thing to a screen reader, not fifty.** The bars carry no text, everything
 * below the head is `aria-hidden`, and the `<main>` is `aria-busy` and labelled once.
 *
 * A Server Component with nothing to decide.
 */

/** What the `<main>` is labelled while it is busy. */
export const LOADING_LABEL = "Loading the backlog";

/** How many rows the table reserves — the seeded nine, one page at the mockup's height. */
export const SKELETON_ROWS = 9;

/** How many chips the filter bar reserves — the seeded workspace's four labels. */
export const SKELETON_CHIPS = 4;

/**
 * The skeleton.
 *
 * @returns The page's frame, with bars where the reads' regions will be.
 */
export function IssuesSkeleton() {
  return (
    <main aria-busy="true" aria-label={LOADING_LABEL} className="issues">
      <div className="issues__head">
        <div className="issues__headings">
          <Eyebrow>{ISSUES_EYEBROW}</Eyebrow>
          <span aria-hidden="true" className="issues-skeleton__bar issues-skeleton__bar--title" />
          <p className="issues__sub">{ISSUES_SUBLINE}</p>
        </div>
        <div aria-hidden="true" className="issues__actions">
          <span className="issues-skeleton__action" />
          <span className="issues-skeleton__action" />
        </div>
      </div>

      <div aria-hidden="true" className="issues-skeleton">
        <Card className="issues-filter">
          <div className="issues-filter__row">
            <span className="issues-skeleton__select" />
            <span className="issues-filter__chips">
              {Array.from({ length: SKELETON_CHIPS }, (_, index) => (
                <span className="issues-skeleton__chip" key={index} />
              ))}
            </span>
            <span className="issues-skeleton__select" />
            <span className="issues-skeleton__select issues-skeleton__select--wide" />
            <span className="issues-skeleton__search" />
          </div>
        </Card>

        <div className="issues__grid">
          <div className="issues__main">
            <Card as="section">
              <span className="issues-skeleton__head" />
              <span className="issues-skeleton__thead" />
              {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <RowShape key={index} />
              ))}
            </Card>
          </div>
          <div className="issues__aside">
            <Card as="section" className="issues-panel">
              <span className="issues-skeleton__head" />
              <span className="issues-skeleton__panel" />
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * One row of the table: six cells at the row's own rhythm — the checkbox, the issue cell's
 * title over its tags, the effort chip beside its confidence, the workflow tag, the model
 * pill, the status pill.
 *
 * @returns The row.
 */
function RowShape() {
  return (
    <span className="issues-skeleton__row">
      <span className="issues-skeleton__check" />
      <span className="issues-skeleton__issue">
        <span className="issues-skeleton__bar issues-skeleton__bar--line" />
        <span className="issues-skeleton__tags">
          <span className="issues-skeleton__tag" />
          <span className="issues-skeleton__tag" />
        </span>
      </span>
      <span className="issues-skeleton__effort">
        <span className="issues-skeleton__pill" />
        <span className="issues-skeleton__bar issues-skeleton__bar--conf" />
      </span>
      <span className="issues-skeleton__tag" />
      <span className="issues-skeleton__pill issues-skeleton__pill--model" />
      <span className="issues-skeleton__pill" />
    </span>
  );
}
