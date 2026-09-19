/**
 * The per-workspace ingest rate guard — one runaway build cannot starve log ingest for everyone.
 *
 * AH.5 ([#253](https://github.com/NobuData/ouroboros/issues/253)). Every agent is told to throttle
 * its log to `ack.limits.log_rate_bytes_per_s`, and AG.5's (#247) shipper will. This is the
 * server's own guard for when one does not: a token bucket per workspace, refilled at a
 * sustained rate up to a burst. A chunk the bucket cannot pay for is **not stored**, and its bytes
 * are carried to the next chunk that is as an elision — the log says where the hole is, and the
 * workspace's other builds, and every other workspace's, keep their share of the database.
 *
 * In memory and per process: a guard is a rate, not a ledger, and a restart that refills every
 * bucket costs one burst.
 */

import { LOG_ORG_BURST_BYTES, LOG_ORG_RATE_BYTES_PER_S } from "./log.policy";

/** The injection token, so a suite can bind a guard with a small bucket. */
export const FARM_LOG_RATE_GUARD = Symbol("FARM_LOG_RATE_GUARD");

/** One workspace's bucket. */
interface Bucket {
  tokens: number;
  /** When `tokens` was last brought up to date, in epoch milliseconds. */
  at: number;
}

export class RateGuard {
  private readonly buckets = new Map<string, Bucket>();

  /**
   * @param ratePerSecond - Sustained bytes per second each workspace may stream.
   * @param burst - The most it may stream at once, and what a fresh bucket holds.
   */
  constructor(
    private readonly ratePerSecond: number = LOG_ORG_RATE_BYTES_PER_S,
    private readonly burst: number = LOG_ORG_BURST_BYTES,
  ) {}

  /**
   * Whether a workspace may store this many bytes now — spending them if so.
   *
   * @param organizationId - The workspace.
   * @param bytes - The chunk's size.
   * @param now - Epoch milliseconds.
   * @returns True when the chunk may be stored; false when it is to be elided.
   */
  admit(organizationId: string, bytes: number, now: number): boolean {
    const bucket = this.refilled(organizationId, now);
    if (bytes > bucket.tokens) return false;

    bucket.tokens -= bytes;
    return true;
  }

  /**
   * Forget the buckets that have refilled completely — a workspace that has stopped streaming.
   *
   * @param now - Epoch milliseconds.
   */
  prune(now: number): void {
    for (const organizationId of [...this.buckets.keys()]) {
      if (this.refilled(organizationId, now).tokens >= this.burst) {
        this.buckets.delete(organizationId);
      }
    }
  }

  /**
   * A workspace's bucket, brought up to date.
   *
   * @param organizationId - The workspace.
   * @param now - Epoch milliseconds.
   * @returns The bucket.
   */
  private refilled(organizationId: string, now: number): Bucket {
    const bucket = this.buckets.get(organizationId) ?? { tokens: this.burst, at: now };
    const elapsed = Math.max(0, now - bucket.at) / 1000;

    bucket.tokens = Math.min(this.burst, bucket.tokens + elapsed * this.ratePerSecond);
    bucket.at = Math.max(bucket.at, now);
    this.buckets.set(organizationId, bucket);

    return bucket;
  }
}
