import { Card } from "@/app/ui";

import "@/app/dashboard/dashboard.css";

/**
 * What the reader sees while the dashboard's four reads are in flight.
 *
 * The design system asks every surface to design its loading state rather than leave a
 * blank region (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.3), and Next.js's `loading.tsx` is
 * how a route says what that is: the framework wraps the segment in a Suspense boundary
 * with this as the fallback, so the shell, the sidebar and the page's own frame are painted
 * immediately and only the cards wait.
 *
 * It is the grid it stands in for — four tiles, then the mockup's wide pairs — at the same
 * spans and roughly the same heights, so the page does not jump when the data arrives.
 *
 * **It says one thing to a screen reader, not thirty.** The bars are decoration: they carry
 * no text, and the region is marked `aria-busy` and labelled once. Reading out a dozen
 * empty boxes would be worse than saying nothing.
 *
 * @returns The skeleton.
 */
export default function Loading() {
  return (
    <div className="dash" aria-busy="true" aria-label="Loading the dashboard">
      <div className="dash__head">
        <div className="dash__headings dash-skeleton">
          <span className="dash-skeleton__bar dash-skeleton__bar--half" />
          <span className="dash-skeleton__bar dash-skeleton__bar--tall" />
        </div>
      </div>

      <div className="dash-grid" aria-hidden>
        {SPANS.map((span, index) => (
          // A plain card, not a region: it names nothing, and nine unnamed regions in the
          // accessibility tree would be worse than the `aria-hidden` this grid already
          // carries.
          <Card className={`dash-col--${span}`} key={index}>
            <div className="dash-skeleton">
              <span className="dash-skeleton__bar dash-skeleton__bar--half" />
              <span className="dash-skeleton__bar dash-skeleton__bar--wide" />
              <span className="dash-skeleton__bar dash-skeleton__bar--half" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * The column spans of the cards being waited for, in the order the screen lays them out:
 * the four-tile stat row, then the mockup's wide pairs with the two `c-4` cards between
 * them.
 *
 * Written down here rather than derived from the screen because they are the *shape* of the
 * page, which is exactly what a skeleton is for — a skeleton computed from the data it is
 * standing in for would have nothing to draw.
 */
const SPANS = [3, 3, 3, 3, 8, 4, 4, 7, 5] as const;
