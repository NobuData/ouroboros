import { Card, cx } from "@/app/ui";

import { StudioFrame } from "../studio-frame";

import "./code-panel.css";
import "./code-status-bar.css";
import "./code-view.css";
import "./code-workbench.css";

/**
 * What the reader sees while the code view's reads are in flight (V.1,
 * [#169](https://github.com/NobuData/ouroboros/issues/169); the workbench's geometry since V.7,
 * [#175](https://github.com/NobuData/ouroboros/issues/175)).
 *
 * The visual editor's skeleton (`app/workflows/studio-skeleton.tsx`) in the code view's shape:
 * the same frame, so the eyebrow and the segmented control are drawn as themselves — with
 * **Code** marked current — and the title and the subline as bars at their own height; then the
 * head's **two** actions rather than three. The head's bars reuse the studio skeleton's classes,
 * because they are the same head.
 *
 * ### Below the control, the workbench's own geometry
 *
 * A skeleton exists to stop the page moving when the data lands (#86), so the card is drawn **on the
 * workbench's own layout classes** rather than bars sized to imitate them: the narrow viewport's row
 * of toggles, the explorer's track (its head, the `workflows/` directory with the seeded workspace's
 * files, and `ouroboros.config.ts`), the tab strip with one open tab, the pane's source line over the
 * editor's well at the editor's own bounded height, the right panel's track, and the status bar. The
 * explorer and the panel therefore hide below 1000px exactly when the loaded ones do, and the row of
 * toggles shows exactly then. Only the bars inside are the skeleton's (`code-view.css`).
 *
 * Every bar carries a zero-width space, so it takes its row's own line box — a bar in the tab strip
 * is as tall as a tab's name — and is transparent ink on a raised ground.
 *
 * **It says one thing to a screen reader, not twenty.** The card is `aria-hidden`, and the frame's
 * `<main>` is `aria-busy` and labelled once.
 *
 * A Server Component with nothing to decide; `app/(app)/workflows/[slug]/code/loading.tsx` hands
 * it the slug.
 */

/** What the frame's `<main>` is labelled while it is busy. */
export const CODE_LOADING_LABEL = "Loading the workflow's code";

/** How many head actions the skeleton reserves — mockup 05's two. */
export const CODE_SKELETON_ACTIONS = 2;

/**
 * How many workflow files the explorer reserves — the seeded workspace's five, the count most first
 * paints resolve to. A workspace with more or fewer moves the explorer by the difference, and no
 * skeleton can know that in advance.
 */
export const CODE_SKELETON_FILES = 5;

/** How many outline rows the right panel reserves — the seeded `standard-fix`'s twelve stages. */
export const CODE_SKELETON_OUTLINE_ROWS = 12;

/** How many Loop Checks rows the right panel reserves — the two the MVP derives (decision C7). */
export const CODE_SKELETON_CHECKS = 2;

/** What every bar holds, so it takes its row's line box without printing anything. */
const LINE = "​";

/**
 * One bar.
 *
 * @param props.size Its width: `short`, the default, or `wide`.
 * @returns The bar.
 */
function Bar({ size = "default" }: Readonly<{ size?: "short" | "default" | "wide" }>) {
  return (
    <span
      className={cx(
        "code-skeleton__bar",
        size === "short" && "code-skeleton__bar--short",
        size === "wide" && "code-skeleton__bar--wide",
      )}
    >
      {LINE}
    </span>
  );
}

/**
 * One of the narrow viewport's toggles, on a small button's own classes so it has that box.
 *
 * @returns The placeholder.
 */
function Toggle() {
  return <span className={cx("ou-btn ou-btn--sm", "code-skeleton__toggle")}>{LINE}</span>;
}

/**
 * A run of identical rows.
 *
 * @param props.count How many.
 * @param props.className The row's layout class.
 * @returns The rows, each holding one bar.
 */
function Rows({ count, className }: Readonly<{ count: number; className: string }>) {
  return Array.from({ length: count }, (_, index) => (
    <div className={className} key={index}>
      <Bar />
    </div>
  ));
}

/**
 * The skeleton.
 *
 * @param props.slug The workflow being opened, or `null` when the route's params are not known —
 *   what the tab row's segments link to.
 * @returns The frame, with the workbench's regions where the reads will land.
 */
export function CodeSkeleton({ slug }: Readonly<{ slug: string | null }>) {
  return (
    <StudioFrame
      actions={
        <span aria-hidden className="studio-skeleton__actions">
          {Array.from({ length: CODE_SKELETON_ACTIONS }, (_, index) => (
            <span className="studio-skeleton__action" key={index} />
          ))}
        </span>
      }
      busy={CODE_LOADING_LABEL}
      current="code"
      slug={slug}
      subline={<span aria-hidden className="studio-skeleton__sub" />}
      title={<span aria-hidden className="studio-skeleton__title" />}
    >
      <div aria-hidden className="code-skeleton">
        <Card className="code-workbench">
          {/* The narrow viewport's toggles — Explorer, and Checks & outline — at a small button's box. */}
          <div className="code-workbench__toggles">
            <Toggle />
            <Toggle />
          </div>

          <div className="code-workbench__body">
            <div className="code-tree">
              <p className="code-tree__head">
                <Bar size="wide" />
              </p>
              <div className="code-tree__row">
                <Bar size="short" />
              </div>
              <div className="code-tree__group">
                <Rows className="code-tree__row" count={CODE_SKELETON_FILES} />
              </div>
              <div className="code-tree__row">
                <Bar />
              </div>
            </div>

            <div className="code-workbench__editor">
              <div className="code-tabs">
                <div className="code-tab code-tab--active">
                  <span className="code-tab__select">
                    <Bar />
                  </span>
                </div>
              </div>

              <div className="code-workbench__pane">
                <p className="code-workbench__meta">
                  <Bar size="wide" />
                </p>
                <span className="code-skeleton__editor" />
              </div>
            </div>

            <div className="code-panel">
              <p className="code-panel__head">
                <Bar size="short" />
              </p>
              <Rows className="code-panel__check" count={CODE_SKELETON_CHECKS} />
              <p className="code-panel__head code-panel__head--later">
                <Bar size="short" />
              </p>
              <p className="code-panel__head code-panel__head--later">
                <Bar size="short" />
              </p>
              <Rows className="code-panel__row" count={CODE_SKELETON_OUTLINE_ROWS} />
            </div>
          </div>

          <div className="code-status">
            <Bar size="wide" />
          </div>
        </Card>
      </div>
    </StudioFrame>
  );
}
