import type { ReactNode } from "react";

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
 * The run controls the mockup puts beside the head (*Pause loop*, *Take over in IDE*, *Abort
 * run*) are AQ.2's ([#310](https://github.com/NobuData/ouroboros/issues/310)): the screen
 * decides whether the reader may see them and hands them in as `actions`, which sit to the
 * right of the head on a wide pane and wrap beneath it on a narrow one.
 *
 * @param props.view The head, from `runHead`.
 * @param props.actions The controls to draw beside the head, or nothing.
 * @returns The head.
 */
export function RunHead({
  view,
  actions = null,
}: Readonly<{ view: RunHeadView; actions?: ReactNode }>) {
  return (
    <div className="run-head">
      <div className="run-head__main">
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
      {actions !== null && <div className="run-head__actions">{actions}</div>}
    </div>
  );
}
