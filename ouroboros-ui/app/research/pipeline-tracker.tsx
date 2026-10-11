"use client";

import type { ResearchRoadmap, RoadmapItem } from "@/app/api/research";
import { Chip, EffortChip, Tag } from "@/app/ui";

import {
  DRIFT_RAISED,
  NO_ISSUES,
  PIPELINE_CAPTION,
  STATUS_TONE,
  STEP_TRACKER,
  complexityChip,
  doneLabel,
  driftSuggestion,
  effortOf,
  estimateLabel,
  syncTag,
  trackerMilestone,
} from "./pipeline";

/** What the tracker's list is, to a reader who cannot see it. */
const ISSUES_LABEL = "Issues by milestone";

/** The pill of an item with no issue yet. */
const UNFILED = "not filed";

/**
 * Step 2 of the pipeline card (CN.5, [#631](https://github.com/NobuData/ouroboros/issues/631)) —
 * the tracker beside the document: the issues `create-issues` filed, grouped by milestone.
 *
 * The tag says whether the file and the tracker agree, and says `drift detected` — with the
 * suggestion the detector raised — when they do not. A row is one issue: its number, a link to
 * the tracker; its title; and the estimator's answer for it — loop-days, effort and complexity —
 * which is what the caption attributes them to. The pill is the service's reading of the issue
 * and its newest run together. The list scrolls in its own wrapper, so a long roadmap does not
 * push the page.
 *
 * @param props.roadmap The card.
 * @returns The step.
 */
export function PipelineTracker({ roadmap }: Readonly<{ roadmap: ResearchRoadmap }>) {
  const tag = syncTag(roadmap);
  const drift = driftSuggestion(roadmap);

  return (
    <div aria-label={STEP_TRACKER} className="research__pipe-step" role="group">
      <div className="research__pipe-step-head">
        <h3 className="research__pipe-step-title">{STEP_TRACKER}</h3>
        {tag.tone === "warn" ? <Chip tone="warn">{tag.label}</Chip> : <Tag>{tag.label}</Tag>}
      </div>

      {drift !== null && (
        <p className="research__pipe-drift" role="status">
          {DRIFT_RAISED} <span className="research__pipe-drift-text">{drift.text}</span>
        </p>
      )}

      {roadmap.issues.filed === 0 && <p className="research__pipe-note">{NO_ISSUES}</p>}

      {/* A scroll container must be reachable without a pointer. */}
      <div aria-label={ISSUES_LABEL} className="research__pipe-scroll" role="group" tabIndex={0}>
        {roadmap.milestones.map((milestone) => (
          <div className="research__ms" key={milestone.key}>
            <div className="research__ms-head">
              <h4 className="research__ms-name">{trackerMilestone(milestone)}</h4>
              {milestone.dueLabel !== null && <Tag>{milestone.dueLabel}</Tag>}
              <span className="research__ms-done">{doneLabel(milestone)}</span>
            </div>
            <ul className="research__iss-list">
              {milestone.items.map((item) => (
                <IssueRow item={item} key={item.key} />
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="research__pipe-caption">{PIPELINE_CAPTION}</p>
    </div>
  );
}

/**
 * One issue's row.
 *
 * @param props.item The roadmap item, with its issue once filed.
 * @returns The row.
 */
function IssueRow({ item }: Readonly<{ item: RoadmapItem }>) {
  const estimate = estimateLabel(item);
  const effort = effortOf(item);
  const complexity = complexityChip(item);

  return (
    <li className="research__iss-row">
      <span className="research__iss-num">
        {item.ticket === null ? (
          "—"
        ) : item.ticket.url === null ? (
          item.ticket.key
        ) : (
          <a className="research__side-link" href={item.ticket.url} rel="noreferrer" target="_blank">
            {item.ticket.key}
          </a>
        )}
      </span>
      <span className="research__iss-title">{item.title}</span>
      {estimate !== null && <span className="research__iss-est">{estimate}</span>}
      {effort !== null && <EffortChip effort={effort} />}
      {complexity !== null && <Chip tone={complexity.tone}>{complexity.label}</Chip>}
      {item.status === null ? (
        <Chip tone="neutral">{UNFILED}</Chip>
      ) : (
        <Chip dot={item.status.live ? "pulse" : undefined} tone={STATUS_TONE[item.status.tone]}>
          {item.status.label}
        </Chip>
      )}
    </li>
  );
}
