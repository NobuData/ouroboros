"use client";

import type { TestAttempt } from "@/app/api/test-results";

import { buildLabel } from "./view";

/** The picker's accessible name. */
export const ATTEMPTS_LABEL = "Build attempt";

/**
 * The attempt selector ([#335](https://github.com/NobuData/ouroboros/issues/335)) — which build
 * the whole page reads, defaulting to the latest.
 *
 * A plain row of toggles, one per attempt, so the choice is keyboard-reachable and announced as
 * pressed. The build attempts timeline (AU.2, [#336](https://github.com/NobuData/ouroboros/issues/336))
 * is the mockup's richer selector and calls the same `onSelect`; the page's state and its
 * `?attempt=` are the screen's either way.
 *
 * Nothing is drawn for a run with one attempt: there is nothing to choose between.
 *
 * @param props.attempts The run's attempts, oldest first.
 * @param props.selected The ordinal the page reads.
 * @param props.onSelect Read another attempt.
 * @returns The selector, or nothing.
 */
export function AttemptPicker({
  attempts,
  selected,
  onSelect,
}: Readonly<{
  attempts: readonly TestAttempt[];
  selected: number;
  onSelect: (attemptSeq: number) => void;
}>) {
  if (attempts.length < 2) return null;

  return (
    <ol aria-label={ATTEMPTS_LABEL} className="tests-attempts">
      <li aria-hidden="true" className="tests-attempts__label">
        {ATTEMPTS_LABEL}
      </li>
      {attempts.map((attempt) => (
        <li key={attempt.id}>
          <button
            aria-pressed={attempt.attemptSeq === selected}
            className="tests-attempts__button"
            onClick={() => onSelect(attempt.attemptSeq)}
            type="button"
          >
            {buildLabel(attempt.attemptSeq)}
          </button>
        </li>
      ))}
    </ol>
  );
}
