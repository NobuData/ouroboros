"use client";

import { useEffect, useId, useRef } from "react";

import { Card, CardHead, Tag } from "@/app/ui";

import {
  NO_STAGES,
  STEPPER_LABEL,
  STEPPER_TITLE,
  type StepTone,
  type StepperView,
} from "./stepper";

/** Each treatment's class — written out, so the sheet's audit can see every one rendered. */
const STEP_CLASS: Readonly<Record<StepTone, string>> = {
  done: "run-step run-step--done",
  active: "run-step run-step--active",
  pending: "run-step run-step--pending",
  failed: "run-step run-step--failed",
  skipped: "run-step run-step--skipped",
};

/** What the stepper is told. */
export interface RunStepperProps {
  /** The stepper, from `runStepper`. */
  readonly view: StepperView;
  /** The stage the transcript is filtered to, or `null`. */
  readonly selected: string | null;
  /** Filter to a stage, or clear the filter with `null`. */
  readonly onSelect: (stage: string | null) => void;
}

/**
 * Mockup 10's stage timeline ([#311](https://github.com/NobuData/ouroboros/issues/311)).
 *
 * **Every word is the service's.** Labels, durations, attempt counts and the warn note come
 * from `stepper.ts`, which reads them off AP.2's timeline; this file only draws. The note in
 * particular is the stored transition note, printed as-is and wrapped rather than truncated,
 * because it is the interesting part.
 *
 * **Each node is a button** that filters the transcript to its stage (#312) and puts the stage
 * in the URL, so the filtered view can be shared; pressing the selected node clears it. The
 * buttons are in the pinned order, so Tab walks the steps in order, and `aria-pressed` says
 * which one is the filter.
 *
 * **It scrolls inside its own wrapper.** Eight nodes do not fit a phone, and the shell's rule
 * is that only the pane scrolls the page — so the strip scrolls sideways in a box of its own,
 * and on first paint that box, not the pane, is moved to bring the active node into sight.
 *
 * **Motion is optional.** The active node pulses only while the run is live and only for a
 * reader who has not asked for less motion; the reduced variant keeps a static ring, so
 * *active* still reads. Treatments cross-fade on a poll's change for the same reason.
 *
 * @param props See {@link RunStepperProps}.
 * @returns The card.
 */
export function RunStepper({ view, selected, onSelect }: RunStepperProps) {
  const titleId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());

  // Once, on first paint: bring the active (or failed) node into the wrapper's view. Moving
  // the wrapper's own scroll offset — never `scrollIntoView`, which would move the pane too.
  const { focusKey } = view;
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || focusKey === null) return;

    const box = scroller.current;
    const node = nodes.current.get(focusKey);
    if (box === null || node === undefined) return;

    scrolled.current = true;
    box.scrollLeft = Math.max(0, node.offsetLeft - (box.clientWidth - node.offsetWidth) / 2);
  }, [focusKey]);

  return (
    <Card aria-labelledby={titleId} as="section" className="run-timeline">
      <CardHead title={STEPPER_TITLE} titleId={titleId} trailing={<Tag>{view.tag}</Tag>} />

      {view.steps.length === 0 ? (
        <p className="run-timeline__empty">{NO_STAGES}</p>
      ) : (
        <div className="run-timeline__scroll" ref={scroller}>
          <ol aria-label={STEPPER_LABEL} className={view.live ? "run-stepper run-stepper--live" : "run-stepper"}>
            {view.steps.map((step, index) => (
              <li
                className={STEP_CLASS[step.tone]}
                key={step.key}
                ref={(element) => {
                  if (element === null) nodes.current.delete(step.key);
                  else nodes.current.set(step.key, element);
                }}
              >
                {index > 0 && (
                  <span
                    aria-hidden="true"
                    className={step.doneSegment ? "run-step__seg run-step__seg--done" : "run-step__seg"}
                  />
                )}
                <div className="run-step__body">
                  <button
                    aria-label={step.accessibleName}
                    aria-pressed={selected === step.key}
                    className="run-step__button"
                    onClick={() => onSelect(selected === step.key ? null : step.key)}
                    type="button"
                  >
                    <span aria-hidden="true" className="run-step__node">
                      {step.glyph}
                    </span>
                    <span aria-hidden="true" className="run-step__name">
                      {step.label}
                    </span>
                    {step.caption !== null && (
                      <span aria-hidden="true" className="run-step__caption">
                        {step.caption}
                      </span>
                    )}
                  </button>
                  {step.note !== null && <p className="run-step__note">{step.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}
