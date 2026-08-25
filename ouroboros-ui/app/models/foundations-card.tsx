import { Button, Card, CardHead, Chip, EmptyState, cx, type ChipTone } from "@/app/ui";
import { PROVIDERS_PATH } from "@/app/paths";

import {
  DEV_SEED_NOTE,
  FOUNDATIONS_TITLE,
  type FoundationStep,
  type GuidanceState,
  PROVIDERS_LINK,
  SEED_ROUTES,
  SEED_ROUTES_REASON,
  STEP_WORD,
  type StepStatus,
  foundationSteps,
  guidanceNote,
  guidanceTitle,
} from "./states";

import "./models.css";

/**
 * The guidance a fresh workspace gets in the matrix's seat (AA.6,
 * [#205](https://github.com/NobuData/ouroboros/issues/205)) — the path from nothing to a
 * working matrix, with the reader's place on it marked.
 *
 * It stands where the matrix will, at the matrix's eight columns and beside the same right
 * column, because the populated page is the state every empty state has to approach without
 * a jump: the reader who connects a provider and comes back finds the same grid with one
 * step ticked, not a different page.
 *
 * ### Two steps, both always drawn
 *
 * One message per state would tell the reader what to do now and nothing about what comes
 * after. Drawing the path — *connect a provider*, *seed the default routes* — lets a reader on
 * step one see step two coming, and a reader on step two see what is already done. Which step
 * is next, and what each says, is `app/models/states.ts`'s decision; this places it.
 *
 * ### The pointer is a link, and the bootstrap is honest about itself
 *
 * The ticket was filed when mockup 07's surface did not exist and asked for an *honest
 * pointer* to it. AE.1 ([#227](https://github.com/NobuData/ouroboros/issues/227)) and AE.5
 * ([#231](https://github.com/NobuData/ouroboros/issues/231)) built it since, so the honest
 * pointer is now a **link** to `/models/providers` — a *soon* over a surface that exists
 * would be the dishonest rendering, the same amendment AA.4 made for the registry footnote.
 *
 * The bootstrap runs the other way. A task kind is a row nothing in the routing contract
 * writes — `PUT /api/v1/routing/routes` refuses a kind the workspace does not have, and the
 * eight defaults come from the development seed and nowhere else — so **Seed default routes**
 * is drawn where it belongs, in its real position, inert with the reason
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.5), and the reason is printed as well as carried:
 * a control that could not act and did not say why would be the page pretending. The day
 * the service can write the eight kinds, the control's handler is the one thing to add.
 *
 * A Server Component: everything here is decided before it is drawn.
 */

/** The id the card's `aria-labelledby` points at. */
const FOUNDATIONS_TITLE_ID = "models-foundations-title";

/** The hue each step status wears — with the word beside it, never alone. */
const STEP_TONE: Record<StepStatus, ChipTone> = {
  done: "ok",
  current: "model",
  pending: "neutral",
  unknown: "neutral",
};

/** The modifier each status adds to its step. */
const STEP_CLASS: Record<StepStatus, string> = {
  done: "models-foundations__step--done",
  current: "models-foundations__step--current",
  pending: "models-foundations__step--pending",
  unknown: "models-foundations__step--unknown",
};

/**
 * The card.
 *
 * @param props.state Which of the two guidance states the page is in.
 * @returns The card, in the matrix's seat.
 */
export function FoundationsCard({ state }: Readonly<{ state: GuidanceState }>) {
  return (
    <Card
      aria-labelledby={FOUNDATIONS_TITLE_ID}
      as="section"
      className="models-col--8 models__next"
      fill
    >
      <CardHead title={FOUNDATIONS_TITLE} titleId={FOUNDATIONS_TITLE_ID} />

      <EmptyState fill note={guidanceNote(state)} title={guidanceTitle(state)} variant="flush">
        <ol className="models-foundations">
          {foundationSteps(state).map((step, index) => (
            <StepView index={index} key={step.key} step={step} />
          ))}
        </ol>

        <p className="models-foundations__dev">{DEV_SEED_NOTE}</p>
      </EmptyState>
    </Card>
  );
}

/**
 * One step: its number, its title with the status word beside it, its note, and — for the
 * step that is next — its control.
 *
 * `aria-current="step"` on the next step, which is the ARIA vocabulary for exactly this: a
 * list of steps and the one the reader is on.
 *
 * @param props.step The decided step.
 * @param props.index Its place, for the number the mark prints.
 * @returns The list item.
 */
function StepView({ step, index }: Readonly<{ step: FoundationStep; index: number }>) {
  return (
    <li
      aria-current={step.status === "current" ? "step" : undefined}
      className={cx("models-foundations__step", STEP_CLASS[step.status])}
    >
      {/* The number repeats the list's own order; the word beside the title carries the state. */}
      <span aria-hidden className="models-foundations__mark">
        {index + 1}
      </span>
      <div className="models-foundations__body">
        <p className="models-foundations__title">
          {step.title}
          <Chip dot={step.status === "unknown" ? "ring" : "filled"} tone={STEP_TONE[step.status]}>
            {STEP_WORD[step.status]}
          </Chip>
        </p>
        <p className="models-foundations__note">{step.note}</p>
        {step.status === "current" && <StepAction step={step} />}
      </div>
    </li>
  );
}

/**
 * The next step's control: a link into Providers & keys, or the bootstrap, inert with its
 * reason.
 *
 * @param props.step The step that is next.
 * @returns The control, and the reason in print where the control cannot act.
 */
function StepAction({ step }: Readonly<{ step: FoundationStep }>) {
  if (step.key === "provider") {
    return (
      <div className="models-foundations__action">
        <Button href={PROVIDERS_PATH} size="sm" tone="primary">
          {PROVIDERS_LINK}
        </Button>
      </div>
    );
  }

  return (
    <div className="models-foundations__action">
      <Button reason={SEED_ROUTES_REASON} size="sm" tone="primary">
        {SEED_ROUTES}
      </Button>
      {/*
        The reason, printed as well as carried: a title is what the house rule gives an inert
        control, and a hover is not something every reader has.
      */}
      <p className="models-foundations__reason">{SEED_ROUTES_REASON}</p>
    </div>
  );
}
