/**
 * A small time-bounded memo for the executor's hot path — AF.2
 * ([#235](https://github.com/NobuData/ouroboros/issues/235)).
 *
 * The streaming criterion is first-token overhead within +50 ms at 250 paced streams, and the
 * first measurement missed it by ten times: every call queued a dozen statements on the
 * process's ten database connections before its first token. Two of the reads repeat the same
 * answer for every call of a busy run, so they are memoised here:
 *
 * - **which workspace owns a run id** — immutable, so a long TTL is exact;
 * - **routing's resolution for (workspace, task kind)** — kept for one second. It is still
 *   routing's answer (R1: the executor re-decides nothing), and a route edit or a health change
 *   reaches the next call within that second; health itself is swept once a minute.
 *
 * The *promise* is stored, not the value, so a burst of concurrent calls shares one load
 * instead of each issuing it. A load that rejects is forgotten at once, so a failure is never
 * cached.
 */

/** One memoised load. */
interface Entry<V> {
  readonly expires: number;
  readonly value: Promise<V>;
}

export class TtlCache<V> {
  private readonly entries = new Map<string, Entry<V>>();

  /**
   * @param ttlMs - How long an answer is reused, milliseconds.
   * @param maxEntries - The bound on memory: the oldest entry is dropped beyond it.
   * @param now - The clock, for tests.
   */
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * The memoised answer for a key, loading it when absent or expired.
   *
   * @param key - The key.
   * @param load - What answers it.
   * @returns The answer.
   */
  get(key: string, load: () => Promise<V>): Promise<V> {
    const at = this.now();
    const held = this.entries.get(key);

    if (held !== undefined && held.expires > at) {
      return held.value;
    }

    const value = load();

    this.entries.delete(key);
    this.entries.set(key, { expires: at + this.ttlMs, value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) {
        this.entries.delete(key);
      }
    });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();

      if (oldest.done === true) {
        break;
      }

      this.entries.delete(oldest.value);
    }

    return value;
  }
}
