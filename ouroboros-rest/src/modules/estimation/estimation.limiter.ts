/**
 * How often one workspace may ask for an estimate — the re-estimation endpoints' rate limit.
 *
 * L.4 ([#108](https://github.com/NobuData/ouroboros/issues/108))'s last acceptance criterion:
 * *a per-org rate limit rejects a hammering caller with a designed error*. The ticket asks for
 * **a simple counter** and says why it is simple: full budget accounting belongs to the
 * provider roadmap (mockup 07), and a counter here must not pre-empt the shape that lands
 * there.
 *
 * ---------------------------------------------------------------------------
 * ## Per **workspace**, because the thing being protected is the workspace's
 *
 * An estimate costs an engine call, and once O.2
 * ([#123](https://github.com/NobuData/ouroboros/issues/123)) swaps `heuristic-v0` for a model
 * it costs somebody's money. Both are the workspace's rather than the caller's, so a per-user
 * limit would be the wrong shape twice over: three members of one workspace could spend three
 * times the budget, and one member acting in two workspaces would be limited across a boundary
 * that means nothing to whoever pays.
 *
 * `reveal.limiter.ts` keeps *two* buckets for the opposite reason — an exfiltration looks
 * different from the account's side than from the credential's — and that argument does not
 * transfer: there is nothing here an attacker learns, only work they can cause.
 *
 * **This file and that one are the same forty lines twice, and that is a decision rather than an
 * oversight.** What differs is not the sweep or the arithmetic but everything a caller sees: one
 * bucket against two, a workspace against a user *and* a connection, and a refusal that names no
 * scope because there is only one. Extracting the window now would mean editing a shipped,
 * security-sensitive limiter to serve a second caller with different needs, on a ticket that has
 * no reason to touch it. **A third limiter is what should force the abstraction**, and it will
 * arrive with a shape both of these can be read against rather than with one guessed from two.
 *
 * ## Every attempt counts, not every accepted one
 *
 * A request refused `409` or `404` still cost a database read, and the caller the criterion
 * names — one hammering the endpoint — is *mostly* collecting `409`s, because their second
 * click lands on an issue their first one moved into `estimating`. Counting only the accepted
 * ones would leave exactly that caller unlimited. So the limiter runs first, ahead of the
 * lookup, and what it counts is *requests that got past the guards*.
 *
 * ## A sliding window, in memory
 *
 * `reveal.limiter.ts`' two trades, unchanged and for its reasons. **Sliding** rather than a
 * fixed bucket, because a fixed one admits twice the limit across a boundary and because an
 * honest `retryAfterSeconds` falls out of the oldest attempt's age rather than out of a clock
 * division. **In memory**, so a second replica keeps its own counter and a limit of thirty
 * across two replicas is a limit of sixty — a real weakening, bounded and stated rather than
 * papered over, and the alternative is shared state on the hot path of every request.
 */

import { Injectable } from "@nestjs/common";

/** How long the window is, in seconds — **one minute**. */
export const ESTIMATION_WINDOW_SECONDS = 60;

/** The window in milliseconds, which is what the arithmetic below is in. */
export const ESTIMATION_WINDOW_MS = ESTIMATION_WINDOW_SECONDS * 1000;

/**
 * How many estimation requests one workspace may make in a window — **thirty**.
 *
 * Sized against the screen it serves. Mockup 03's panel offers *Re-estimate* one issue at a
 * time, so thirty a minute is a person working through a backlog faster than they can read it,
 * or two people doing it at once — neither meets this. A script does, on its second second.
 *
 * *Re-estimate all* costs one against the same counter rather than one per issue it fans out
 * to, and that is deliberate: it is `admin`-gated, and it is self-limiting in a way the single
 * endpoint is not — the second one inside a minute finds every row already `estimating` and
 * queues nothing. Charging it per issue would make the honest use of the button spend a
 * workspace's whole allowance in one press.
 */
export const ESTIMATION_ATTEMPTS_PER_WINDOW = 30;

/** An attempt that was refused, and how much longer the window holds. */
export interface EstimationLimitExceeded {
  /**
   * Whole seconds until the window has room, always at least one.
   *
   * Rounded **up**, because a client that retried at the exact boundary would be refused
   * again — and a refusal that recommends a moment that does not work is worse than one that
   * recommends nothing.
   */
  readonly retryAfterSeconds: number;
}

@Injectable()
export class EstimationLimiter {
  /**
   * When each workspace's recent attempts happened, oldest first.
   *
   * Each list is bounded by {@link ESTIMATION_ATTEMPTS_PER_WINDOW} — an attempt is only
   * appended when the window had room — so this map's size is *workspaces that asked for an
   * estimate in the last minute*, not *attempts*.
   */
  private readonly attempts = new Map<string, number[]>();

  /**
   * Record one attempt, or refuse it.
   *
   * Checking and recording are one call on purpose, exactly as `reveal.limiter.ts` argues:
   * two — `check()` then `record()` — is an interface where forgetting the second is an
   * unlimited endpoint whose tests still pass.
   *
   * @param organizationId - The workspace asking.
   * @param now - The instant of the attempt. Passed in rather than read from the clock, so a
   *   spec can drive a window without waiting through one.
   * @returns `null` when the attempt may proceed — and it has been counted — or how long until
   *   it may. **A refused attempt is not counted**: a caller hammering a full window would
   *   otherwise keep pushing its own recovery away, which turns a one-minute limit into an
   *   indefinite one.
   */
  attempt(organizationId: string, now: Date): EstimationLimitExceeded | null {
    // Everything is swept, not only the bucket this attempt touches. Pruning lazily would
    // leave a bucket for every workspace that has ever asked, each held long after it can
    // refuse anything — a leak with a one-minute useful life.
    this.sweep(now);

    const recent = this.attempts.get(organizationId) ?? [];

    if (recent.length >= ESTIMATION_ATTEMPTS_PER_WINDOW) {
      return { retryAfterSeconds: retryAfter(recent[0], now) };
    }

    this.attempts.set(organizationId, [...recent, now.getTime()]);

    return null;
  }

  /**
   * How many workspaces are being held. For the suite, and for nothing else.
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
   * process alive and a thing every test has to remember to stop, and the map only grows when
   * something is written to it.
   *
   * @param now - The instant to judge against.
   */
  private sweep(now: Date): void {
    for (const [key, attempts] of this.attempts) {
      const recent = attempts.filter((at) => now.getTime() - at < ESTIMATION_WINDOW_MS);

      if (recent.length === 0) {
        this.attempts.delete(key);
      } else {
        this.attempts.set(key, recent);
      }
    }
  }
}

/**
 * How long until the oldest attempt in a full window leaves it.
 *
 * @param oldest - When the oldest live attempt happened, in milliseconds.
 * @param now - The instant to judge against.
 * @returns Whole seconds, at least one — see {@link EstimationLimitExceeded.retryAfterSeconds}.
 */
function retryAfter(oldest: number, now: Date): number {
  return Math.max(1, Math.ceil((oldest + ESTIMATION_WINDOW_MS - now.getTime()) / 1000));
}
