"use client";

import { useId } from "react";

import type { WorkflowDefinition, WorkflowDryRunResult } from "@/app/api/workflows";
import { Button, Chip, Eyebrow, cx } from "@/app/ui";

import { stageEntry } from "./canvas/graph";
import {
  ASSUMED_NOTE,
  CLEARS_NOTE,
  CLOSE_DRY_RUN,
  DRY_RUN_EYEBROW,
  DRY_RUN_FINDINGS_MESSAGE,
  OUTCOME_CLASS,
  OUTCOME_WORDS,
  STEPS_LABEL,
  VERDICT_TONES,
  VERDICT_WORDS,
  dryRunTitle,
  edgeTarget,
  loopNote,
  ticketFacts,
} from "./dry-run";
import { FindingList } from "./finding-list";

import "./workflows.css";

/** What the sheet takes. */
export interface DryRunSheetProps {
  /** The walk. */
  readonly result: WorkflowDryRunResult;
  /** The draft that was walked — where stage titles and finding anchors are read. */
  readonly walked: WorkflowDefinition;
  /** Take the dry run off the canvas. */
  readonly onClose: () => void;
  /** Select a step's stage on the canvas and bring it into view, keeping the sheet open. */
  readonly onFocus: (stageId: string) => void;
  /** Go to the stage a finding is about — which closes the sheet so the inspector can open it. */
  readonly onSelect: (stageId: string) => void;
}

/**
 * The dry run's side sheet — S.6 ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * It takes the inspector's track while a walk is on the canvas: every stage the walk reached, in order,
 * with the simulator's verdict and annotation; the predicate it tested, marked when it could only assume
 * the answer; and **every edge out of the stage — taken, not taken, or a loop** — each with the engine's
 * own explanation, so a decision shows both of its roads, and each loop states its retry bound.
 *
 * A step's title selects its stage without closing the sheet, so a reader can follow the walk on the
 * canvas. For a draft that does not validate the sheet lists the findings instead, and a finding closes
 * the sheet on its way to the stage.
 *
 * @param props See {@link DryRunSheetProps}.
 * @returns The sheet.
 */
export function DryRunSheet({ result, walked, onClose, onFocus, onSelect }: DryRunSheetProps) {
  const titleId = useId();

  /**
   * A stage's title, as the walked draft holds it.
   *
   * @param id The stage.
   * @returns Its title, or its id when it has none or is not in the draft.
   */
  const titleOf = (id: string): string => {
    const title = stageEntry(walked, id)?.title ?? "";
    return title === "" ? id : title;
  };

  return (
    <aside aria-labelledby={titleId} className="studio-dryrun">
      <header className="studio-dryrun__head">
        <Eyebrow>{DRY_RUN_EYEBROW}</Eyebrow>
        <h2 className="studio-dryrun__title" id={titleId}>
          {dryRunTitle(result.ticket.externalKey)}
        </h2>
        <p className="studio-dryrun__facts">{ticketFacts(result.ticket)}</p>
        <Button className="studio-dryrun__close" onClick={onClose} size="sm" tone="ghost">
          {CLOSE_DRY_RUN}
        </Button>
      </header>

      {result.findings.length > 0 ? (
        <>
          <p className="studio-dryrun__note" role="alert">
            {DRY_RUN_FINDINGS_MESSAGE}
          </p>
          <FindingList definition={walked} findings={result.findings} onSelect={onSelect} />
        </>
      ) : (
        <ol aria-label={STEPS_LABEL} className="studio-dryrun__steps">
          {result.steps.map((step, index) => (
            <li className="studio-dryrun__step" key={step.nodeId}>
              <div className="studio-dryrun__step-head">
                <span aria-hidden="true" className="studio-dryrun__index">
                  {index + 1}
                </span>
                <button className="studio-dryrun__stage" onClick={() => onFocus(step.nodeId)} type="button">
                  {step.title === "" ? step.nodeId : step.title}
                </button>
                <Chip tone={VERDICT_TONES[step.verdict]}>{VERDICT_WORDS[step.verdict]}</Chip>
              </div>

              <p className="studio-dryrun__annotation">{step.annotation}</p>

              {step.evaluation !== null && (
                <p className="studio-dryrun__evaluation">
                  {step.evaluation.explanation}
                  {step.evaluation.assumed && <span className="studio-dryrun__assumed"> {ASSUMED_NOTE}</span>}
                </p>
              )}

              {step.edges.length > 0 && (
                <ul className="studio-dryrun__edges">
                  {step.edges.map((edge) => (
                    <li
                      className={cx("studio-dryrun__edge", `studio-dryrun__edge--${OUTCOME_CLASS[edge.outcome]}`)}
                      key={`${edge.from}→${edge.to}`}
                    >
                      <span className="studio-dryrun__outcome">{OUTCOME_WORDS[edge.outcome]}</span>{" "}
                      <span className="studio-dryrun__target">{edgeTarget(edge, titleOf)}</span>
                      <p className="studio-dryrun__explanation">{edge.explanation}</p>
                      {edge.outcome === "loop" && <p className="studio-dryrun__loop">{loopNote(edge.maxRetries)}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}

      <p className="studio-dryrun__clears">{CLEARS_NOTE}</p>
    </aside>
  );
}
