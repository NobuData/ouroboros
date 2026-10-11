import { StudioFrame } from "../studio-frame";
import { SKELETON_WORKFLOWS } from "../studio-skeleton";
import { COPILOT_EYEBROW, COPILOT_SUBLINE, COPILOT_TITLE } from "./copilot-view";

import "../workflows.css";
import "./copilot.css";

/**
 * What the reader sees while the copilot's reads are in flight (CE.1,
 * [#565](https://github.com/NobuData/ouroboros/issues/565)).
 *
 * The studio's skeleton (`app/workflows/studio-skeleton.tsx`) in the copilot's shape: the same
 * frame, so the tab row is drawn as itself with **Copilot** marked current — and, unlike the
 * other two surfaces' skeletons, **the head is drawn as itself too**. Its eyebrow, title and
 * subline are copy that depends on no read, so there is nothing to stand a bar in for and the
 * head cannot move when the data lands. The head's two actions are bars, because their labels
 * and whether they can act are what the reads decide.
 *
 * Below the row: the rail's bars, in the studio skeleton's own classes, beside the body's two
 * columns with a block where each seat will be.
 *
 * **It says one thing to a screen reader.** The bars are `aria-hidden`, and the frame's `<main>`
 * is `aria-busy` and labelled once.
 *
 * A Server Component with nothing to decide; `app/(app)/workflows/[slug]/copilot/loading.tsx`
 * hands it the slug.
 */

/** What the frame's `<main>` is labelled while it is busy. */
export const COPILOT_LOADING_LABEL = "Loading the workflow copilot";

/** How many head actions the skeleton reserves — mockup 20's two. */
export const COPILOT_SKELETON_ACTIONS = 2;

/**
 * The skeleton.
 *
 * @param props.slug The workflow the URL names, or `null` when the fallback could not learn it —
 *   what the tab row's segments link to.
 * @returns The frame, with bars where the reads' regions will be.
 */
export function CopilotSkeleton({ slug }: Readonly<{ slug: string | null }>) {
  return (
    <StudioFrame
      actions={
        <span aria-hidden className="studio-skeleton__actions">
          {Array.from({ length: COPILOT_SKELETON_ACTIONS }, (_, index) => (
            <span className="studio-skeleton__action" key={index} />
          ))}
        </span>
      }
      busy={COPILOT_LOADING_LABEL}
      current="copilot"
      eyebrow={COPILOT_EYEBROW}
      slug={slug}
      subline={COPILOT_SUBLINE}
      title={COPILOT_TITLE}
    >
      <div aria-hidden className="studio-skeleton studio__grid">
        <div className="studio-skeleton__rail">
          {Array.from({ length: SKELETON_WORKFLOWS }, (_, index) => (
            <span className="studio-skeleton__item" key={index} />
          ))}
          <span className="studio-skeleton__new" />
        </div>

        <div className="copilot-view__body">
          <span className="copilot-view__skeleton-seat" />
          <div className="copilot-view__side">
            <span className="copilot-view__skeleton-seat" />
            <span className="copilot-view__skeleton-seat" />
          </div>
        </div>
      </div>
    </StudioFrame>
  );
}
