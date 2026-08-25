import { act } from "@testing-library/react";

/**
 * Let React finish the transition whose *result* a `findBy*` just observed.
 *
 * Every switch and dialog in this module writes through `useTransition`, and each guards a
 * press with `if (pending) return` — a second press while a write is in flight is dropped
 * rather than queued, deliberately (`app/models/rules-card.tsx` says why). The tests that
 * press twice — a failed press and then the press that clears it, or an open that reads and
 * then the save — wait for the first press's *output* to reach the DOM before pressing again.
 * But the output and the end of the transition are two different moments: the state set
 * inside the action commits, a `findByRole("alert")` resolves on that mutation, and the
 * transition's `isPending` can still be true for one more turn of the scheduler. In
 * isolation the second press always lands after both; under a saturated test run (two
 * hundred jsdom workers on one machine, #592's suites tipping it) it sometimes lands between
 * them, the guard drops it, and a `waitFor` on a refresh that will never come times out.
 *
 * `act` with an empty async body is React's own way to drain what it has queued — effects,
 * microtasks, the pending flip — so the press that follows lands on a component that is no
 * longer pending. It is not a sleep and it does not slow a passing test.
 *
 * @returns A promise that resolves once React has nothing left queued.
 */
export async function settle(): Promise<void> {
  await act(async () => {});
}
