"use client";

import { Button, EmptyState } from "@/app/ui";

import { focusEnrollCard } from "./enroll-focus";
import { usePools } from "./pool-store";
import { NO_RUNNERS_TITLE } from "./runners";
import {
  CREATE_POOL,
  FIRST_RUN_MEMBER_NOTE,
  FIRST_RUN_NOTE,
  FIRST_RUN_STEPS_LABEL,
  type FarmFirstRun as FirstRunState,
  GO_TO_ENROLL,
  firstRunSteps,
} from "./states";

/**
 * The runners card's seat before there is a fleet — enrol-first guidance, not an empty table
 * (AI.7, [#262](https://github.com/NobuData/ouroboros/issues/262)).
 *
 * A fresh workspace has no runners at all, so this is the first thing every new tenant sees on
 * this page, and a bare *No runners enrolled yet.* under nine column headings would leave them to
 * work out that the next move is on a machine somewhere else. So the seat says what to do, in
 * order, and its one control takes the reader to where step one happens — which card that is,
 * and what the steps are, is `app/farm/states.ts`'s.
 *
 * - **No pool yet**: step one is creating one, and the control opens the pool sheet — which opens
 *   on its blank form when there is no pool to configure (`app/farm/pool-sheet.tsx`).
 * - **A pool, and no machine**: step one is the command, and the control moves focus to the
 *   enroll card (`app/farm/enroll-focus.ts`), which the grid has moved ahead of this card
 *   (`app/farm/farm-grid.tsx`).
 * - **A reader who may do neither** is told who can, in a sentence rather than an inert button.
 *   The steps stay: what has to happen is worth reading whoever does it.
 *
 * It is the design system's `EmptyState` with a list inside it, so the well, the dashed boundary
 * and the height it takes are the primitive's.
 *
 * @param props.state Which first-run state — see `farmFirstRun`.
 * @param props.mayAdminister Whether this reader may create a pool and mint a token.
 * @returns The seat.
 */
export function FarmFirstRun({
  state,
  mayAdminister,
}: Readonly<{ state: FirstRunState; mayAdminister: boolean }>) {
  const { openSheet } = usePools();

  return (
    <EmptyState
      fill
      note={mayAdminister ? FIRST_RUN_NOTE : FIRST_RUN_MEMBER_NOTE}
      title={NO_RUNNERS_TITLE}
    >
      {/*
        Keyed by the state, so the list is a new list when a step leaves it. Chromium does not
        renumber a flex `<ol>` whose first item was removed: with the items merely keyed, creating
        the first pool left the remaining steps reading `2.` and `3.` (found by the e2e leg's
        screenshot — jsdom draws no markers, so no suite here could see it).
      */}
      <ol aria-label={FIRST_RUN_STEPS_LABEL} className="farm-first-run" key={state}>
        {firstRunSteps(state).map((step) => (
          <li className="farm-first-run__step" key={step.title}>
            <span className="farm-first-run__title">{step.title}</span>
            <span className="farm-first-run__body">{step.body}</span>
          </li>
        ))}
      </ol>

      {mayAdminister &&
        (state === "no-pools" ? (
          <Button onClick={openSheet} tone="primary">
            {CREATE_POOL}
          </Button>
        ) : (
          <Button onClick={focusEnrollCard} tone="primary">
            {GO_TO_ENROLL}
          </Button>
        ))}
    </EmptyState>
  );
}
