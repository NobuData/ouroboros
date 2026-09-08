/**
 * How much one poll of one repository is allowed to do, and how much of a cycle runs at once.
 *
 * K.4 ([#102](https://github.com/NobuData/ouroboros/issues/102)). The jitter and the chunking
 * are `scheduling/cadence.ts`'s — shared with the provider-health sweep, because a fleet that
 * spreads its polls one way and its health checks another has two rules where it needs one.
 * What is here is what is true of *this* loop.
 */

/**
 * The most issues one poll of one repository will carry.
 *
 * A cap on **memory**, and the reason it exists is the shape of the write. Decision K2 asks
 * for the row writes, the cursor and the freshness stamp to land in one transaction, so a
 * poll has to hold its rows until it has all of them — and a row can carry a 64 KiB body, so
 * an uncapped walk of a repository with a five-thousand-issue backlog is a few hundred
 * megabytes in a background job that nobody is watching.
 *
 * Five hundred rather than a page or a thousand: it is ten pages of
 * {@link "../github/github.client".PER_PAGE}, comfortably more than a poll of an ordinary
 * repository ever needs, and a bounded amount of memory to reserve for a job that runs
 * forever.
 *
 * **Reaching it is not a truncation.** The walk asks GitHub for issues in ascending
 * `updated` order, so the issues a capped poll stored are exactly the issues at or before the
 * watermark it then writes — the mirror stays coherent, the cursor says how far it got, and
 * {@link CONTINUATION_DELAY_MS} is what brings the rest in. A cold import of a large
 * repository is therefore several cycles back to back rather than one long one, and it says
 * so in its report and its log: a cap that was silent would read, from outside, exactly like
 * a poll that had covered everything.
 */
export const MAX_ISSUES_PER_POLL = 500;

/**
 * How many repositories are polled at once.
 *
 * Three, and lower than the health sweep's six on purpose. These are requests against **one
 * workspace's hourly GitHub budget** rather than against a handful of unrelated local
 * daemons, and a walk is many requests rather than one — so the thing worth spreading here is
 * not sockets but the rate at which a single token's allowance is spent. The rate guard
 * (`github/github.rate-limit.ts`) is what actually refuses to overspend it; this is what keeps
 * a cycle from arriving at that floor in a burst.
 */
export const REPO_CONCURRENCY = 3;

/**
 * How long after a cycle that left known work behind the next one starts — one second.
 *
 * Short deliberately. A cycle reports `pending` when at least one repository hit
 * {@link MAX_ISSUES_PER_POLL}, which means there is a known next page waiting and no reason
 * to make a cold import wait a full interval for each five hundred issues. It is not zero —
 * a zero delay is a spin rather than a schedule, and the point of the pause is that the rest
 * of the process gets the event loop back between cycles.
 */
export const CONTINUATION_DELAY_MS = 1000;
