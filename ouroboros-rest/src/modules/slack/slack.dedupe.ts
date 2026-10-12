/**
 * Remembering which events have been seen (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535)).
 *
 * Slack redelivers an event on any doubt — a slow acknowledgement is enough — and without this
 * one event becomes several actions. Each delivery carries the same `event_id`, so the first is
 * processed and the rest are acknowledged and dropped.
 *
 * **Bounded, and in this process's memory.** It holds at most {@link DEFAULT_CAPACITY} ids for
 * {@link DEFAULT_TTL_MS}; Slack stops retrying well inside that. Two instances of this service
 * each keep their own, so a redelivery that reaches the other instance is processed again — the
 * handlers this guards are idempotent for that reason (revoking a revoked connection changes
 * nothing).
 */

/** How many event ids are remembered at once. */
export const DEFAULT_CAPACITY = 10_000;

/** How long an event id is remembered: longer than Slack's last retry (about an hour). */
export const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

/** A bounded set of recently seen ids. */
export class SeenEvents {
  /** Id → when it stops counting. Insertion order is age order, which eviction relies on. */
  private readonly seen = new Map<string, number>();

  /**
   * @param capacity - The most ids held at once.
   * @param ttlMs - How long an id is remembered.
   */
  constructor(
    private readonly capacity: number = DEFAULT_CAPACITY,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  /**
   * Record an id, and say whether it is new.
   *
   * @param id - The event's id.
   * @param now - The current time.
   * @returns `true` the first time an id is offered inside its lifetime — process it — and
   *   `false` for a redelivery.
   */
  first(id: string, now: Date): boolean {
    const at = now.getTime();
    const expires = this.seen.get(id);

    if (expires !== undefined && expires > at) {
      return false;
    }

    // Re-inserted rather than overwritten, so an id seen again after expiry moves to the young end.
    this.seen.delete(id);
    this.seen.set(id, at + this.ttlMs);
    this.evict(at);

    return true;
  }

  /** How many ids are held — for tests of the bound. */
  get size(): number {
    return this.seen.size;
  }

  /**
   * Drop what has expired, then the oldest until the bound holds.
   *
   * @param at - The current time, in epoch milliseconds.
   */
  private evict(at: number): void {
    for (const [id, expires] of this.seen) {
      if (expires > at && this.seen.size <= this.capacity) {
        break;
      }
      this.seen.delete(id);
    }
  }
}
