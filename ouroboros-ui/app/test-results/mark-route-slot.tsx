"use client";

import { type Ref, useId } from "react";

import type { TestStrip } from "@/app/api/test-results";
import { Card, CardHead } from "@/app/ui";

/** The element id *Send failures back to loop* lands on — AU.6's card keeps it (#340). */
export const MARK_ROUTE_ID = "mark-route";

/** The card's title — the mockup's `MARK & ROUTE`. */
export const MARK_ROUTE_TITLE = "Mark & Route";

/** What the slot says until AU.6 draws the card. */
export const MARK_ROUTE_PENDING =
  "Classifying and routing failures arrives with the Mark & Route card (#340). The failed set below is staged for it.";

/** What the slot says before anything has been staged. */
export const NOTHING_STAGED = "Nothing is staged. Send failures back to loop stages this build's failed set here.";

/** The staged list's accessible name. */
export const STAGED_LABEL = "Staged failures";

/** A failed set handed to Mark & Route — which attempt it is, and its cases. */
export interface StagedFailures {
  readonly testRunId: string;
  readonly cases: TestStrip["failedCases"];
}

/**
 * Where *Send failures back to loop ⟳* lands ([#335](https://github.com/NobuData/ouroboros/issues/335))
 * — the Mark & Route card's place on the page, holding the failed set the head staged.
 *
 * AU.6 ([#340](https://github.com/NobuData/ouroboros/issues/340)) draws the card itself — the
 * classify radios, the note, the routing actions. Until it does, this is the honest slot: it takes
 * focus, names the staged cases, and says that deciding what to do with them is the next issue's,
 * rather than offering controls that do nothing. AU.6 replaces the body and keeps
 * {@link MARK_ROUTE_ID}, the ref and the `staged` prop.
 *
 * @param props.staged The staged failed set for the attempt on screen, or `null`.
 * @param props.ref The region, for the screen to scroll to and focus.
 * @returns The slot.
 */
export function MarkRouteSlot({
  staged,
  ref,
}: Readonly<{ staged: StagedFailures | null; ref?: Ref<HTMLElement> }>) {
  const titleId = useId();

  return (
    <section
      aria-labelledby={titleId}
      className="tests-route"
      id={MARK_ROUTE_ID}
      ref={ref}
      tabIndex={-1}
    >
      <Card>
        <CardHead title={MARK_ROUTE_TITLE} titleId={titleId} />
        <p className="tests-route__note">{staged === null ? NOTHING_STAGED : MARK_ROUTE_PENDING}</p>
        {staged !== null && (
          <ul aria-label={STAGED_LABEL} className="tests-route__list">
            {staged.cases.map((each) => (
              <li key={each.caseId}>
                {each.suite} › {each.name}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
