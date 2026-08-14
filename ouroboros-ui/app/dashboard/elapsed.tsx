"use client";

import { elapsedOfSeconds } from "@/app/format";
import { useSecondsNow } from "@/app/shell/clock";

/**
 * How long a run has been going, counting.
 *
 * **The second client component on this page, and the reason is the same as the greeting's
 * in one respect and the opposite in another.** The greeting needs the reader's clock because
 * a daypart is a fact about *where they are*; this needs it because an elapsed time is a fact
 * about *when it is now*, and the server's answer to that was true when the page was built
 * and is a little staler with every second that follows. Between polls the client holds the
 * only clock there is.
 *
 * ### It counts from the origin, not from the figure
 *
 * The obvious implementation — take the server's `12m 40s` and add a second to it each tick —
 * is the one that cannot satisfy this card's acceptance criterion, because it has no idea
 * what the real elapsed time is and drifts a little further from it on every re-render and
 * every dropped frame. This holds the run's **start** instead and recomputes `now − startedAt`
 * from a clock, which is what makes the number correct rather than merely increasing:
 *
 * - **A poll cannot move it.** [#87](https://github.com/NobuData/ouroboros/issues/87)'s
 *   refresh brings the same `startedAt` for the same run — the field is immutable for the
 *   life of a run — so a poll landing recomputes the identical figure. There is nothing to
 *   jump back to, which is a property of the arithmetic rather than a guard somebody has to
 *   remember.
 * - **A tab left in the background catches up.** A timer-based counter would have lost every
 *   tick the browser throttled; this reads the wall clock, so the first tick after the tab
 *   wakes shows the right time rather than the time it would have been if the tab had stayed
 *   awake.
 *
 * ### The one place the two clocks can disagree
 *
 * The server render and the first client tick are two different machines' answers to *what
 * time is it*, and a browser clock running behind the service's would take the figure
 * backwards at hydration — the one moment this card's criterion could still be broken. So
 * the server's own reading is a floor: the displayed elapsed is the larger of the two, and
 * the clock can only take it forwards from there.
 *
 * The count is drawn through {@link useSecondsNow}, which is one interval for the whole page
 * rather than one per row, so every duration in the column ticks on the same beat.
 */

/**
 * The elapsed cell.
 *
 * @param props.startedAtSeconds When the run started, in whole seconds since the epoch — the
 *   origin the count is measured from.
 * @param props.serverSeconds How long it had been running when the server rendered this. It
 *   is both the value the first paint shows — a real duration rather than a placeholder that
 *   would have to be replaced on hydration — and the floor no later reading may fall below.
 * @returns The duration, re-rendered once a second.
 */
export function Elapsed({
  startedAtSeconds,
  serverSeconds,
}: Readonly<{ startedAtSeconds: number; serverSeconds: number }>) {
  // The server snapshot is the instant the server rendered at, expressed the same way the
  // browser's is, so both sides of the hydration boundary run the identical subtraction and
  // React has nothing to reconcile.
  const now = useSecondsNow(startedAtSeconds + serverSeconds);

  return <>{elapsedOfSeconds(Math.max(serverSeconds, now - startedAtSeconds))}</>;
}
