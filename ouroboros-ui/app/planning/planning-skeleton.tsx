import { Card, Eyebrow } from "@/app/ui";

import { PLANNING_EYEBROW, PLANNING_SUBLINE, PLANNING_TITLE } from "./view";

import "./planning.css";

/**
 * What the reader sees while the planning page's reads are in flight (AM.5,
 * [#287](https://github.com/NobuData/ouroboros/issues/287)).
 *
 * The design system asks every surface to design its loading state rather than leave a blank region
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.3), and Next.js's `loading.tsx` is how a route says what
 * that is: the framework wraps the segment in a Suspense boundary with this as the fallback, so the
 * shell, the sidebar and this frame paint immediately and only the cards wait.
 *
 * ### The head is real, because none of it is read
 *
 * The eyebrow, the heading and the subline are constants (`view.ts`), so they are drawn as
 * themselves rather than as bars — which makes the head's height exactly right by construction
 * instead of by estimate. Only the two actions are bars: whether **New roadmap** is live depends on
 * a role this component has not been told.
 *
 * ### The grid is the page's own, so nothing moves when the data lands
 *
 * A skeleton earns its place by reserving the geometry the real thing will take
 * ([#86](https://github.com/NobuData/ouroboros/issues/86)), so this renders `planning__grid` and
 * its three seats — the generator's `c-7`, the side column's `c-5` with its two stacked cards, and
 * the roadmap's `c-12` — from the page's own classes. The bars inside each mirror that card's real
 * parts: a prompt block and a control row for the generator, three rows for tracker sync, three
 * captioned meters for backlog health, and lane rows for the gantt.
 *
 * **It says one thing to a screen reader, not forty.** The bars are decoration: they carry no text,
 * the grid is `aria-hidden`, and the page is marked busy and labelled once.
 */

/** What the `<main>` is named while it loads. */
export const LOADING_LABEL = "Loading planning";

/** How many tracker-sync rows the skeleton reserves — the mockup's three trackers. */
export const SYNC_ROWS = 3;

/** How many health meters it reserves — sized, blocked, stale. */
export const HEALTH_METERS = 3;

/** How many gantt lanes it reserves — the seeded roadmap's five. */
export const GANTT_LANES = 5;

/**
 * One bar.
 *
 * @param props.className The modifier, or nothing for the default bar.
 * @returns The bar.
 */
function Bar({ className }: Readonly<{ className?: string }>) {
  return <span className={className ?? "planning-skeleton__bar"} />;
}

/**
 * The skeleton.
 *
 * @returns The page's head, drawn for real, over the grid's reserved seats.
 */
export function PlanningSkeleton() {
  return (
    <main aria-busy="true" aria-label={LOADING_LABEL} className="planning">
      <div className="planning__head">
        <div className="planning__headings">
          <Eyebrow>{PLANNING_EYEBROW}</Eyebrow>
          <h1 className="planning__title">{PLANNING_TITLE}</h1>
          <p className="planning__sub">{PLANNING_SUBLINE}</p>
        </div>
        <div aria-hidden className="planning__actions">
          <Bar className="planning-skeleton__button" />
          <Bar className="planning-skeleton__button" />
        </div>
      </div>

      <div aria-hidden className="planning__grid">
        <div className="planning__generator">
          <Card className="planning__region" fill>
            <div className="planning-skeleton__head">
              <Bar className="planning-skeleton__bar planning-skeleton__bar--title" />
            </div>
            <div className="planning-skeleton__stack">
              <Bar className="planning-skeleton__bar planning-skeleton__bar--short" />
              <Bar className="planning-skeleton__prompt" />
              <div className="planning-skeleton__row">
                <Bar className="planning-skeleton__seg" />
                <Bar className="planning-skeleton__button" />
              </div>
              <Bar className="planning-skeleton__bar planning-skeleton__bar--short" />
            </div>
          </Card>
        </div>

        <div className="planning__side">
          <Card className="planning__region" fill>
            <div className="planning-skeleton__head">
              <Bar className="planning-skeleton__bar planning-skeleton__bar--title" />
            </div>
            <ul className="planning-sync planning-skeleton__list">
              {Array.from({ length: SYNC_ROWS }, (_, index) => (
                <li className="planning-sync__row" key={index}>
                  <Bar className="planning-skeleton__monogram" />
                  <span className="planning-sync__text">
                    <Bar className="planning-skeleton__bar planning-skeleton__bar--short" />
                    <Bar className="planning-skeleton__bar" />
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="planning__region" fill>
            <div className="planning-skeleton__head">
              <Bar className="planning-skeleton__bar planning-skeleton__bar--title" />
            </div>
            <div className="planning-health__meters">
              {Array.from({ length: HEALTH_METERS }, (_, index) => (
                <div className="planning-health__meter" key={index}>
                  <div className="planning-health__row">
                    <Bar className="planning-skeleton__bar planning-skeleton__bar--short" />
                  </div>
                  <Bar className="planning-skeleton__meter" />
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="planning__roadmap">
          <Card className="planning__region">
            <div className="planning-skeleton__head">
              <Bar className="planning-skeleton__bar planning-skeleton__bar--title" />
            </div>
            <div className="planning-skeleton__stack">
              {Array.from({ length: GANTT_LANES }, (_, index) => (
                <div className="planning-skeleton__lane" key={index}>
                  <Bar className="planning-skeleton__bar planning-skeleton__bar--short" />
                  <Bar className="planning-skeleton__lane-bar" />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
