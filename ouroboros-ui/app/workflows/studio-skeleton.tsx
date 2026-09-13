import { StudioFrame } from "./studio-frame";

import "./workflows.css";

/**
 * What the reader sees while the studio's two reads are in flight (S.1,
 * [#147](https://github.com/NobuData/ouroboros/issues/147)).
 *
 * The design system asks every surface to design its loading state rather than leave a blank
 * region (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.3), and Next.js's `loading.tsx` is how a
 * route says what that is: `app/(app)/workflows/loading.tsx` returns this, and the framework
 * wraps both studio routes in a Suspense boundary with it as the fallback, so the shell and
 * the sidebar paint immediately and only the page waits.
 *
 * ### The eyebrow and the control are real; the title and the subline are bars
 *
 * The routing page's skeleton draws its whole head as itself, because its copy does not
 * depend on the reads. This page's title is the selected workflow's **name** and its subline
 * is composed from that workflow, so both are bars — at the title's and a body line's own
 * height, so the control under them sits where it will. The eyebrow and the segmented control
 * depend on nothing and are drawn as themselves, by the same frame the screen uses, which is
 * what makes the swap pixel-identical for everything that can be.
 *
 * ### Below the control, each region's own geometry
 *
 * A skeleton exists to stop the page moving when the data lands, and the only way it can is
 * by reserving the height each region will take
 * ([#86](https://github.com/NobuData/ouroboros/issues/86)): the rail is five items at an
 * item's height and the dashed tile at its own, in the rail's own gap, and the seat is the
 * card's floor. Five is the seeded workspace's count, which is the height most first paints
 * resolve to; a workspace with more or fewer moves by the difference, and no skeleton can
 * know that in advance.
 *
 * **It says one thing to a screen reader, not twenty.** The bars carry no text, the region
 * below the control is `aria-hidden`, and the frame's `<main>` is `aria-busy` and labelled
 * once.
 *
 * A Server Component with nothing to decide, like the frame it is built from.
 */

/** What the frame's `<main>` is labelled while it is busy. */
export const LOADING_LABEL = "Loading the workflow studio";

/** How many rail items the skeleton reserves — the seeded workspace's five workflows. */
export const SKELETON_WORKFLOWS = 5;

/** How many head actions the skeleton reserves — the mockup's three. */
export const SKELETON_ACTIONS = 3;

/**
 * The skeleton.
 *
 * @returns The frame, with bars where the reads' regions will be.
 */
export function StudioSkeleton() {
  return (
    <StudioFrame
      actions={
        <span aria-hidden className="studio-skeleton__actions">
          {Array.from({ length: SKELETON_ACTIONS }, (_, index) => (
            <span className="studio-skeleton__action" key={index} />
          ))}
        </span>
      }
      busy={LOADING_LABEL}
      slug={null}
      subline={<span aria-hidden className="studio-skeleton__sub" />}
      title={<span aria-hidden className="studio-skeleton__title" />}
    >
      {/* The grid's own rule, so the two columns land where the screen's will. */}
      <div aria-hidden className="studio-skeleton studio__grid">
        <div className="studio-skeleton__rail">
          {Array.from({ length: SKELETON_WORKFLOWS }, (_, index) => (
            <span className="studio-skeleton__item" key={index} />
          ))}
          <span className="studio-skeleton__new" />
        </div>

        <span className="studio-skeleton__seat" />
      </div>
    </StudioFrame>
  );
}
