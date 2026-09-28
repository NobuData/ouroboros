"use client";

import { type Ref, useEffect, useId, useRef } from "react";

import { Card, CardHead, Chip, Tag, cx } from "@/app/ui";

import {
  type CorrectionStep,
  type FutureStep,
  NO_REVISIONS,
  type RevisionStep,
  type RevisionTreatment,
  SCOPED_HERE,
  STRIP_TAG,
  STRIP_TITLE,
  type StripStep,
  scrollTarget,
} from "./strip";

/** The class each revision treatment adds, or nothing for the plain one. */
const REVISION_CLASS: Record<RevisionTreatment, string> = {
  err: "prv-step--err",
  live: "prv-step--live",
  plain: "",
};

/** The class each future treatment adds. */
const FUTURE_CLASS: Record<FutureStep["treatment"], string> = {
  ghosted: "prv-step--ghosted",
  armed: "prv-step--armed",
};

/**
 * One revision — a button, because pressing it scopes the gates to its snapshot.
 *
 * @param props.step The step.
 * @param props.scoped Whether the gates are scoped to it.
 * @param props.onScope Told the ordinal to scope to, or `null` when the scoped step is pressed
 *   again — the page then follows the latest revision.
 * @param props.current The element to scroll into view, when this is the step to show.
 * @returns The step.
 */
function Revision({
  step,
  scoped,
  onScope,
  current,
}: Readonly<{
  step: RevisionStep;
  scoped: boolean;
  onScope: (seq: number | null) => void;
  current: Ref<HTMLButtonElement> | undefined;
}>) {
  return (
    <button
      aria-pressed={scoped}
      className={cx(
        "prv-step prv-step--revision",
        REVISION_CLASS[step.treatment],
        scoped && "prv-step--scoped",
      )}
      onClick={() => onScope(scoped ? null : step.seq)}
      ref={current}
      type="button"
    >
      <span className="prv-step__label">
        {step.treatment === "live" && <span aria-hidden className="prv-step__dot" />}
        {step.label}
      </span>
      <span className="prv-step__meta">{step.meta}</span>
      {scoped && <span className="prv-step__scope">{SCOPED_HERE}</span>}
    </button>
  );
}

/**
 * The correction that bridged two revisions.
 *
 * @param props.step The step.
 * @returns The step, with a model pill only when the step names a model.
 */
function Correction({ step }: Readonly<{ step: CorrectionStep }>) {
  return (
    <div className="prv-step prv-step--correction">
      <span className="prv-step__label">{step.label}</span>
      {(step.note !== null || step.model !== null) && (
        <span className="prv-step__meta">
          {step.note}
          {step.model !== null && (
            <Chip mono tone="model">
              {step.model}
            </Chip>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * The merge that has not happened.
 *
 * @param props.step The step.
 * @returns The step — dashed while ghosted, solid once armed.
 */
function Future({ step }: Readonly<{ step: FutureStep }>) {
  return (
    <div className={cx("prv-step", FUTURE_CLASS[step.treatment])}>
      <span className="prv-step__label">{step.label}</span>
      <span className="prv-step__meta">{step.meta}</span>
    </div>
  );
}

/** What the strip is told. */
export interface RevisionStripProps {
  /** The steps, from `stripSteps`. */
  readonly steps: readonly StripStep[];
  /** The ordinal the gates are scoped to, or `null` while the page follows the latest. */
  readonly scoped: number | null;
  /** Told the ordinal a press scopes to, or `null` to follow the latest again. */
  readonly onScope: (seq: number | null) => void;
}

/**
 * The revision cycle strip ([#364](https://github.com/NobuData/ouroboros/issues/364)) — mockup
 * 12's `publish → verify → correct → re-publish`.
 *
 * Every step is `strip.ts`'s; this file only draws. A revision is a toggle button that scopes the
 * gates to its snapshot; the correction and the future step are not pressable, because there is
 * nothing to scope to.
 *
 * **It scrolls inside its own wrapper**, so a narrow pane never scrolls sideways. The step to
 * show — the scoped revision, else the latest — is brought into view by moving the wrapper's
 * `scrollLeft` alone: `scrollIntoView` would move the pane as well.
 *
 * @param props See {@link RevisionStripProps}.
 * @returns The card.
 */
export function RevisionStrip({ steps, scoped, onScope }: RevisionStripProps) {
  const titleId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLButtonElement>(null);

  const revisions = steps.filter((step): step is RevisionStep => step.kind === "revision");
  const shown =
    revisions.find((step) => step.seq === scoped) ?? revisions.find((step) => step.latest) ?? null;
  const shownId = shown?.id ?? null;

  useEffect(() => {
    const view = wrapper.current;
    const step = current.current;
    if (view === null || step === null) return;

    const viewBox = view.getBoundingClientRect();
    const stepBox = step.getBoundingClientRect();

    view.scrollLeft = scrollTarget({
      scrollLeft: view.scrollLeft,
      viewLeft: viewBox.left,
      viewWidth: view.clientWidth,
      stepLeft: stepBox.left,
      stepWidth: stepBox.width,
    });
  }, [shownId]);

  return (
    <Card aria-labelledby={titleId} as="section" className="prv-strip">
      <CardHead title={STRIP_TITLE} titleId={titleId} trailing={<Tag>{STRIP_TAG}</Tag>} />

      {steps.length === 0 ? (
        <p className="prv-strip__empty">{NO_REVISIONS}</p>
      ) : (
        <div className="prv-strip__scroll" ref={wrapper}>
          <ol className="prv-strip__steps">
            {steps.map((step) => (
              <li className="prv-strip__item" key={step.id}>
                {step.kind === "revision" ? (
                  <Revision
                    current={step.id === shownId ? current : undefined}
                    onScope={onScope}
                    scoped={step.seq === scoped}
                    step={step}
                  />
                ) : step.kind === "correction" ? (
                  <Correction step={step} />
                ) : (
                  <Future step={step} />
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}
