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
}

/**
 * Validation findings as the reader can act on them — S.6
 * ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * Shared by the publish dialog and a dry run of a draft that does not validate. **A finding anchored to a
 * stage is a button that selects it**, named with the stage it goes to; a finding about the document as a
 * whole has nowhere to go and is drawn as text. Each says which validator raised it, because a DSL rule
 * and the engine's reading of the same graph are fixed in different ways.
 *
 * @param props See {@link FindingListProps}.
 * @returns The list.
 */
export function FindingList({ findings, definition, onSelect }: FindingListProps) {
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

        return (
          <li className="studio-findings__item" key={`${finding.code}-${index}`}>
            <button
              className="studio-findings__finding studio-findings__finding--anchored"
              onClick={() => onSelect(anchor)}
              type="button"
            >
              {body}
              <span className="studio-findings__target">{findingTarget(title === "" ? anchor : title)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
