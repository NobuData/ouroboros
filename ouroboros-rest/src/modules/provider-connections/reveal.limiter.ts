/**
 * How often a credential may be asked for — the reveal endpoint's rate limit.
 *
 * AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223))'s acceptance criterion
 * *reveal is rate-limited per user and per connection*, which is two limits rather than one
 * because they catch different things:
 *
 *   * **per user** — one account walking the workspace's whole provider list, which is what
 *     an exfiltration looks like from the account's side;
 *   * **per connection** — several accounts converging on one credential, which is what the
 *     same exfiltration looks like when the attacker has more than one session, and which a
 *     per-user limit alone cannot see at all.
 *
 * Both have to be clear for an attempt to proceed, and whichever is full is named in the
 * refusal, because the two have different remedies.
 *
 * ---------------------------------------------------------------------------
 * **Every attempt counts, not every success.**
 *
 * The step-up runs *behind* this limiter, so a wrong password consumes an attempt. A limiter
 * that only counted successful reveals would leave the password comparison unlimited, which
 * is a password oracle with a rate limit guarding the wrong door. `provider-connections.service.ts`
 * is where the order is fixed, and it is the one ordering in this module that is a security
 * property rather than a preference.
 *
 * ---------------------------------------------------------------------------
 * **A sliding window, in memory, and both halves of that are trades worth naming.**
 *
 * *Sliding* rather than a fixed bucket, because a fixed bucket admits twice the limit across
 * a boundary — five reveals at 11:59:59 and five more at 12:00:00 — and because the honest
 * `retryAfterSeconds` a refusal owes a client falls out of the oldest attempt's age rather
 * than out of a clock division.
 *
 * *In memory* for `step-up.ts`'s reason, seen from the other side: a second replica has its
 * own counters, so a limit of ten across two replicas is a limit of twenty. That is a real
 * weakening and it is bounded and stated rather than papered over — the alternative is a
 * shared counter, which means Redis or a table written on every attempt, and neither is
 * something this ticket gets to add to the deployment. What it buys is that a single process
 * — which is every deployment of this service today — enforces exactly what it says.
 */

import { Injectable } from "@nestjs/common";

/** How long the window is, in seconds — **five minutes**, matching the step-up's own. */
export const REVEAL_WINDOW_SECONDS = 5 * 60;

/** The window in milliseconds, which is what the arithmetic below is in. */
export const REVEAL_WINDOW_MS = REVEAL_WINDOW_SECONDS * 1000;

/**
 * How many reveal attempts one person may make in a window — **ten**.
 *
 * Mockup 07 draws five provider cards, so ten is *"reveal everything you have, twice"*: an
 * administrator auditing their workspace's keys never meets it, and a script walking the
 * list meets it on its second pass.
 */
export const REVEAL_ATTEMPTS_PER_USER = 10;

/**
 * How many reveal attempts one connection may take in a window — **five**.
 *
 * Lower than the per-user limit on purpose. Revealing *one* key five times in five minutes
 * is not a thing a person does — the value is on their screen already — so this is the limit
 * that catches a credential being pulled repeatedly, whoever is asking and however many
 * sessions they hold.
 */
export const REVEAL_ATTEMPTS_PER_CONNECTION = 5;

/** Which limit refused an attempt. */
export type RevealLimitScope = "user" | "connection";

/** An attempt that was refused: which bucket was full, and for how much longer. */
export interface RevealLimitExceeded {
  /** The bucket that refused it. */
  readonly scope: RevealLimitScope;
  /**
   * Whole seconds until that bucket has room, always at least one.
   *
   * Rounded **up**, because a client that retried at the exact boundary would be refused
   * again — and a refusal that recommends a moment that does not work is worse than no
   * recommendation.
   */
  readonly retryAfterSeconds: number;
}

@Injectable()
export class RevealLimiter {
  /**
   * When each bucket's recent attempts happened, oldest first.
   *
   * Keyed `"user:<id>"` / `"connection:<id>"`, so the two namespaces cannot collide even if
   * a user id and a connection id were ever the same string. Each list is bounded by that
   * bucket's limit — an attempt is only appended when the bucket had room — so this map's
   * size is *sessions active in the last five minutes*, not *attempts*.
   */
  private readonly attempts = new Map<string, number[]>();

  /**
   * Record one reveal attempt, or refuse it.
   *
   * Checking and recording are one call on purpose: two — `check()` then `record()` — is an
   * interface where forgetting the second is an unlimited endpoint that passes its tests.
   *
   * @param userId - Who is asking.
   * @param connectionId - Which connection they are asking about.
   * @param now - The instant of the attempt. Passed in rather than read from the clock, so a
   *   spec can drive a window without waiting through one.
   * @returns `null` when the attempt may proceed — and it has been counted — or which limit
   *   refused it. **Nothing is counted against a refused attempt**: a caller hammering a
   *   full bucket would otherwise keep pushing its own recovery further away, which turns a
   *   five-minute limit into an indefinite lockout.
   */
  attempt(userId: string, connectionId: string, now: Date): RevealLimitExceeded | null {
    // Everything is swept, not only the two buckets this attempt touches. Pruning lazily
    // would leave a bucket for every person and every connection that has ever revealed a
    // key in this process's lifetime, each one held long after it can refuse anything — a
    // leak with a five-minute useful life. The sweep is over a map whose size is *active in
    // the last five minutes*, on an operation that is itself rate-limited.
    this.sweep(now);

    const buckets = [
      { scope: "user" as const, key: `user:${userId}`, limit: REVEAL_ATTEMPTS_PER_USER },
      {
        scope: "connection" as const,
        key: `connection:${connectionId}`,
        limit: REVEAL_ATTEMPTS_PER_CONNECTION,
      },
    ];

    for (const bucket of buckets) {
      const recent = this.attempts.get(bucket.key) ?? [];

      if (recent.length >= bucket.limit) {
        return { scope: bucket.scope, retryAfterSeconds: retryAfter(recent[0], now) };
      }
    }

    for (const bucket of buckets) {
      this.attempts.set(bucket.key, [...(this.attempts.get(bucket.key) ?? []), now.getTime()]);
    }

    return null;
  }

  /**
   * How many buckets are being held. For the suite, and for nothing else.
   *
   * @returns The map's size.
   */
  size(): number {
    return this.attempts.size;
  }

  /**
   * Drop every attempt that has left the window, and every bucket that empties.
   *
   * Swept on write rather than on a timer: a timer in a singleton is a handle that keeps a
   * process alive and a thing every test has to remember to stop, and the map only grows
   * when something is written to it.
   *
   * @param now - The instant to judge against.
   */
  private sweep(now: Date): void {
    for (const [key, attempts] of this.attempts) {
      const recent = attempts.filter((at) => now.getTime() - at < REVEAL_WINDOW_MS);

      if (recent.length === 0) {
        this.attempts.delete(key);
      } else {
        this.attempts.set(key, recent);
      }
    }
  }
}

/**
 * How long until the oldest attempt in a full bucket leaves the window.
 *
 * @param oldest - When the oldest live attempt happened, in milliseconds.
 * @param now - The instant to judge against.
 * @returns Whole seconds, at least one — see {@link RevealLimitExceeded.retryAfterSeconds}.
 */
function retryAfter(oldest: number, now: Date): number {
  return Math.max(1, Math.ceil((oldest + REVEAL_WINDOW_MS - now.getTime()) / 1000));
}
