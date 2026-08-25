import { Card } from "@/app/ui";

import { ModelsFrame } from "./models-frame";
import { ModelsGrid } from "./models-grid";
import { ROUTING_SUBLINE, ROUTING_TITLE } from "./view";

import "./models.css";

/**
 * What the reader sees while the routing page's two reads are in flight (AA.6,
 * [#205](https://github.com/NobuData/ouroboros/issues/205)).
 *
 * The design system asks every surface to design its loading state rather than leave a
 * blank region (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.3), and Next.js's `loading.tsx` is how
 * a route says what that is: `app/(app)/models/(routing)/loading.tsx` returns this, and the
 * framework wraps the page in a Suspense boundary with it as the fallback, so the shell and
 * the sidebar paint immediately and only the page waits.
 *
 * ### The head is the real head
 *
 * The page's head and tab set are drawn by `ModelsFrame` from copy that does not depend on
 * the reads, so this draws them **as themselves** rather than as bars: the title, the
 * subline and the four tabs are pixel-identical before and after the data lands, which is
 * the one part of the page where a skeleton would have been *worse* than the thing itself.
 * Only the two head actions are bars, because one of them is drawn for a role the skeleton
 * cannot know.
 *
 * ### Below the tabs, each region's own geometry
 *
 * A skeleton exists to stop the page moving when the data lands, and the only way it can is
 * by reserving the height each region will take
 * ([#86](https://github.com/NobuData/ouroboros/issues/86)). So the strip is five chips at a
 * chip's height and margin, the matrix is a card head over a ruled table of eight rows with
 * the table's own padding, and the right column is the inspector's empty seat, three ruled
 * rule rows and four metered spend rows — from classes in `app/models/models.css` that
 * mirror the rules they stand in for. The counts are the seeded workspace's, which is the
 * height most first paints resolve to; a workspace with more or fewer moves by the
 * difference, and no skeleton can know that in advance.
 *
 * **It says one thing to a screen reader, not forty.** The bars carry no text, the region
 * below the tabs is `aria-hidden`, and the frame's `<main>` is `aria-busy` and labelled once.
 *
 * A Server Component with nothing to decide, like the frame it is built from.
 */

/** What the frame's `<main>` is labelled while it is busy. */
export const LOADING_LABEL = "Loading model routing";

/** How many chips the strip reserves — the seeded workspace's five connections. */
export const SKELETON_PROVIDERS = 5;

/** How many rows the matrix reserves — the eight seeded task kinds. */
export const SKELETON_KINDS = 8;

/** How many rows the rules card reserves — the three seeded rules. */
export const SKELETON_RULES = 3;

/** How many rows the spend card reserves — the four seeded provider rows. */
export const SKELETON_SPEND_ROWS = 4;

/**
 * The chips' widths, in turn — the seeded strip's names are of different lengths, and five
 * identical boxes would reserve the wrong width for four of them.
 */
const CHIP_WIDTHS = ["", "models-skeleton__chip--short", "models-skeleton__chip--long", "models-skeleton__chip--long", ""] as const;

/**
 * The skeleton.
 *
 * @returns The frame, with bars where the reads' regions will be.
 */
export function ModelsSkeleton() {
  return (
    <ModelsFrame
      active="routing"
      actions={
        <span aria-hidden className="models-skeleton__actions">
          <span className="models-skeleton__action" />
          <span className="models-skeleton__action" />
        </span>
      }
      busy={LOADING_LABEL}
      subline={ROUTING_SUBLINE}
      title={ROUTING_TITLE}
      tone="model"
    >
      <div aria-hidden className="models-skeleton">
        <div className="models-skeleton__strip">
          {Array.from({ length: SKELETON_PROVIDERS }, (_, index) => (
            <span
              className={`models-skeleton__chip ${CHIP_WIDTHS[index % CHIP_WIDTHS.length]}`.trim()}
              key={index}
            />
          ))}
        </div>

        <ModelsGrid
          main={
            <Card className="models-col--8" fill>
              <span className="models-skeleton__head" />
              <div className="models-skeleton__table">
                <span className="models-skeleton__thead" />
                {Array.from({ length: SKELETON_KINDS }, (_, index) => (
                  <MatrixRowShape key={index} />
                ))}
              </div>
            </Card>
          }
          aside={
            <>
              {/* The inspector's seat, at the empty state's own height: nothing is selected yet. */}
              <Card fill>
                <span className="models-skeleton__head" />
                <span className="models-skeleton__panel" />
              </Card>

              <Card fill>
                <span className="models-skeleton__head" />
                <div className="models-skeleton__rules">
                  {Array.from({ length: SKELETON_RULES }, (_, index) => (
                    <span className="models-skeleton__rule" key={index}>
                      <span className="models-skeleton__bar models-skeleton__bar--grow" />
                      <span className="models-skeleton__switch" />
                    </span>
                  ))}
                </div>
              </Card>

              <Card fill>
                <span className="models-skeleton__head" />
                <div className="models-skeleton__spend">
                  {Array.from({ length: SKELETON_SPEND_ROWS }, (_, index) => (
                    <span className="models-skeleton__spend-row" key={index}>
                      <span className="models-skeleton__bar models-skeleton__bar--half" />
                      <span className="models-skeleton__meter" />
                    </span>
                  ))}
                </div>
                <span className="models-skeleton__bar models-skeleton__bar--half" />
              </Card>
            </>
          }
        />
      </div>
    </ModelsFrame>
  );
}

/**
 * One matrix row: the task cell's two lines, the two alias pills, the escalation sentence and
 * the two figures — six cells at the table's own rhythm.
 *
 * @returns The row.
 */
function MatrixRowShape() {
  return (
    <span className="models-skeleton__row">
      <span className="models-skeleton__task">
        <span className="models-skeleton__bar models-skeleton__bar--kind" />
        <span className="models-skeleton__bar models-skeleton__bar--desc" />
      </span>
      <span className="models-skeleton__pill" />
      <span className="models-skeleton__pill" />
      <span className="models-skeleton__bar" />
      <span className="models-skeleton__bar models-skeleton__bar--num" />
      <span className="models-skeleton__bar models-skeleton__bar--num" />
    </span>
  );
}
