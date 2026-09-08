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
 *
 * ---------------------------------------------------------------------------
 * **The jitter itself is not here any more.** `jittered` and `chunked` moved to
 * `scheduling/cadence.ts` when K.4 ([#102](https://github.com/NobuData/ouroboros/issues/102))
 * became this service's second periodic job — two copies of a jitter formula are two places a
 * fleet's schedules can be made to converge, and the reasoning above is unchanged by having
 * one implementation instead of two. What remains here is what is true of *this* sweep.
 */

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
