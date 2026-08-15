/**
 * The polling loop — one request per interval, however many components are reading
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)).
 *
 * `docs/ARCHITECTURE.md` § 5.4 is the contract and this is the client's half of it:
 *
 * | The contract says | What this does |
 * |---|---|
 * | A visible tab polls every 15 seconds | {@link DEFAULT_POLL_SECONDS} until an answer says otherwise |
 * | A hidden tab polls **not at all** | `visibilitychange` clears the timer; nothing is scheduled while hidden |
 * | …and refreshes immediately on return | the same listener asks at once when the tab comes back |
 * | Every answer carries `X-Ouro-Poll-After` | the latest value heard becomes the interval |
 * | The client echoes the tag in `If-None-Match` | held here, sent on the next ask, replaced by each answer |
 * | A workspace switch refetches immediately | {@link SummaryPoll.refresh}, published by `app/dashboard/summary-refresh.ts` |
 *
 * **Framework-free**, the way `app/shell/nav-registry.ts` is: no React and no `next/*`, so
 * the loop can be exercised against mocked timers with nothing rendered.
 * `app/dashboard/summary-store.tsx` is the four lines where it meets React.
 *
 * ### One loop, not one per consumer
 *
 * The acceptance criterion — *exactly one request per interval regardless of how many
 * components consume the store* — is a property of **where this is constructed**, not of
 * anything defended in here. One poll is built by the provider at the `(app)` layout and
 * every consumer subscribes to it, so the pills and the cards cannot disagree on one screen
 * about how many loops are live, because there is one answer and they are both reading it.
 *
 * ### Nothing overlaps
 *
 * A request in flight is never joined by a second one. A {@link SummaryPoll.refresh} during
 * one supersedes it: the newer request's answer is the one applied, and the older is
 * dropped on arrival by the sequence check rather than raced into the snapshot. That is
 * what stops a workspace switch from being overwritten, half a second later, by the answer
 * to the ask that was already in the air when it happened.
 */

import {
  DEFAULT_POLL_SECONDS,
  type DashboardSummary,
  ETAG_HEADER,
  IF_NONE_MATCH_HEADER,
  MAX_POLL_SECONDS,
  MIN_POLL_SECONDS,
  SUMMARY_ENDPOINT,
  type SummaryAnswer,
  UNREACHABLE_SUMMARY,
  UNREADABLE_SUMMARY,
  isDashboardSummary,
  readPollAfter,
} from "./summary";

/**
 * What every consumer of the poll reads.
 *
 * The three fields the issue names, and no fourth: *still asking* is `data === null` with
 * no `error`, and *stale* is `updatedAt` older than the reader cares for — both are
 * questions this shape already answers, and a flag for either would be a second
 * representation of a state that can then disagree with the first.
 */
export interface SummarySnapshot {
  /**
   * The last payload read, or `null` before the first answer arrives.
   *
   * **It survives a failure.** A poll that could not reach the service leaves the last good
   * dashboard in place and sets {@link error} beside it, because the numbers a reader is
   * looking at were true a moment ago and blanking them would replace a slightly old truth
   * with no truth at all — which is [#86](https://github.com/NobuData/ouroboros/issues/86)'s
   * *stale since 14:02* banner over the data it is stale about.
   */
  readonly data: DashboardSummary | null;

  /**
   * When {@link data} was last **confirmed current**, in epoch milliseconds, or `null`
   * before the first answer.
   *
   * A `304` moves it as surely as a `200` does: *nothing has changed* is a fresh statement
   * about the payload the client already holds, and a freshness clock that only moved on
   * changes would report a quiet workspace as a broken one.
   */
  readonly updatedAt: number | null;

  /**
   * Why the last attempt failed, as a sentence for a person, or `null` when it succeeded.
   *
   * Cleared by the next success, so it always describes the *current* state rather than the
   * worst thing that has ever happened to this page.
   */
  readonly error: string | null;
}

/**
 * What is said when the session ended underneath the poll.
 *
 * The screen itself is still the reader's to be on — the pills simply stop claiming
 * anything — and the next render of any `(app)` screen goes through `requireWorkspace()`,
 * which is what actually sends them to the login page. Saying it here rather than
 * navigating from a timer is the difference between *the product told me* and *the product
 * moved while I was reading it*.
 */
export const SESSION_ENDED = "This session is no longer signed in.";

/** Nothing read yet: what the server renders, and what the browser holds until it asks. */
export const EMPTY_SNAPSHOT: SummarySnapshot = Object.freeze({
  data: null,
  updatedAt: null,
  error: null,
});

/** One conditional read, as the loop needs it. Replaced wholesale in tests. */
export type SummaryReader = (etag: string | null) => Promise<SummaryAnswer>;

/** The loop, as its consumers see it. */
export interface SummaryPoll {
  /**
   * The state as it stands.
   *
   * @returns A frozen snapshot whose identity is **stable until something changes**, which
   *   is what `useSyncExternalStore` requires of it.
   */
  snapshot(): SummarySnapshot;

  /**
   * Hear about changes.
   *
   * @param listener Called after each change, with no argument — the listener re-reads
   *   {@link SummaryPoll.snapshot}.
   * @returns The way to stop listening.
   */
  subscribe(listener: () => void): () => void;

  /**
   * Ask now, whatever the timer was going to do.
   *
   * For the two moments the contract names — a workspace switch and the auto-merge write —
   * and for the tab becoming visible again, which this module wires itself.
   *
   * @returns Nothing. A refresh while hidden is deliberately a no-op with one exception:
   *   see {@link createSummaryPoll}'s note on why the visibility listener asks rather than
   *   merely rescheduling.
   */
  refresh(): void;

  /**
   * Begin polling, and listen for the tab being hidden and shown.
   *
   * Called from an effect, never at module scope: it touches `document`, and it starts a
   * request that a server render has no business making.
   *
   * @returns The way to stop — clears the timer, drops the listener, and makes any answer
   *   still in the air arrive to nobody.
   */
  start(): () => void;
}

/** How to build a poll. Everything is optional; production supplies none of it. */
export interface SummaryPollOptions {
  /** How to make one read. Defaults to {@link requestSummary}. */
  read?: SummaryReader;
  /**
   * Whether the reader is looking. Defaults to the document's own answer, which is what
   * `visibilitychange` fires about.
   */
  visible?: () => boolean;
  /** The clock behind {@link SummarySnapshot.updatedAt}. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Read the summary once, from the browser.
 *
 * The request goes to {@link SUMMARY_ENDPOINT} on this origin — see `app/api/dashboard/route.ts`
 * for why the service itself is not reachable from here.
 *
 * **This does not throw.** Every outcome is one of the contract's four answers, because the
 * caller is a loop on a timer: a rejection would have to be caught somewhere to keep the
 * timer running, and the place that catches it would have to invent the sentence this
 * already carries.
 *
 * @param etag The tag the caller holds, echoed as `If-None-Match`, or `null` to ask
 *   unconditionally.
 * @returns The answer.
 */
export async function requestSummary(etag: string | null): Promise<SummaryAnswer> {
  let response: Response;

  try {
    response = await fetch(SUMMARY_ENDPOINT, {
      headers: {
        Accept: "application/json",
        ...(etag !== null && etag !== "" ? { [IF_NONE_MATCH_HEADER]: etag } : {}),
      },
      // The tag above *is* the revalidation, so the browser's own cache must stay out of
      // it — with a stored entry of its own it could answer this from cache, or turn the
      // `304` into a `200` from that entry, and either way the poll would stop hearing the
      // freshness it is asking about.
      cache: "no-store",
      // The cookies are `HttpOnly` and same-origin; this is the default, and it is written
      // out because the whole exchange depends on them travelling.
      credentials: "same-origin",
    });
  } catch {
    return { state: "failed", reason: UNREACHABLE_SUMMARY, pollAfterSeconds: null };
  }

  const etagBack = response.headers.get(ETAG_HEADER);
  const pollAfterSeconds = readPollAfter(response.headers);

  if (response.status === 304) return { state: "unchanged", etag: etagBack, pollAfterSeconds };
  if (response.status === 401) return { state: "gone" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { state: "failed", reason: UNREADABLE_SUMMARY, pollAfterSeconds };
  }

  if (!response.ok) {
    return { state: "failed", reason: failureSentence(body), pollAfterSeconds };
  }

  return isDashboardSummary(body)
    ? { state: "fresh", summary: body, etag: etagBack, pollAfterSeconds }
    : { state: "failed", reason: UNREADABLE_SUMMARY, pollAfterSeconds };
}

/**
 * The sentence out of a failure body.
 *
 * @param body Whatever the failure carried.
 * @returns Its `message` when it has one — the route handler forwards the service's, and
 *   every message in that envelope is written for a person — or this client's own when the
 *   body is something else entirely.
 */
function failureSentence(body: unknown): string {
  if (typeof body === "object" && body !== null) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
  }

  return UNREADABLE_SUMMARY;
}

/**
 * Build the loop.
 *
 * ### Why the visibility listener *asks* rather than rescheduling
 *
 * A tab that has been hidden for ten minutes holds a ten-minute-old dashboard, and the
 * reader who just came back is looking at it. Rescheduling would show them that payload for
 * up to another interval; asking replaces it in one round trip. The contract says so in as
 * many words — *refreshes immediately when it becomes visible again* — and it is also what
 * makes the hidden case free rather than merely cheap: nothing is queued while away, so the
 * cost of a background tab is exactly nothing.
 *
 * @param options Test seams; production passes none.
 * @returns The poll. It is inert until {@link SummaryPoll.start} is called.
 */
export function createSummaryPoll(options: SummaryPollOptions = {}): SummaryPoll {
  const read = options.read ?? requestSummary;
  const visible = options.visible ?? (() => document.visibilityState !== "hidden");
  const now = options.now ?? (() => Date.now());

  /** The tag the client holds, echoed on the next ask. */
  let etag: string | null = null;

  /** The effective interval, in milliseconds — the latest hint heard, or the default. */
  let intervalMs = DEFAULT_POLL_SECONDS * 1000;

  /** The state, replaced only when something actually changes. */
  let snapshot: SummarySnapshot = EMPTY_SNAPSHOT;

  /** Everyone waiting to hear that it moved. */
  const listeners = new Set<() => void>();

  /** The scheduled next ask, or `null` when nothing is scheduled — hidden, or in flight. */
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** Which ask is the current one. An answer from an earlier number is dropped. */
  let sequence = 0;

  /** Whether {@link SummaryPoll.start} has been called and not yet undone. */
  let running = false;

  /**
   * Replace the snapshot and tell everyone.
   *
   * @param next The new state.
   * @returns Nothing.
   */
  function publish(next: SummarySnapshot): void {
    snapshot = Object.freeze(next);
    for (const listener of [...listeners]) listener();
  }

  /** Stop whatever was scheduled. @returns Nothing. */
  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** Schedule the next ask, unless the tab has gone away. @returns Nothing. */
  function schedule(): void {
    clearTimer();
    if (!running || !visible()) return;

    timer = setTimeout(() => {
      timer = null;
      void ask();
    }, intervalMs);
  }

  /**
   * Take the cadence hint out of an answer.
   *
   * @param seconds What the answer asked for, or `null` when it asked for nothing usable.
   * @returns Nothing. An absent hint leaves the interval where it was rather than resetting
   *   it to the default: the server's last stated opinion is still its opinion, and a single
   *   answer that lost the header on the way through a proxy must not undo a backoff.
   */
  function heed(seconds: number | null): void {
    if (seconds === null) return;
    if (seconds < MIN_POLL_SECONDS || seconds > MAX_POLL_SECONDS) return;

    intervalMs = seconds * 1000;
  }

  /**
   * Fold one answer into the state.
   *
   * @param answer What came back.
   * @returns Whether the loop should keep asking on the timer. Only *gone* says no — a
   *   session that has ended does not mend itself on the interval, so asking again would be
   *   one request per interval that cannot succeed. It is not permanent: coming back to the
   *   tab, or any explicit refresh, tries once more, which is what makes signing in again in
   *   another tab enough to bring this one back.
   */
  function apply(answer: SummaryAnswer): boolean {
    switch (answer.state) {
      case "fresh":
        etag = answer.etag;
        heed(answer.pollAfterSeconds);
        publish({ data: answer.summary, updatedAt: now(), error: null });
        return true;

      case "unchanged":
        // A `304` may carry the tag again; where it does not, the one already held is still
        // the tag of the payload still held.
        if (answer.etag !== null && answer.etag !== "") etag = answer.etag;
        heed(answer.pollAfterSeconds);
        publish({ data: snapshot.data, updatedAt: now(), error: null });
        return true;

      case "gone":
        // The tag goes with the session. Whatever answers next is answering a different
        // question, and revalidating against a tag from before would be asking it to
        // compare with a workspace this browser may no longer be in.
        etag = null;
        publish({ data: snapshot.data, updatedAt: snapshot.updatedAt, error: SESSION_ENDED });
        return false;

      case "failed":
        heed(answer.pollAfterSeconds);
        // The data and its clock are left exactly as they were: what is on screen was true
        // when `updatedAt` says it was, and that is the fact the banner is built on.
        publish({
          data: snapshot.data,
          updatedAt: snapshot.updatedAt,
          error: answer.reason,
        });
        return true;
    }
  }

  /**
   * Make one ask, and schedule the next.
   *
   * @returns When the answer has been applied, or immediately when there was no ask to make.
   */
  async function ask(): Promise<void> {
    if (!running || !visible()) return;

    const mine = (sequence += 1);
    clearTimer();

    const answer = await read(etag);

    // Superseded — a refresh, or a stop, happened while this was in the air. Its answer is
    // about a moment that has been overtaken, and the ask that overtook it owns the
    // scheduling as well as the state.
    if (!running || mine !== sequence) return;

    if (apply(answer)) schedule();
  }

  /** Hidden or shown. @returns Nothing. */
  function onVisibility(): void {
    if (visible()) {
      void ask();
    } else {
      clearTimer();
    }
  }

  return {
    snapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    refresh() {
      if (!running) return;
      void ask();
    },

    start() {
      running = true;
      document.addEventListener("visibilitychange", onVisibility);
      void ask();

      return () => {
        running = false;
        // Bumped so that an answer already in the air arrives to nobody: a poll torn down
        // mid-request must not publish into a store its provider has finished with.
        sequence += 1;
        clearTimer();
        document.removeEventListener("visibilitychange", onVisibility);
      };
    },
  };
}
