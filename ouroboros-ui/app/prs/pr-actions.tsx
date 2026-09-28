"use client";

import Link from "next/link";
import { useId } from "react";

import { Button, cx } from "@/app/ui";

import { ACTIONS_LABEL, type ActionView, type ActionsView, type OutcomeView } from "./view";

/** What the actions are told. */
export interface PrActionsProps {
  /** The three actions, from `actionsView`. */
  readonly view: ActionsView;
  /** What became of the last press, or `null`. */
  readonly outcome: OutcomeView | null;
  /** Ask for a human review. */
  readonly onRequestReview: () => void;
  /** Open *Return to loop*'s dialog. */
  readonly onReturn: () => void;
  /** Hand off to the Merge plan card. */
  readonly onMerge: () => void;
}

/**
 * The head's three actions ([#363](https://github.com/NobuData/ouroboros/issues/363)) — mockup
 * 12's **Request human review**, **Return to loop** (danger) and **Merge when all gates green**
 * (primary).
 *
 * **Hidden by role, honest by state.** An action the reader's role may not take is not drawn
 * (`actionsView` answers `null` for it). One that is drawn and cannot act is inert with its
 * reason — `Button`'s `reason`: the tooltip and `aria-disabled` — and, because a tooltip is not a
 * visible reason, the same sentence is printed under the row and named as the button's
 * description. A reason several actions share is printed once.
 *
 * *Return to loop* opens a dialog and *Merge when all gates green* is a hand-off: neither acts on
 * the press alone. What was decided is `view.ts`'s; this file only draws it.
 *
 * @param props See {@link PrActionsProps}.
 * @returns The actions.
 */
export function PrActions({ view, outcome, onRequestReview, onReturn, onMerge }: PrActionsProps) {
  const notes = useId();
  // Each reason once, in the buttons' order: a merged PR switches all three off for one reason,
  // and that reason is one sentence rather than three.
  const reasons = [
    ...new Set(
      [view.review, view.returnToLoop, view.merge].flatMap((action) =>
        action === null || action.reason === null ? [] : [action.reason],
      ),
    ),
  ];

  /**
   * The id of the note an inert action is described by.
   *
   * @param action The action.
   * @returns The id of the note carrying its reason, or nothing for an action that is on.
   */
  function described(action: ActionView): string | undefined {
    return action.reason === null ? undefined : `${notes}-${reasons.indexOf(action.reason)}`;
  }

  return (
    <div aria-label={ACTIONS_LABEL} className="prv-actions" role="group">
      <div className="prv-actions__row">
        {view.review !== null && (
          <Button
            aria-describedby={described(view.review)}
            onClick={onRequestReview}
            reason={view.review.reason ?? undefined}
            tone="ghost"
          >
            {view.review.label}
          </Button>
        )}
        {view.returnToLoop !== null && (
          <Button
            aria-describedby={described(view.returnToLoop)}
            aria-haspopup="dialog"
            onClick={onReturn}
            reason={view.returnToLoop.reason ?? undefined}
            tone="danger"
          >
            {view.returnToLoop.label}
          </Button>
        )}
        {view.merge !== null && (
          <Button
            aria-describedby={described(view.merge)}
            onClick={onMerge}
            reason={view.merge.reason ?? undefined}
            tone="primary"
          >
            {view.merge.label}
          </Button>
        )}
      </div>

      {reasons.length > 0 && (
        <ul className="prv-actions__notes">
          {reasons.map((reason, index) => (
            <li className="prv-actions__note" id={`${notes}-${index}`} key={reason}>
              {reason}
            </li>
          ))}
        </ul>
      )}

      {outcome !== null && (
        <p
          className={cx("prv-actions__outcome", outcome.failed && "prv-actions__outcome--failed")}
          role="status"
        >
          {outcome.text}
          {outcome.link !== null && (
            <>
              {" "}
              <Link className="prv-actions__receipt" href={outcome.link.href}>
                {outcome.link.label}
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
