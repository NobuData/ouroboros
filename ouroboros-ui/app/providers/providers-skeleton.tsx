import { ModelsFrame } from "@/app/models/models-frame";
import { Card } from "@/app/ui";

import { SecurityStrip } from "./security-strip";
import { PROVIDERS_SUBLINE_TEMPLATE, PROVIDERS_TITLE, WORKSPACE_SLOT } from "./view";

import "./providers.css";

/**
 * What the reader sees while the providers page's reads are in flight (AE.6,
 * [#232](https://github.com/NobuData/ouroboros/issues/232)).
 *
 * `app/(app)/models/providers/loading.tsx` returns this, and the framework wraps the page in
 * a Suspense boundary with it as the fallback, so the shell and the sidebar paint at once
 * and only the page waits — the shape `app/models/models-skeleton.tsx` gave the routing
 * page, at this page's own geometry.
 *
 * ### The head is the real head, with one slot
 *
 * The title and the tab set do not depend on the reads, so they are drawn as themselves.
 * The subline nearly is: it is `docs/SECURITY_MODEL.md` § 7.2's sentence with the workspace's
 * name in it, and the name is the one thing the skeleton cannot know. So the sentence is
 * drawn as itself around a bar the width of a name, which is what keeps it wrapping on the
 * same line before and after the data lands. The two head actions are bars, because one of
 * them is inert for a role the skeleton cannot know either.
 *
 * ### Below the tabs, the card's own anatomy
 *
 * A skeleton exists to stop the page moving when the data lands, and the only way it can is
 * by reserving the height each region will take
 * ([#86](https://github.com/NobuData/ouroboros/issues/86)). So each card shape is built from
 * the card's **own** region classes — `.providers-card__head`, `__models`, `__meter`,
 * `__foot` — with bars at the height of the control each region holds: the monogram's
 * square, an input's box, a small button's, a chip's, a meter's track. The count is the
 * seeded workspace's five, with the dashed card's shape after them, which is the height most
 * first paints resolve to; a workspace with more or fewer moves by the difference, and no
 * skeleton can know that in advance.
 *
 * The security strip is drawn **as itself**: its copy is a claim about the deployment and
 * depends on no read, so a bar in its place would be the one part of the page a skeleton
 * made worse.
 *
 * **It says one thing to a screen reader, not fifty.** The bars carry no text, the grid is
 * `aria-hidden`, and the frame's `<main>` is `aria-busy` and labelled once.
 *
 * A Server Component with nothing to decide, like the frame it is built from.
 */

/** What the frame's `<main>` is labelled while it is busy. */
export const LOADING_LABEL = "Loading providers & keys";

/** How many cards the grid reserves — the seeded workspace's five connections. */
export const SKELETON_CARDS = 5;

/** How many chips each card's models region reserves. */
export const SKELETON_CHIPS = 3;

/**
 * The skeleton.
 *
 * @returns The frame, with bars where the reads' regions will be and the strip as itself.
 */
export function ProvidersSkeleton() {
  const [before, after = ""] = PROVIDERS_SUBLINE_TEMPLATE.split(WORKSPACE_SLOT);

  return (
    <ModelsFrame
      active="providers"
      actions={
        <span aria-hidden className="providers-skeleton__actions">
          <span className="providers-skeleton__action" />
          <span className="providers-skeleton__action" />
        </span>
      }
      busy={LOADING_LABEL}
      subline={
        <>
          {before}
          <span aria-hidden className="providers-skeleton__slot" />
          {after}
        </>
      }
      title={PROVIDERS_TITLE}
    >
      <div aria-hidden className="providers-grid providers-skeleton">
        {Array.from({ length: SKELETON_CARDS }, (_, index) => (
          <CardShape key={index} />
        ))}
        <Card className="providers-add-card">
          <span className="providers-skeleton__plus" />
          <span className="providers-skeleton__bar providers-skeleton__bar--note" />
          <span className="providers-skeleton__button" />
        </Card>
      </div>
      <SecurityStrip />
    </ModelsFrame>
  );
}

/**
 * One card: the head's row, a key row, the meta line, the models region, the meter and the
 * foot — six regions at the card's own rhythm.
 *
 * @returns The shape.
 */
function CardShape() {
  return (
    <Card className="providers-card providers-skeleton__card" fill>
      <div className="providers-card__head">
        <span className="providers-skeleton__monogram" />
        <span className="providers-skeleton__identity">
          <span className="providers-skeleton__bar providers-skeleton__bar--name" />
          <span className="providers-skeleton__bar providers-skeleton__bar--note" />
        </span>
        <span className="providers-skeleton__pill" />
        <span className="providers-skeleton__switch" />
      </div>
      <div className="providers-skeleton__key-row">
        <span className="providers-skeleton__input" />
        <span className="providers-skeleton__button" />
        <span className="providers-skeleton__button" />
      </div>
      <span className="providers-skeleton__bar providers-skeleton__bar--meta" />
      <div className="providers-card__models">
        <span className="providers-skeleton__bar providers-skeleton__bar--label" />
        <span className="providers-skeleton__chips">
          {Array.from({ length: SKELETON_CHIPS }, (_, index) => (
            <span className="providers-skeleton__pill" key={index} />
          ))}
        </span>
      </div>
      <div className="providers-card__meter">
        <span className="providers-skeleton__meter-line">
          <span className="providers-skeleton__bar providers-skeleton__bar--label" />
          <span className="providers-skeleton__bar providers-skeleton__bar--figure" />
        </span>
        <span className="providers-skeleton__meter" />
      </div>
      <div className="providers-card__foot">
        <span className="providers-skeleton__button providers-skeleton__button--test" />
        <span className="providers-skeleton__cap">
          <span className="providers-skeleton__bar providers-skeleton__bar--label" />
          <span className="providers-skeleton__input providers-skeleton__input--cap" />
        </span>
      </div>
    </Card>
  );
}
