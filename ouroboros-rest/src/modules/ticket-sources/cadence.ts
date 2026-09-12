/**
 * How much of a cycle runs at once, and how soon a cycle that left work behind comes back.
 *
 * Q.2 ([#139](https://github.com/NobuData/ouroboros/issues/139)). The jitter and the chunking
 * themselves are `scheduling/cadence.ts`'s, shared with the provider-health sweep and the
 * backlog sync — a second copy of a jitter formula is a second place a fleet's schedules can be
 * made to converge. What is here is what is true of *this* loop.
 *
 * **There is no `MAX_TICKETS_PER_SYNC` here, and its absence is the SPI working.**
 * `backlog-sync/cadence.ts` caps a poll at five hundred issues because that module *is* the
 * GitHub client: it walks pages and decides when to stop. This loop walks nothing. It makes one
 * call per source per cycle and stores the page that comes back, so how large a page is and how
 * many requests it took are the provider's business — which is the same sentence as *the loop
 * never interprets the cursor*, said about size instead of position. A cap written here would
 * be this module having an opinion about somebody else's pagination, and it would be wrong for
 * the first tracker whose page size it did not anticipate.
 *
 * **This is not a Nest module.** Three numbers; `scheduling/` and `errors/` set the precedent.
 */

/**
 * How many sources are polled at once.
 *
 * Three, matching `backlog-sync/cadence.ts` and lower than the health sweep's six, for that
 * file's reason generalized: these are requests against **somebody else's API budget**, one
 * credential at a time, rather than against a handful of unrelated local daemons. What is worth
 * spreading is not sockets but the rate at which a single token's allowance is spent.
 *
 * Per *source* rather than per workspace, which is the one thing that differs from the backlog
 * sync: two sources in one workspace may be two entirely separate trackers with separate
 * budgets, and serialising them would slow a workspace down to protect a limit they do not
 * share. Two sources that *do* share one — two GitHub sources on one enterprise — spend it
 * twice as fast, and the provider's own rate handling is what refuses to overspend it. This is
 * what keeps a cycle from arriving at that floor in a burst; it is not a substitute for it.
 */
export const SOURCE_CONCURRENCY = 3;

/**
 * How long after a cycle that left known work behind the next one starts — one second.
 *
 * Short deliberately. A cycle is `pending` when at least one provider answered
 * {@link import("./ticket-source.provider").TicketPage.hasMore}, which means there is a known
 * next page waiting and no reason to make a cold import wait a full interval for each of them.
 *
 * It is not zero — a zero delay is a spin rather than a schedule, and the point of the pause is
 * that the rest of the process gets the event loop back between cycles. `backlog-sync`'s value,
 * and deliberately the same one: two background loops that resume at different speeds for no
 * stated reason are two numbers somebody later has to reconcile.
 */
export const CONTINUATION_DELAY_MS = 1000;
