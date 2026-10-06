import { Eyebrow } from "@/app/ui";

import { EYEBROW, SKELETON_LABEL, STEP_COUNT, TITLE } from "./view";

import "./get-started.css";

/** How many card shapes the skeleton reserves under the rail — the step panel and two cards. */
export const SKELETON_CARDS = 3;

/**
 * `/get-started`'s loading state (BC.6, [#395](https://github.com/NobuData/ouroboros/issues/395)).
 *
 * The head is real — the eyebrow and the headline are known before any read — and the frame's
 * geometry is reserved beneath it: four step shapes where the rail will be, card shapes where
 * the step content will land, and the bar's shape at the foot, so the page does not jump when
 * the reads arrive. Nothing here claims a state: no mark is ticked and no step is named, because
 * every one of those is the service's answer and the answer is not in yet.
 *
 * @returns The frame with bars where the reads will land.
 */
export function GetStartedSkeleton() {
  return (
    <div aria-busy className="wizard wizard-skeleton">
      <header className="wizard__head">
        <div className="wizard__headings">
          <Eyebrow>{EYEBROW}</Eyebrow>
          <h1 className="wizard__title">{TITLE}</h1>
          <p className="sr-only" role="status">
            {SKELETON_LABEL}
          </p>
          <span aria-hidden className="wizard-skeleton__bone wizard-skeleton__bone--sub" />
        </div>
      </header>
      <div aria-hidden className="wizard-rail">
        <ol className="wizard-rail__steps">
          {Array.from({ length: STEP_COUNT }, (_, index) => (
            <li className="wizard-step wizard-skeleton__step" key={index}>
              <span className="wizard-skeleton__mark" />
              <span className="wizard-skeleton__bone wizard-skeleton__bone--name" />
            </li>
          ))}
        </ol>
      </div>
      <div aria-hidden className="wizard__content">
        {Array.from({ length: SKELETON_CARDS }, (_, index) => (
          <div className="wizard-skeleton__card" key={index}>
            <span className="wizard-skeleton__bone wizard-skeleton__bone--title" />
            <span className="wizard-skeleton__bone" />
            <span className="wizard-skeleton__bone wizard-skeleton__bone--short" />
          </div>
        ))}
      </div>
      <div aria-hidden className="wizard-bar">
        <span className="wizard-skeleton__bone wizard-skeleton__bone--counter" />
        <span className="wizard-bar__spacer" />
        <span className="wizard-skeleton__bone wizard-skeleton__bone--button" />
      </div>
    </div>
  );
}
