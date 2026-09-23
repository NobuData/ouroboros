import { Eyebrow } from "@/app/ui";

import { RUN_EYEBROW } from "./view";

import "./runs.css";

/** What the skeleton's `<main>` says to a screen reader. */
export const RUN_LOADING_LABEL = "Loading the run";

/**
 * The run console while its first read is in flight
 * ([#309](https://github.com/NobuData/ouroboros/issues/309)).
 *
 * The head's own geometry — the eyebrow, a headline-sized bar and a meta-row-sized bar — so the
 * page does not jump when the answer lands. The bars do not pulse, for the farm skeleton's
 * reason, and are hidden from the accessibility tree; the `<main>` says *loading* once.
 *
 * @returns The skeleton.
 */
export function RunSkeleton() {
  return (
    <main aria-busy="true" aria-label={RUN_LOADING_LABEL} className="run">
      <div className="run-head">
        <Eyebrow>{RUN_EYEBROW}</Eyebrow>
        <div aria-hidden className="run-skeleton">
          <span className="run-skeleton__bar run-skeleton__bar--title" />
          <span className="run-skeleton__bar run-skeleton__bar--meta" />
        </div>
      </div>
    </main>
  );
}
