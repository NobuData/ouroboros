import type { ReactNode } from "react";

import { Chip, Eyebrow, Tag } from "@/app/ui";

import type { TestsHeadView } from "./view";

/**
 * The test-results page head ([#335](https://github.com/NobuData/ouroboros/issues/335)) — mockup
 * 11's eyebrow, headline and meta row.
 *
 * The meta row is the mockup's four elements in the mockup's order: the pinned workflow's tag,
 * the pass-ratio pill (ok, warn or err by ratio), the attempt's ordinal within its loop, and the
 * runner, rig and duration line. Every value is `view.ts`'s; this file only draws.
 *
 * The headline links to the ticket on its tracker when there is a URL to build, and is plain text
 * otherwise — never a guessed link.
 *
 * @param props.view The head, from `testsHead`.
 * @param props.actions The actions to draw beside the head, or nothing.
 * @returns The head.
 */
export function TestsHead({
  view,
  actions = null,
}: Readonly<{ view: TestsHeadView; actions?: ReactNode }>) {
  return (
    <div className="tests-head">
      <div className="tests-head__main">
        <Eyebrow>{view.eyebrow}</Eyebrow>
        <h1 className="tests-head__title">
          {view.trackerUrl === null ? (
            view.headline
          ) : (
            <a
              className="tests-head__link"
              href={view.trackerUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              {view.headline}
            </a>
          )}
        </h1>

        <div className="tests-head__meta">
          <Tag>{view.workflow}</Tag>
          {view.pass !== null && (
            <Chip dot={view.pass.dot} tone={view.pass.tone}>
              {view.pass.label}
            </Chip>
          )}
          {view.ordinal !== null && <Tag>{view.ordinal}</Tag>}
          {view.machine !== null && <span className="tests-head__mono">{view.machine}</span>}
        </div>
      </div>
      {actions !== null && <div className="tests-head__actions">{actions}</div>}
    </div>
  );
}
