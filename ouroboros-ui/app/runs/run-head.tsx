import { Elapsed } from "@/app/dashboard/elapsed";
import { elapsedOfSeconds } from "@/app/format";
import { Chip, Eyebrow, Tag } from "@/app/ui";

import { CopyBranch } from "./copy-branch";
import { NO_BRANCH, type RunHeadView } from "./view";

/**
 * The run console's page head ([#309](https://github.com/NobuData/ouroboros/issues/309)) —
 * mockup 10's eyebrow, headline and meta row.
 *
 * The meta row is the mockup's five elements in the mockup's order: the status pill (pulsing
 * only while the run is live), the pinned workflow's tag, the model pill, the anchored
 * *elapsed*, and the branch with its copy control. Every value is `view.ts`'s; this file only
 * draws.
 *
 * The run controls the mockup puts beside the head (*Pause loop*, *Abort run*) are AQ.6's
 * ([#314](https://github.com/NobuData/ouroboros/issues/314)) and are not drawn here.
 *
 * @param props.view The head, from `runHead`.
 * @returns The head.
 */
export function RunHead({ view }: Readonly<{ view: RunHeadView }>) {
  return (
    <div className="run-head">
      <Eyebrow>{view.eyebrow}</Eyebrow>
      <h1 className="run-head__title">
        {view.trackerUrl === null ? (
          view.headline
        ) : (
          <a
            className="run-head__link"
            href={view.trackerUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {view.headline}
          </a>
        )}
      </h1>

      <div className="run-head__meta">
        <Chip dot={view.statusDot} tone={view.statusTone}>
          {view.statusLabel}
        </Chip>
        <Tag>{view.workflow}</Tag>
        <Chip mono tone="model">
          {view.model}
        </Chip>
        <span className="run-head__mono">
          elapsed{" "}
          <span className="run-head__elapsed">
            {view.elapsed.live ? (
              <Elapsed
                serverSeconds={view.elapsed.serverSeconds}
                startedAtSeconds={view.elapsed.startedAtSeconds}
              />
            ) : (
              elapsedOfSeconds(view.elapsed.seconds)
            )}
          </span>
        </span>
        {view.branch === null ? (
          <span className="run-head__mono">{NO_BRANCH}</span>
        ) : (
          <CopyBranch branch={view.branch} />
        )}
      </div>
    </div>
  );
}
