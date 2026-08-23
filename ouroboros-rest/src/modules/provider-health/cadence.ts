/**
 * How often the sweep runs, and why no two deployments run it at the same moment.
 *
 * Z.3 ([#196](https://github.com/NobuData/ouroboros/issues/196)) asks for a **jittered**
 * cadence, and the reason is not politeness. Ouroboros is self-hosted: a hundred
 * installations that all schedule an hourly check on a whole-hour boundary are a hundred
 * requests arriving at a vendor's key-validation endpoint in the same second, every hour,
 * from a hundred addresses that look unrelated to each other and coordinated to the vendor.
 * That is a thundering herd whose members cannot see one another, and the only fix available
 * from inside one member is to stop being on the boundary.
 *
 * **The jitter is applied to every delay, including the first.** Waiting a jittered interval
 * before the *first* sweep is what stops a fleet restarted together — a rolled deployment, a
 * host reboot, a compose stack coming up — from converging on the same schedule for the rest
 * of its life. It costs a page one cycle of `unknown` chips after a cold start, which is the
 * honest thing for a page to show before anything has been checked anyway.
 *
 * ---------------------------------------------------------------------------
 * **Two cadences, because the difference that matters is whose machine answers.** A local
 * daemon is on the operator's own network; asking it every minute is a rounding error on a
 * loopback interface, and the strip's promise that a stopped Ollama goes amber *within one
 * cycle* is only worth making if a cycle is short. A vendor's endpoint is somebody else's
 * rate-limited service, so it is asked on a cadence measured in minutes and a row is only
 * revisited once its own `last_checked_at` is that old — which means the slow cadence is a
 * property of the row rather than of the sweep, and a sweep that runs every minute still only
 * key-validates a connection every fifteen.
 */

/**
 * How far either side of the base interval a delay may land — ±25%.
 *
 * Wide enough that a fleet spreads across a meaningful window within a few cycles, narrow
 * enough that "checks run about every minute" stays a true sentence an operator can plan
 * against. A spread approaching 1 would make the cadence unpredictable rather than merely
 * unsynchronised, and the acceptance criterion asks for the second thing.
 */
export const JITTER_SPREAD = 0.25;

/**
 * The most connections one sweep will check.
 *
 * A cap rather than a page, because the ordering is *oldest first*: a workspace with more
 * connections than this does not lose the tail, it reaches it on the next cycle, and the
 * rows that wait are always the ones checked most recently. The alternative — an uncapped
 * sweep — turns a tenant with a large registry into a burst of outbound requests whose size
 * nothing in this file bounds.
 *
 * When a sweep hits the cap it says so in its report and in its log. A cap that truncated
 * silently would read, from outside, exactly like a sweep that had covered everything.
 */
export const MAX_CHECKS_PER_SWEEP = 50;

/**
 * How many checks are in flight at once.
 *
 * Six: enough that a sweep of a handful of providers finishes in about one probe's time
 * rather than in the sum of them, small enough that a deployment behind a corporate proxy is
 * not opening fifty sockets at once every minute. The sweep is background work with a whole
 * cycle to finish in, so there is nothing to gain from finishing it faster than this.
 */
export const PROBE_CONCURRENCY = 6;

/**
 * How long one probe waits before it is called a timeout.
 *
 * Five seconds rather than the readiness probe's two (`health/probe.ts`). That probe answers
 * a compose healthcheck that has its own two-second deadline and will kill it; this one
 * answers nobody and is reaching a model server that may be loading a checkpoint off a slow
 * disk. Calling such a daemon *down* after two seconds would be this service's impatience
 * rendered as a provider's fault.
 */
export const PROBE_TIMEOUT_MS = 5000;

/**
 * A delay, moved off the boundary.
 *
 * @param baseMs - The nominal interval.
 * @param random - A source of `[0, 1)`. Injected so a test can assert the endpoints of the
 *   window rather than sample it and hope; nothing in the application passes it.
 * @returns A delay uniformly distributed across `baseMs` ± {@link JITTER_SPREAD}, rounded to
 *   whole milliseconds and never below 1 — `setTimeout(0)` is a delay that fires on the next
 *   tick, which for a sweep is a spin rather than a schedule.
 */
export function jittered(baseMs: number, random: () => number = Math.random): number {
  const offset = (random() * 2 - 1) * JITTER_SPREAD * baseMs;

  return Math.max(1, Math.round(baseMs + offset));
}

/**
 * Split a list into runs of at most `size`, preserving order.
 *
 * The whole of this module's concurrency control: the sweep awaits one chunk before starting
 * the next, so at most {@link PROBE_CONCURRENCY} probes are ever in flight. A semaphore would
 * keep the pipe fuller, and would be a scheduler of its own inside a file whose subject is
 * already scheduling — for background work with a full cycle to finish in, the simpler thing
 * is the right thing.
 *
 * @param items - The list.
 * @param size - The maximum run length. At least 1; a smaller value would produce empty runs
 *   forever and is a caller's bug rather than an input.
 * @returns The runs. Empty for an empty list, which is the common answer: most sweeps find
 *   nothing due.
 */
export function chunked<T>(items: readonly T[], size: number): T[][] {
  const runs: T[][] = [];

  for (let index = 0; index < items.length; index += Math.max(1, size)) {
    runs.push(items.slice(index, index + Math.max(1, size)));
  }

  return runs;
}
