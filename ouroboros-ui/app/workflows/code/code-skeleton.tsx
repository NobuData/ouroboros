import { StudioFrame } from "../studio-frame";

import "./code-view.css";

/**
 * What the reader sees while the code view's reads are in flight (V.1,
 * [#169](https://github.com/NobuData/ouroboros/issues/169)).
 *
 * The visual editor's skeleton (`app/workflows/studio-skeleton.tsx`) in the code view's shape:
 * the same frame, so the eyebrow and the segmented control are drawn as themselves — with
 * **Code** marked current — and the title and the subline as bars at their own height; then the
 * head's **two** actions rather than three, and a single file card where the visual editor has a
 * rail beside a canvas. The head's bars reuse the studio skeleton's classes, because they are the
 * same head.
 *
 * A Server Component with nothing to decide; `app/(app)/workflows/[slug]/code/loading.tsx` hands
 * it the slug.
 */

/** What the frame's `<main>` is labelled while it is busy. */
export const CODE_LOADING_LABEL = "Loading the workflow's code";

/** How many head actions the skeleton reserves — mockup 05's two. */
export const CODE_SKELETON_ACTIONS = 2;

/**
 * The skeleton.
 *
 * @param props.slug The workflow being opened, or `null` when the route's params are not known —
 *   what the tab row's segments link to.
 * @returns The frame, with bars where the reads' regions will be.
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
      <span aria-hidden className="code-skeleton__file" />
    </StudioFrame>
  );
}
