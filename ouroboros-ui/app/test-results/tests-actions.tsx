"use client";

import { useId } from "react";

import type { RerunScope } from "@/app/api/test-results";
import { Button, cx } from "@/app/ui";

import { ACTIONS_LABEL, type ActionsView } from "./view";

/** What became of the last press, said under the buttons. */
export interface ActionOutcome {
  readonly text: string;
  /** Whether it is a refusal rather than a queued build. */
  readonly failed: boolean;
}

/** What the actions are told. */
export interface TestsActionsProps {
  /** The three actions, from `actionsView`. */
  readonly view: ActionsView;
  /** What became of the last re-run, or `null`. */
  readonly outcome: ActionOutcome | null;
  /** Queue a re-run of the attempt. */
  readonly onRerun: (scope: RerunScope) => void;
  /** Stage the failed set on Mark & Route and take the reader there. */
  readonly onSendBack: () => void;
}

/**
 * The head's three actions ([#335](https://github.com/NobuData/ouroboros/issues/335)) — mockup
 * 11's **Re-run failed (N)**, **Re-run full suite** and **Send failures back to loop ⟳**.
 *
 * **Honestly gated.** A button that cannot act is inert with its reason (`Button`'s `reason`:
 * the tooltip and `aria-disabled`), and because a tooltip is not a visible reason the same
 * sentence is printed under the row and named as each inert button's description. What was
 * decided is `actionsView`'s; this file only draws it.
 *
 * *Send failures back to loop* is the primary action and a navigation, not a dispatch: it stages
 * the failed set on the Mark & Route card and moves focus there, because the decision about what
 * to send back still belongs to a person.
 *
 * @param props See {@link TestsActionsProps}.
 * @returns The actions.
 */
export function TestsActions({ view, outcome, onRerun, onSendBack }: TestsActionsProps) {
  const noteId = useId();
  const described = (reason: string | null) => (reason === null ? undefined : noteId);

  return (
    <div aria-label={ACTIONS_LABEL} className="tests-actions" role="group">
      <div className="tests-actions__row">
        <Button
          aria-describedby={described(view.rerunFailed.reason)}
          onClick={() => onRerun("failed")}
          reason={view.rerunFailed.reason ?? undefined}
          tone="ghost"
        >
          {view.rerunFailed.label}
        </Button>
        <Button
          aria-describedby={described(view.rerunFull.reason)}
          onClick={() => onRerun("full")}
          reason={view.rerunFull.reason ?? undefined}
          tone="ghost"
        >
          {view.rerunFull.label}
        </Button>
        <Button
          onClick={onSendBack}
          reason={view.sendBack.reason ?? undefined}
          tone="primary"
        >
          {view.sendBack.label}
        </Button>
      </div>

      {view.note !== null && (
        <p className="tests-actions__note" id={noteId}>
          {view.note}
        </p>
      )}

      {outcome !== null && (
        <p
          className={cx("tests-actions__outcome", outcome.failed && "tests-actions__outcome--failed")}
          role="status"
        >
          {outcome.text}
        </p>
      )}
    </div>
  );
}
