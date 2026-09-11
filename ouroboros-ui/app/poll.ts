/**
 * The polling loop — one request per interval, for whatever a screen keeps fresh
 * ([#87](https://github.com/NobuData/ouroboros/issues/87), made generic by
 * [#117](https://github.com/NobuData/ouroboros/issues/117)).
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
 * | A workspace switch refetches immediately | {@link Poll.refresh}, published by `app/dashboard/summary-refresh.ts` |
 *
 * **Framework-free**, the way `app/shell/nav-registry.ts` is: no React and no `next/*`, so
 * the loop can be exercised against mocked timers with nothing rendered.
 * `app/dashboard/summary-store.tsx` and `app/issues/use-backlog-poll.ts` are where it meets
 * React.
 *
 * ### Why it is generic
 *
 * It was the dashboard's loop until the backlog table
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)) needed the same thing over a
 * different payload — *"`estimating…` must actually become `sized` when the pipeline finishes,
 * not on a timer"* — and the interesting code is the loop, not the payload: the sequence check
 * that stops an overtaken answer from being raced into the store, the visibility rule, the
 * backoff. Two copies of that would be two places for the same subtle bug. So the loop knows
 * nothing about what it polls: a reader answers with a {@link PollAnswer}, and the loop turns
 * the answers into a {@link PollSnapshot}. `app/dashboard/summary-poll.ts` and
 * `app/issues/backlog-poll.ts` are one reader each.
 *
 * ### One loop, not one per consumer
 *
 * *Exactly one request per interval regardless of how many components consume the store* is
 * a property of **where a poll is constructed**, not of anything defended in here. The
 * dashboard's is built by the provider at the `(app)` layout and every consumer subscribes to
 * it; the backlog's is built once per table, keyed on the address it asks for.
 *
 * ### Nothing overlaps
 *
 * A request in flight is never joined by a second one. A {@link Poll.refresh} during one
 * supersedes it: the newer request's answer is the one applied, and the older is dropped on
 * arrival by the sequence check rather than raced into the snapshot. That is what stops a
 * workspace switch from being overwritten, half a second later, by the answer to the ask that
 * was already in the air when it happened.
 */

/** The header the tag comes back in. */
export const ETAG_HEADER = "ETag";

/** The header the tag goes back out in, on the next ask. */
export const IF_NONE_MATCH_HEADER = "If-None-Match";

/**
 * The header carrying how long the server currently wants a client to wait
 * ([#75](https://github.com/NobuData/ouroboros/issues/75)).
 *
 * On every answer, `200` and `304` alike — a backed-off server answers mostly `304`s, so
 * the cheap answer has to carry the cadence or a slowed client would never hear it change.
 */
export const POLL_AFTER_HEADER = "X-Ouro-Poll-After";

/**
 * What the contract documents as the interval, in seconds.
 *
 * Used only until the first answer is heard: every answer may carry the server's own value,
 * and {@link readPollAfter} is what replaces this with it. `OURO_DASHBOARD_POLL_SECONDS` is
 * the same number on the other side, and this copy exists because a client with no answer
 * yet still has to pick something.
 */
export const DEFAULT_POLL_SECONDS = 15;

/** The shortest interval the contract allows the server to ask for. */
export const MIN_POLL_SECONDS = 1;

/**
 * The longest — an hour, which is already "never refreshes"; above it the knob would be an
 * off switch wearing a number. The same bounds `ouroboros-rest` validates its own variable
 * against, so a hint this client refuses is a hint the server could not have sent.
 */
export const MAX_POLL_SECONDS = 3600;

/**
 * One answer to one conditional read.
 *
 * Produced twice — once by the server reading `ouroboros-rest`, once by the browser reading
 * this origin — and the route handler in between is what turns the first into HTTP and the
 * second back out of it. Both ends therefore branch on the same four cases, and a case added
 * to the contract is a compile error at both.
 *
 * @typeParam T What a `200` carries.
 */
export type PollAnswer<T> =
  /** `200` — the payload changed, or this is the first ask. */
  | {
      readonly state: "fresh";
      readonly payload: T;
      readonly etag: string | null;
      readonly pollAfterSeconds: number | null;
    }
  /** `304` — nothing has moved, and the client already holds the payload. */
  | {
      readonly state: "unchanged";
      readonly etag: string | null;
      readonly pollAfterSeconds: number | null;
    }
  /**
   * `401` — the session ended. Distinct from a failure because it does not mend itself:
   * asking again on the interval would be a request per interval that cannot succeed.
   */
  | { readonly state: "gone" }
  /**
   * Anything else — the service refused, or nothing answered at all. Carries a sentence
   * written for a person, because that is what a banner or a card's reason line renders.
   */
  | {
      readonly state: "failed";
      readonly reason: string;
      readonly pollAfterSeconds: number | null;
    };

/**
 * What every consumer of a poll reads.
 *
 * Three fields and no fourth: *still asking* is `data === null` with no `error`, and *stale*
 * is `updatedAt` older than the reader cares for — both are questions this shape already
 * answers, and a flag for either would be a second representation of a state that can then
 * disagree with the first.
 *
 * @typeParam T What the poll reads.
 */
export interface PollSnapshot<T> {
  /**
   * The last payload read, or `null` before the first answer arrives.
   *
   * **It survives a failure.** A poll that could not reach the service leaves the last good
   * payload in place and sets {@link error} beside it, because what a reader is looking at
   * was true a moment ago and blanking it would replace a slightly old truth with no truth
   * at all — which is [#86](https://github.com/NobuData/ouroboros/issues/86)'s *stale since
   * 14:02* banner over the data it is stale about.
   */
  readonly data: T | null;

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
 * What is said when the session ended underneath a poll.
 *
 * The screen itself is still the reader's to be on — the pills simply stop claiming
 * anything — and the next render of any `(app)` screen goes through `requireWorkspace()`,
 * which is what actually sends them to the login page. Saying it here rather than
 * navigating from a timer is the difference between *the product told me* and *the product
 * moved while I was reading it*.
 */
export const SESSION_ENDED = "This session is no longer signed in.";

/**
 * Nothing read yet: what the server renders, and what the browser holds until it asks.
 *
 * One frozen object for every payload type — `never` is assignable to any `T | null` — so a
 * `useSyncExternalStore` server snapshot is identity-stable however many polls share it.
 */
export const EMPTY_POLL_SNAPSHOT: PollSnapshot<never> = Object.freeze({
  data: null,
  updatedAt: null,
  error: null,
});

/**
 * One conditional read, as the loop needs it.
 *
 * @typeParam T What a `200` carries.
 */
export type PollReader<T> = (etag: string | null) => Promise<PollAnswer<T>>;

/**
 * The loop, as its consumers see it.
 *
 * @typeParam T What the poll reads.
 */
export interface Poll<T> {
  /**
   * The state as it stands.
   *
   * @returns A frozen snapshot whose identity is **stable until something changes**, which
   *   is what `useSyncExternalStore` requires of it.
   */
  snapshot(): PollSnapshot<T>;

  /**
   * Hear about changes.
   *
   * @param listener Called after each change, with no argument — the listener re-reads
   *   {@link Poll.snapshot}.
   * @returns The way to stop listening.
   */
  subscribe(listener: () => void): () => void;

  /**
   * Ask now, whatever the timer was going to do.
   *
   * For the moments the contract names — a workspace switch, a write whose result the poll
   * reads — and for the tab becoming visible again, which this module wires itself.
   *
   * @returns Nothing. A refresh while hidden is deliberately a no-op with one exception:
   *   see {@link createPoll}'s note on why the visibility listener asks rather than merely
   *   rescheduling.
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
export interface PollOptions {
  /**
   * Whether the reader is looking. Defaults to the document's own answer, which is what
   * `visibilitychange` fires about.
   */
  visible?: () => boolean;
  /** The clock behind {@link PollSnapshot.updatedAt}. Defaults to `Date.now`. */
  now?: () => number;
}

/** What a browser-side reader says about the two ways an answer can fail to be one. */
export interface PayloadSentences {
  /** What is said when nothing answered at all — a dropped connection, a timeout. */
  readonly unreachable: string;
  /** What is said when something answered and it could not be read as the payload. */
  readonly unreadable: string;
}

/**
 * Read one payload from **this origin**, in the browser.
 *
 * The service itself is not reachable from here — `OURO_REST_URL` carries no `NEXT_PUBLIC_`
 * prefix and the session cookie is `HttpOnly` — so every poll asks a route handler on this
 * origin, which forwards the exchange (`app/api/dashboard/route.ts`,
 * `app/api/backlog/route.ts`).
 *
 * **This does not throw.** Every outcome is one of the contract's four answers, because the
 * caller is a loop on a timer: a rejection would have to be caught somewhere to keep the
 * timer running, and the place that catches it would have to invent the sentence this
 * already carries.
 *
 * @param url Where to ask, on this origin.
 * @param etag The tag the caller holds, echoed as `If-None-Match`, or `null` to ask
 *   unconditionally.
 * @param accept Whether a parsed body is the payload — the boundary between *the
 *   contract's type* and *whatever answered on that URL*, since a proxy or a captive portal
 *   can each reply `200` with something else.
 * @param sentences What to say when the answer is not one.
 * @returns The answer.
 * @typeParam T What a `200` carries.
 */
export async function requestPayload<T>(
  url: string,
  etag: string | null,
  accept: (value: unknown) => value is T,
  sentences: PayloadSentences,
): Promise<PollAnswer<T>> {
  let response: Response;

  try {
    response = await fetch(url, {
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
    return { state: "failed", reason: sentences.unreachable, pollAfterSeconds: null };
  }

  const etagBack = response.headers.get(ETAG_HEADER);
  const pollAfterSeconds = readPollAfter(response.headers);

  if (response.status === 304) return { state: "unchanged", etag: etagBack, pollAfterSeconds };
  if (response.status === 401) return { state: "gone" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { state: "failed", reason: sentences.unreadable, pollAfterSeconds };
  }

  if (!response.ok) {
    return { state: "failed", reason: failureSentence(body, sentences), pollAfterSeconds };
  }

  return accept(body)
    ? { state: "fresh", payload: body, etag: etagBack, pollAfterSeconds }
    : { state: "failed", reason: sentences.unreadable, pollAfterSeconds };
}

/**
 * The sentence out of a failure body.
 *
 * @param body Whatever the failure carried.
 * @param sentences The reader's own sentences.
 * @returns Its `message` when it has one — the route handler forwards the service's, and
 *   every message in that envelope is written for a person — or this client's own when the
 *   body is something else entirely.
 */
function failureSentence(body: unknown, sentences: PayloadSentences): string {
  if (typeof body === "object" && body !== null) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
  }

  return sentences.unreadable;
}

/**
 * Read the server's cadence hint off an answer.
 *
 * **Whole seconds only, and inside the bounds the contract states.** A hint this client
 * cannot use is treated as no hint rather than as an error: the header is advice, the
 * default interval is still a working one, and a client that stopped polling over a
 * malformed header would be a page that froze because a proxy rewrote a number.
 *
 * @param headers The answer's headers.
 * @returns The interval the server asked for, in seconds, or `null` when it asked for
 *   nothing usable.
 */
export function readPollAfter(headers: Headers): number | null {
  const raw = headers.get(POLL_AFTER_HEADER);
  if (raw === null) return null;

  const seconds = Number(raw.trim());

  if (!Number.isInteger(seconds)) return null;
  if (seconds < MIN_POLL_SECONDS || seconds > MAX_POLL_SECONDS) return null;

  return seconds;
}

/**
 * Build a loop over one reader.
 *
 * ### Why the visibility listener *asks* rather than rescheduling
 *
 * A tab that has been hidden for ten minutes holds a ten-minute-old payload, and the reader
 * who just came back is looking at it. Rescheduling would show them that payload for up to
 * another interval; asking replaces it in one round trip. The contract says so in as many
 * words — *refreshes immediately when it becomes visible again* — and it is also what makes
 * the hidden case free rather than merely cheap: nothing is queued while away, so the cost
 * of a background tab is exactly nothing.
 *
 * @param read How to make one read.
 * @param options Test seams; production passes none.
 * @returns The poll. It is inert until {@link Poll.start} is called.
 * @typeParam T What the reader answers with.
 */
export function createPoll<T>(read: PollReader<T>, options: PollOptions = {}): Poll<T> {
  const visible = options.visible ?? (() => document.visibilityState !== "hidden");
  const now = options.now ?? (() => Date.now());

  /** The tag the client holds, echoed on the next ask. */
  let etag: string | null = null;

  /** The effective interval, in milliseconds — the latest hint heard, or the default. */
  let intervalMs = DEFAULT_POLL_SECONDS * 1000;

  /** The state, replaced only when something actually changes. */
  let snapshot: PollSnapshot<T> = EMPTY_POLL_SNAPSHOT;

  /** Everyone waiting to hear that it moved. */
  const listeners = new Set<() => void>();

  /** The scheduled next ask, or `null` when nothing is scheduled — hidden, or in flight. */
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** Which ask is the current one. An answer from an earlier number is dropped. */
  let sequence = 0;

  /** Whether {@link Poll.start} has been called and not yet undone. */
  let running = false;

  /**
   * Replace the snapshot and tell everyone.
   *
   * @param next The new state.
   * @returns Nothing.
   */
  function publish(next: PollSnapshot<T>): void {
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
  function apply(answer: PollAnswer<T>): boolean {
    switch (answer.state) {
      case "fresh":
        etag = answer.etag;
        heed(answer.pollAfterSeconds);
        publish({ data: answer.payload, updatedAt: now(), error: null });
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
