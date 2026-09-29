"use client";

import type { TestCaseFailureDetail, TestRunHints } from "@/app/api/test-results";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";

import { type FailureScope, boundIndex, buildTag, triageView } from "./failure";
import { FailureCard } from "./failure-card";
import { type TestsPollOptions, createFailurePoll, failureKey } from "./poll";

/** What the binding is told. */
export interface FailureDetailProps {
  /** The attempt on screen. */
  readonly testRunId: string;
  /** Its ordinal — `3` for Build 3. */
  readonly attemptSeq: number;
  /** The failures in scope, from `failureScope` — or `null` while the page has not been read. */
  readonly scope: FailureScope | null;
  /** The case the pager was moved to, or `null` while it has not been moved. */
  readonly position: string | null;
  /** The pager was moved to a case. */
  readonly onPage: (caseId: string) => void;
  /** The attempt's triage hints, or `null` while they have not been read. */
  readonly hints: TestRunHints | null;
  /** Why the hints could not be read, or `null`. */
  readonly hintsError: string | null;
  /** Test seams for the failure's poll; production passes none. */
  readonly failurePoll?: TestsPollOptions<TestCaseFailureDetail>;
}

/**
 * The failure-detail card, bound ([#339](https://github.com/NobuData/ouroboros/issues/339)):
 * which of the failures in scope is on the card, and that failure's payload.
 *
 * **The pager's position is the screen's**, because the Mark & Route card
 * ([#340](https://github.com/NobuData/ouroboros/issues/340)) decides the failure this card shows
 * and the two must never disagree about which that is. It is a case's id, resolved against the
 * scope on every render — so a poll that adds a failure does not move the card, and a case that
 * left the scope falls back to the first. The screen holds it per attempt and pair of selections,
 * so a selection change from either card re-binds both from the start.
 *
 * **The failure is polled per case**, keyed on the attempt and the case together: another case's
 * log is never drawn under this one's path, and a failed refresh keeps the last answer on the
 * card under a banner.
 *
 * @param props See {@link FailureDetailProps}.
 * @returns The card.
 */
export function FailureDetail({
  testRunId,
  attemptSeq,
  scope,
  position,
  onPage,
  hints,
  hintsError,
  failurePoll,
}: FailureDetailProps) {
  const entries = scope?.entries ?? [];
  const index = boundIndex(entries, position);
  const bound = entries[index] ?? null;

  const read = useKeyedPoll(bound === null ? null : failureKey(testRunId, bound.caseId), (key) =>
    createFailurePoll(key, failurePoll),
  );
  const answered = read.snapshot.data;
  // Drawn only when it is the bound case's — never another case's log under this one's pager.
  const failure = answered !== null && answered.caseId === bound?.caseId ? answered : null;

  return (
    <FailureCard
      build={buildTag(attemptSeq)}
      error={read.snapshot.error}
      failure={failure}
      index={index}
      onPage={onPage}
      onRetry={read.refresh}
      scope={scope}
      triage={
        bound === null ? { kind: "none" } : triageView(hints, bound.caseId, hintsError)
      }
    />
  );
}
