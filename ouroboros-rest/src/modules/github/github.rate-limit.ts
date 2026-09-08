/**
 * The rate guard — what makes this product back off *before* GitHub refuses it rather than
 * after.
 *
 * K.3 ([#101](https://github.com/NobuData/ouroboros/issues/101)): *"read
 * `x-ratelimit-remaining`, back off before exhaustion rather than after a 403"*.
 *
 * GitHub sends the state of the token's hourly budget on **every** response, whether the
 * call succeeded or not. Reading it costs nothing, and it is the difference between two very
 * different products:
 *
 *   * Without it, the poller runs until GitHub answers `403`, and the budget is spent at the
 *     moment somebody opens the intake page. Every interactive call then fails too, because
 *     the limit is per **token** and there is one token per workspace — so a background job
 *     nobody asked about has taken the page down.
 *   * With it, the poller stops at {@link RATE_LIMIT_FLOOR} and says so. The reserve is what
 *     an administrator's own click spends, and the card renders *"sync paused
 *     (rate-limited)"* — which is the honest state M.4 and N.6 are written around, and a
 *     state the product entered on purpose rather than one it was put into.
 *
 * ---------------------------------------------------------------------------
 * **This is a cache, not a store, and the distinction is load-bearing.**
 *
 * The map holds one small record per workspace that has called GitHub since this process
 * started. A restart empties it, and that is safe by construction: the guard only ever
 * *refuses* on evidence, so an empty guard permits the next call, and that call's response
 * re-establishes the budget before a second one is made. The failure mode of forgetting is
 * therefore one extra request, not an outage — which is why it is not in the database, where
 * a value this volatile would be a row written on every poll.
 *
 * It also means the guard is per **process**. Two replicas each keep their own view and each
 * reserves the floor, so a two-replica deployment stops at roughly twice it. That is
 * deliberately not solved here: the alternative is shared state on the hot path of every
 * outbound call, and over-reserving a few dozen requests of five thousand is the cheaper
 * error. If it ever needs to be exact, the place for it is a lease
 * (AD.3, [#224](https://github.com/NobuData/ouroboros/issues/224)) rather than this file.
 *
 * ---------------------------------------------------------------------------
 * **Two different limits, and both end up here.**
 *
 *   * The **primary** limit is the hourly budget, reported by `x-ratelimit-remaining` and
 *     reset wholesale at `x-ratelimit-reset`. {@link RATE_LIMIT_FLOOR} is about this one.
 *   * A **secondary** limit is GitHub refusing a burst it considers abusive. It arrives as a
 *     `403` or `429` carrying `retry-after` **in seconds**, and it can happen with thousands
 *     of requests remaining. {@link GithubRateLimiter.pause} is what records one, because a
 *     guard that only watched `remaining` would answer *"plenty left"* while every call was
 *     being refused.
 */

import { Injectable } from "@nestjs/common";

import { GITHUB_FAILURES, GithubApiError } from "./github.errors";

/**
 * How many requests of the token's budget are kept back for whoever is actually waiting.
 *
 * Fifty of an authenticated token's five thousand an hour — one percent. Enough for an
 * administrator to open the intake page, page through a backlog and save a change while the
 * poller is standing down, and small enough that reserving it costs the sync nothing it
 * would have used well. It is a constant rather than a setting: a deployment that needs to
 * tune this has a different problem (a token shared with something else), and the fix for
 * that is a second token rather than a smaller reserve.
 */
export const RATE_LIMIT_FLOOR = 50;

/** GitHub's header for how many requests of the window are left. */
export const REMAINING_HEADER = "x-ratelimit-remaining";

/** GitHub's header for the window's size. */
export const LIMIT_HEADER = "x-ratelimit-limit";

/** GitHub's header for when the window resets, as **seconds** since the epoch. */
export const RESET_HEADER = "x-ratelimit-reset";

/** The header a secondary limit carries, in seconds. */
export const RETRY_AFTER_HEADER = "retry-after";

/** How long a secondary limit stands the guard down when GitHub named no `retry-after`. */
export const DEFAULT_RETRY_AFTER_SECONDS = 60;

/** Milliseconds in a second — the unit `x-ratelimit-reset` and `retry-after` are counted in. */
const MILLISECONDS = 1000;

/** What one response said about the token's budget. */
export interface RateLimitSnapshot {
  /** Requests left in the window, as of {@link observedAt}. */
  readonly remaining: number;
  /** The window's size. Informational — nothing branches on it. */
  readonly limit: number;
  /** When the window resets and {@link remaining} returns to {@link limit}. */
  readonly resetAt: Date;
  /** When this was read off a response. */
  readonly observedAt: Date;
  /**
   * Until when GitHub has asked for silence, from a secondary limit's `retry-after`.
   *
   * Absent in the ordinary case. Distinct from {@link resetAt}, which is about the hourly
   * budget: a secondary limit expires on its own schedule and usually much sooner.
   */
  readonly pausedUntil?: Date;
}

/**
 * Headers as this module reads them — the one method every HTTP client agrees on.
 *
 * A bare accessor rather than `Headers` or a record, so the guard can be fed from Octokit's
 * plain object, from a `fetch` `Headers`, and from a test's literal without any of them
 * having to become another.
 */
export type HeaderReader = (name: string) => string | null | undefined;

/**
 * Read a header as a number.
 *
 * @param headers - Where to look.
 * @param name - The header.
 * @returns The value, or `undefined` when it is absent or not a whole number. Absence is
 *   ordinary: GitHub omits these on some routes, and a guard that treated a missing header
 *   as zero would stand the poller down permanently the first time it met one.
 */
function readNumber(headers: HeaderReader, name: string): number | undefined {
  const raw = headers(name);

  if (raw === null || raw === undefined || !/^\d+$/.test(raw.trim())) {
    return undefined;
  }

  return Number(raw.trim());
}

@Injectable()
export class GithubRateLimiter {
  /**
   * The last thing each workspace's token said about its budget.
   *
   * Keyed by workspace because the limit is per token and there is one token per workspace
   * (decision **K1**). See this file's header on why a `Map` is the right amount of memory
   * for this.
   */
  private readonly seen = new Map<string, RateLimitSnapshot>();

  /**
   * Record what a response said about the budget.
   *
   * Called for **every** response, including failures: a `404` carries the headers too, and
   * the requests it spent are as gone as a `200`'s.
   *
   * @param organizationId - The workspace whose token was used.
   * @param headers - The response's headers.
   * @param now - The clock, injectable so a test does not have to wait an hour.
   */
  observe(organizationId: string, headers: HeaderReader, now: Date = new Date()): void {
    const remaining = readNumber(headers, REMAINING_HEADER);
    const reset = readNumber(headers, RESET_HEADER);

    if (remaining === undefined || reset === undefined) {
      // Nothing to learn. The previous snapshot stands rather than being cleared: a route
      // that omits the headers has not refilled the budget.
      return;
    }

    const previous = this.seen.get(organizationId);

    this.seen.set(organizationId, {
      remaining,
      limit: readNumber(headers, LIMIT_HEADER) ?? remaining,
      resetAt: new Date(reset * MILLISECONDS),
      observedAt: now,
      // A secondary limit outlives the response that reported it, so a later ordinary
      // response must not quietly clear it. It expires by time in `guard`, not by being
      // overwritten here.
      pausedUntil: previous?.pausedUntil,
    });
  }

  /**
   * Record a secondary limit — GitHub asking for silence for a while.
   *
   * @param organizationId - The workspace whose token was used.
   * @param headers - The refusal's headers, read for `retry-after`.
   * @param now - The clock.
   * @returns How many seconds the pause is for, so the caller can put it in the failure it
   *   is about to throw.
   */
  pause(organizationId: string, headers: HeaderReader, now: Date = new Date()): number {
    const seconds = readNumber(headers, RETRY_AFTER_HEADER) ?? DEFAULT_RETRY_AFTER_SECONDS;
    const pausedUntil = new Date(now.getTime() + seconds * MILLISECONDS);
    const previous = this.seen.get(organizationId);

    this.seen.set(organizationId, {
      remaining: previous?.remaining ?? 0,
      limit: previous?.limit ?? 0,
      // A refusal is not evidence about the hourly window, so the previous reset stands.
      // Where there is none, the pause's own end is the honest answer to *when does this
      // stop*, and it is what the card counts down to.
      resetAt: previous?.resetAt ?? pausedUntil,
      observedAt: now,
      pausedUntil,
    });

    return seconds;
  }

  /**
   * What is known about a workspace's budget.
   *
   * @param organizationId - The workspace.
   * @returns The last snapshot, or `undefined` if this process has not called GitHub for
   *   that workspace yet.
   */
  snapshot(organizationId: string): RateLimitSnapshot | undefined {
    return this.seen.get(organizationId);
  }

  /**
   * Forget a workspace's budget.
   *
   * Called when its token is replaced or removed: the numbers described the **old** token's
   * window, and a new token arrives with a full one. Keeping the old view would stand a
   * freshly rotated token down for up to an hour — which is exactly the *"rotate → the old
   * token is never used again"* criterion seen from the guard's side.
   *
   * @param organizationId - The workspace.
   */
  forget(organizationId: string): void {
    this.seen.delete(organizationId);
  }

  /**
   * How many seconds until this workspace may call GitHub again, if it may not now.
   *
   * The whole of the policy, in one place and side-effect free, so that
   * {@link assertMayCall} and anything reporting a paused state cannot disagree about what
   * paused means.
   *
   * @param organizationId - The workspace.
   * @param now - The clock.
   * @returns Seconds to wait, rounded up, or `undefined` when the call may proceed.
   */
  retryAfterSeconds(organizationId: string, now: Date = new Date()): number | undefined {
    const snapshot = this.seen.get(organizationId);

    if (snapshot === undefined) {
      // No evidence, so no refusal. See this file's header: the guard refuses only on
      // evidence, which is what makes losing the cache cost one request rather than an
      // outage.
      return undefined;
    }

    if (snapshot.pausedUntil !== undefined && snapshot.pausedUntil > now) {
      return secondsBetween(now, snapshot.pausedUntil);
    }

    if (snapshot.remaining > RATE_LIMIT_FLOOR || snapshot.resetAt <= now) {
      // Either there is budget, or the window has turned over since this was read — in which
      // case `remaining` describes a window that no longer exists.
      return undefined;
    }

    return secondsBetween(now, snapshot.resetAt);
  }

  /**
   * Refuse the call if the budget is spent.
   *
   * The `before` in *"back off before exhaustion"*: this runs ahead of the request, so the
   * request that would have been refused is never sent, and the reserve stays a reserve.
   *
   * @param organizationId - The workspace.
   * @param now - The clock.
   * @throws {GithubApiError} `rate_limited`, carrying how long to wait.
   */
  assertMayCall(organizationId: string, now: Date = new Date()): void {
    const wait = this.retryAfterSeconds(organizationId, now);

    if (wait === undefined) {
      return;
    }

    const snapshot = this.seen.get(organizationId);

    throw new GithubApiError(
      GITHUB_FAILURES.rateLimited,
      // For the log. Names the workspace and the numbers, never the token.
      `workspace ${organizationId} is at ${String(snapshot?.remaining ?? 0)} remaining ` +
        `(floor ${String(RATE_LIMIT_FLOOR)}); waiting ${String(wait)}s`,
      wait,
    );
  }
}

/**
 * Whole seconds from `from` to `until`, rounded up and never below one.
 *
 * Rounded **up** because a countdown that rounds down tells a caller to retry a moment
 * before the limit lifts, which spends a request to be refused again. Never zero, because
 * zero reads as *"go ahead"* and this function is only called when the answer is *"wait"*.
 *
 * @param from - Now.
 * @param until - When the wait ends.
 * @returns Seconds to wait.
 */
function secondsBetween(from: Date, until: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - from.getTime()) / MILLISECONDS));
}
