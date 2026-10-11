import Link from "next/link";

import type { WorkflowDefinition, WorkflowFinding } from "@/app/api/workflows";

import { stageEntry } from "./canvas/graph";
import { FINDINGS_LABEL, FINDING_SOURCE_WORDS, findingAnchor, findingTarget } from "./publish";

import "./workflows.css";

/** What the list takes. */
export interface FindingListProps {
  /** The findings, in the service's order. */
  readonly findings: readonly WorkflowFinding[];
  /** The draft they were produced for — what each is anchored in. */
  readonly definition: WorkflowDefinition;
  /** Told the stage a finding is about, when the reader picks one. */
  readonly onSelect: (stageId: string) => void;
  /**
   * Where a stage is, on a page that draws its stages as rows rather than on a canvas — the
   * copilot's `#stage-<id>` (CE.1, [#565](https://github.com/NobuData/ouroboros/issues/565)).
   * Given, an anchored finding is a **link** there instead of a button, and `onSelect` is still
   * told, so a dialog can close behind the press. Left out, the canvas's and the code view's
   * behaviour is unchanged.
   */
  readonly stageHref?: (stageId: string) => string;
  /** What an anchored finding says it does, from the stage's title. Defaults to `publish.ts`' *Select …*. */
  readonly target?: (stageTitle: string) => string;
}

/**
 * Validation findings as the reader can act on them — S.6
 * ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * Shared by the publish dialog and a dry run of a draft that does not validate. **A finding anchored to a
 * stage is a button that selects it**, named with the stage it goes to — or, on the copilot, a link to that
 * stage's row (`stageHref`); a finding about the document as a whole has nowhere to go and is drawn as text. Each says which validator raised it, because a DSL rule
 * and the engine's reading of the same graph are fixed in different ways.
 *
 * @param props See {@link FindingListProps}.
 * @returns The list.
 */
export function FindingList({
  findings,
  definition,
  onSelect,
  stageHref,
  target = findingTarget,
}: FindingListProps) {
  return (
    <ul aria-label={FINDINGS_LABEL} className="studio-findings">
      {findings.map((finding, index) => {
        const anchor = findingAnchor(finding, definition);
        const body = (
          <>
            <span className="studio-findings__source">{FINDING_SOURCE_WORDS[finding.source]}</span>
            <span className="studio-findings__message">{finding.message}</span>
          </>
        );

        if (anchor === null) {
          return (
            <li className="studio-findings__item" key={`${finding.code}-${index}`}>
              <p className="studio-findings__finding">{body}</p>
            </li>
          );
        }

        const title = stageEntry(definition, anchor)?.title ?? "";
        const goes = <span className="studio-findings__target">{target(title === "" ? anchor : title)}</span>;

        if (stageHref !== undefined) {
          return (
            <li className="studio-findings__item" key={`${finding.code}-${index}`}>
              {/* A router link, not a bare anchor: Back returns from a fragment the router entered. */}
              <Link
                className="studio-findings__finding studio-findings__finding--anchored"
                href={stageHref(anchor)}
                onClick={() => onSelect(anchor)}
              >
                {body}
                {goes}
              </Link>
            </li>
          );
        }

        return (
          <li className="studio-findings__item" key={`${finding.code}-${index}`}>
            <button
              className="studio-findings__finding studio-findings__finding--anchored"
              onClick={() => onSelect(anchor)}
              type="button"
            >
              {body}
              {goes}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
