import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_POLL_SECONDS,
  type SummaryAnswer,
  UNREACHABLE_SUMMARY,
  UNREADABLE_SUMMARY,
} from "@/app/dashboard/summary";
import {
  EMPTY_SNAPSHOT,
  SESSION_ENDED,
  createSummaryPoll,
  requestSummary,
} from "@/app/dashboard/summary-poll";

import { summary } from "../helpers/dashboard";

/**
 * The polling loop, against mocked timers
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)).
 *
 * Every acceptance criterion of the issue is a case here except the one that is a property
 * of *where the poll is built* — one request per interval however many components read it —
 * which is `summary-store.test.tsx`'s, because it is the provider that makes it true.
 *
 * The loop is framework-free precisely so this suite can exist: no rendering, no DOM beyond
 * the `visibilitychange` event it listens for, and a stubbed reader in place of the network.
 */

const TAG = '"v1-abc"';
const NEXT_TAG = '"v2-def"';

/** Where the fake clock starts, so `updatedAt` assertions are exact. */
const START = Date.UTC(2026, 7, 14, 12, 0, 0);

/** The default interval in milliseconds, as the contract states it. */
const INTERVAL = DEFAULT_POLL_SECONDS * 1000;

/**
 * A reader answering from a queue, recording the tag each ask carried.
 *
 * @param answers What to answer, in order. The last one is repeated once the queue runs dry,
 *   which is what makes a case about the *interval* not also a case about running out of
 *   fixtures.
 * @returns The reader, and the tags it was asked with.
 */
function reader(...answers: SummaryAnswer[]) {
  const asks: (string | null)[] = [];
  let index = 0;

  return {
    asks,
    read: (etag: string | null) => {
      asks.push(etag);
      const answer = answers[Math.min(index, answers.length - 1)];
      index += 1;
      return Promise.resolve(answer);
    },
  };
}

/** A `200`, carrying the seeded payload. */
function fresh(etag: string | null = TAG, pollAfterSeconds: number | null = null): SummaryAnswer {
  return { state: "fresh", summary: summary(), etag, pollAfterSeconds };
}

/** Whether the tab is being looked at. Flipped by {@link hide} and {@link show}. */
let visible = true;

/** Hide the tab, as a browser would. @returns Nothing. */
function hide(): void {
  visible = false;
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Show it again. @returns Nothing. */
function show(): void {
  visible = true;
  document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * A started poll, with the fixtures a case needs to drive it.
 *
 * @param answers What the reader answers, in order.
 * @returns The poll, the reader's record, and the way to stop it.
 */
function started(...answers: SummaryAnswer[]) {
  const { asks, read } = reader(...answers);
  const poll = createSummaryPoll({ read, visible: () => visible, now: () => Date.now() });
  const stop = poll.start();

  return { asks, poll, stop };
}

/**
 * Let every pending promise settle without advancing the clock.
 *
 * The loop awaits its reader between asking and scheduling, so a case that advanced timers
 * without draining the microtask queue would be asserting against a loop caught mid-answer.
 *
 * @returns When the queue is empty.
 */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  visible = true;
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the summary poll, before it is started", () => {
  it("has nothing to report and has asked nobody", () => {
    const { asks, read } = reader(fresh());
    const poll = createSummaryPoll({ read, visible: () => visible });

    expect(poll.snapshot()).toEqual(EMPTY_SNAPSHOT);
    expect(asks).toHaveLength(0);
  });

  it("ignores a refresh, so a signal published before mount asks nothing", () => {
    const { asks, read } = reader(fresh());
    const poll = createSummaryPoll({ read, visible: () => visible });

    poll.refresh();

    expect(asks).toHaveLength(0);
  });
});

describe("the summary poll, running", () => {
  it("asks at once rather than waiting out the first interval", async () => {
    const { asks, stop } = started(fresh());
    await settle();

    // A screen that showed nothing for fifteen seconds after arriving would be a screen the
    // poll made worse than no poll at all.
    expect(asks).toEqual([null]);
    stop();
  });

  it("publishes the payload and when it was confirmed", async () => {
    const { poll, stop } = started(fresh());
    await settle();

    expect(poll.snapshot()).toEqual({
      data: summary(),
      updatedAt: START,
      error: null,
    });
    stop();
  });

  it("tells its subscribers, and stops when they leave", async () => {
    let heard = 0;
    const { poll, stop } = started(fresh());
    const unsubscribe = poll.subscribe(() => {
      heard += 1;
    });
    await settle();

    expect(heard).toBe(1);

    unsubscribe();
    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(heard).toBe(1);
    stop();
  });

  it("asks again on the contract's interval, and not before", async () => {
    const { asks, stop } = started(fresh());
    await settle();

    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(asks).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(asks).toHaveLength(2);
    stop();
  });

  it("echoes the tag the last answer carried", async () => {
    const { asks, stop } = started(fresh(TAG));
    await settle();
    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(asks).toEqual([null, TAG]);
    stop();
  });

  it("keeps its data on a 304 and still moves the freshness clock", async () => {
    const { poll, stop } = started(fresh(TAG), {
      state: "unchanged",
      etag: null,
      pollAfterSeconds: null,
    });
    await settle();
    await vi.advanceTimersByTimeAsync(INTERVAL);

    // *Nothing has changed* is a fresh statement about the payload already held. A clock
    // that only moved on changes would report a quiet workspace as a broken one.
    expect(poll.snapshot().data).toEqual(summary());
    expect(poll.snapshot().updatedAt).toBe(START + INTERVAL);
    expect(poll.snapshot().error).toBeNull();
    stop();
  });

  it("takes a new tag from a 304 that reissues one", async () => {
    const { asks, stop } = started(fresh(TAG), {
      state: "unchanged",
      etag: NEXT_TAG,
      pollAfterSeconds: null,
    });
    await settle();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(asks).toEqual([null, TAG, NEXT_TAG]);
    stop();
  });
});

describe("the cadence the server asks for", () => {
  it("becomes the interval, replacing the default", async () => {
    const { asks, stop } = started(fresh(TAG, 60));
    await settle();

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(asks).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(45_000);
    expect(asks).toHaveLength(2);
    stop();
  });

  it("is heard on a 304 as readily as on a 200", async () => {
    // A backed-off server answers mostly 304s, so a client that only read the hint off a
    // payload would never hear the cadence it was being asked for.
    const { asks, stop } = started(fresh(TAG), {
      state: "unchanged",
      etag: TAG,
      pollAfterSeconds: 60,
    });
    await settle();
    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(asks).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(asks).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(asks).toHaveLength(3);
    stop();
  });

  it("survives an answer that lost the header on the way", async () => {
    // One answer through a proxy that stripped it must not undo a backoff the server asked
    // for: its last stated opinion is still its opinion.
    const { asks, stop } = started(fresh(TAG, 60), fresh(TAG, null));
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(asks).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(asks).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(45_000);
    expect(asks).toHaveLength(3);
    stop();
  });

  it("refuses a hint outside the bounds the contract states", async () => {
    const { asks, stop } = started(fresh(TAG, 99_999));
    await settle();
    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(asks).toHaveLength(2);
    stop();
  });
});

describe("a tab nobody is looking at", () => {
  it("issues no requests at all", async () => {
    const { asks, stop } = started(fresh());
    await settle();
    expect(asks).toHaveLength(1);

    hide();
    await vi.advanceTimersByTimeAsync(INTERVAL * 10);

    expect(asks).toHaveLength(1);
    stop();
  });

  it("refreshes the moment it is looked at again", async () => {
    // Not merely rescheduled: a tab hidden for ten minutes holds a ten-minute-old dashboard,
    // and the reader who just came back is looking at it.
    const { asks, stop } = started(fresh());
    await settle();
    hide();
    await vi.advanceTimersByTimeAsync(INTERVAL * 10);

    show();
    await settle();

    expect(asks).toHaveLength(2);
    stop();
  });

  it("goes back to asking on the interval afterwards", async () => {
    const { asks, stop } = started(fresh());
    await settle();
    hide();
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    show();
    await settle();

    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(asks).toHaveLength(3);
    stop();
  });

  it("asks nothing when it is started while already hidden", async () => {
    visible = false;
    const { asks, stop } = started(fresh());
    await settle();

    expect(asks).toHaveLength(0);
    stop();
  });
});

describe("asking again on demand", () => {
  it("asks now rather than waiting out the interval", async () => {
    const { asks, poll, stop } = started(fresh());
    await settle();

    poll.refresh();
    await settle();

    expect(asks).toHaveLength(2);
    stop();
  });

  it("restarts the interval from the answer rather than from the timer it interrupted", async () => {
    const { asks, poll, stop } = started(fresh());
    await settle();

    await vi.advanceTimersByTimeAsync(10_000);
    poll.refresh();
    await settle();
    expect(asks).toHaveLength(2);

    // The 5s that were left of the interrupted interval must not still fire.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(asks).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(asks).toHaveLength(3);
    stop();
  });

  it("drops the answer to an ask it overtook", async () => {
    // The case this protects: a workspace switch, with the previous workspace's answer still
    // in the air. Applied in arrival order it would overwrite the new workspace's numbers.
    const answers: ((answer: SummaryAnswer) => void)[] = [];
    const read = () =>
      new Promise<SummaryAnswer>((resolve) => {
        answers.push(resolve);
      });

    const poll = createSummaryPoll({ read, visible: () => visible });
    const stop = poll.start();

    poll.refresh();

    // The second ask answers first, with the payload that belongs on screen.
    answers[1]?.(fresh(NEXT_TAG));
    await settle();
    expect(poll.snapshot().data).toEqual(summary());

    // The first now answers, out of date. Its tag must not become the one echoed next.
    answers[0]?.({ state: "failed", reason: "stale answer", pollAfterSeconds: null });
    await settle();

    expect(poll.snapshot().error).toBeNull();
    stop();
  });
});

describe("when a poll does not land", () => {
  it("keeps the last good dashboard and says what went wrong", async () => {
    const { poll, stop } = started(fresh(), {
      state: "failed",
      reason: UNREACHABLE_SUMMARY,
      pollAfterSeconds: null,
    });
    await settle();
    await vi.advanceTimersByTimeAsync(INTERVAL);

    // Blanking the numbers would replace a slightly old truth with no truth at all.
    expect(poll.snapshot().data).toEqual(summary());
    expect(poll.snapshot().updatedAt).toBe(START);
    expect(poll.snapshot().error).toBe(UNREACHABLE_SUMMARY);
    stop();
  });

  it("keeps asking, and clears the failure when one lands", async () => {
    const { poll, stop } = started(
      { state: "failed", reason: UNREADABLE_SUMMARY, pollAfterSeconds: null },
      fresh(),
    );
    await settle();
    expect(poll.snapshot().error).toBe(UNREADABLE_SUMMARY);

    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(poll.snapshot().error).toBeNull();
    expect(poll.snapshot().data).toEqual(summary());
    stop();
  });

  it("stops asking once the session has ended", async () => {
    // A session that has ended does not mend itself on the interval, so asking again would
    // be one request per interval that cannot succeed.
    const { asks, poll, stop } = started(fresh(), { state: "gone" });
    await settle();
    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(poll.snapshot().error).toBe(SESSION_ENDED);
    expect(asks).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(INTERVAL * 5);
    expect(asks).toHaveLength(2);
    stop();
  });

  it("tries once more when the reader comes back to the tab", async () => {
    // Which is what makes signing in again in another tab enough to bring this one back.
    const { asks, stop } = started({ state: "gone" }, fresh());
    await settle();
    expect(asks).toHaveLength(1);

    hide();
    show();
    await settle();

    expect(asks).toHaveLength(2);
    stop();
  });

  it("forgets its tag with the session", async () => {
    const { asks, stop } = started(fresh(TAG), { state: "gone" }, fresh(NEXT_TAG));
    await settle();
    await vi.advanceTimersByTimeAsync(INTERVAL);

    hide();
    show();
    await settle();

    // Revalidating against a tag from before would ask the service to compare with a
    // workspace this browser may no longer be in.
    expect(asks).toEqual([null, TAG, null]);
    stop();
  });
});

describe("stopping the poll", () => {
  it("cancels the timer", async () => {
    const { asks, stop } = started(fresh());
    await settle();
    stop();

    await vi.advanceTimersByTimeAsync(INTERVAL * 5);

    expect(asks).toHaveLength(1);
  });

  it("drops an answer already in the air", async () => {
    let answer: ((value: SummaryAnswer) => void) | undefined;
    const read = () =>
      new Promise<SummaryAnswer>((resolve) => {
        answer = resolve;
      });

    const poll = createSummaryPoll({ read, visible: () => visible });
    const stop = poll.start();
    stop();

    answer?.(fresh());
    await settle();

    // A poll torn down mid-request must not publish into a store its provider has finished
    // with.
    expect(poll.snapshot()).toEqual(EMPTY_SNAPSHOT);
  });

  it("stops listening for the tab being shown", async () => {
    const { asks, stop } = started(fresh());
    await settle();
    stop();

    hide();
    show();
    await settle();

    expect(asks).toHaveLength(1);
  });
});

describe("requestSummary", () => {
  /** The stub `fetch` a case installs, and what it was asked. */
  function stubFetch(response: Response | Error) {
    const calls: [RequestInfo | URL, RequestInit | undefined][] = [];

    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    });

    return calls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks this origin, not the service", async () => {
    const calls = stubFetch(Response.json(summary()));

    await requestSummary(null);

    // The service's address is not in the browser bundle and the session cookie is
    // HttpOnly — the browser could not make this call directly even if it knew where to.
    expect(calls[0]?.[0]).toBe("/api/dashboard");
  });

  it("echoes the tag it holds, and keeps the browser cache out of the exchange", async () => {
    const calls = stubFetch(new Response(null, { status: 304 }));

    await requestSummary(TAG);

    expect((calls[0]?.[1]?.headers as Record<string, string>)["If-None-Match"]).toBe(TAG);
    expect(calls[0]?.[1]?.cache).toBe("no-store");
  });

  it("reads a 200 as the payload with its tag and cadence", async () => {
    const payload = summary();
    stubFetch(
      Response.json(payload, { headers: { ETag: TAG, "X-Ouro-Poll-After": "20" } }),
    );

    expect(await requestSummary(null)).toEqual({
      state: "fresh",
      summary: payload,
      etag: TAG,
      pollAfterSeconds: 20,
    });
  });

  it("reads a 304 as unchanged", async () => {
    stubFetch(new Response(null, { status: 304, headers: { "X-Ouro-Poll-After": "20" } }));

    expect(await requestSummary(TAG)).toEqual({
      state: "unchanged",
      etag: null,
      pollAfterSeconds: 20,
    });
  });

  it("reads a 401 as the session being over", async () => {
    stubFetch(Response.json({ code: "unauthenticated", message: "no" }, { status: 401 }));

    expect(await requestSummary(TAG)).toEqual({ state: "gone" });
  });

  it("passes on the sentence a failure carried", async () => {
    stubFetch(
      Response.json({ code: "dashboard_unavailable", message: "Nothing answered." }, { status: 502 }),
    );

    expect(await requestSummary(null)).toEqual({
      state: "failed",
      reason: "Nothing answered.",
      pollAfterSeconds: null,
    });
  });

  it("does not throw when nothing answers at all", async () => {
    stubFetch(new TypeError("fetch failed"));

    expect(await requestSummary(null)).toEqual({
      state: "failed",
      reason: UNREACHABLE_SUMMARY,
      pollAfterSeconds: null,
    });
  });

  it("refuses a 200 that is not a dashboard", async () => {
    stubFetch(Response.json({ hello: "world" }));

    expect(await requestSummary(null)).toEqual({
      state: "failed",
      reason: UNREADABLE_SUMMARY,
      pollAfterSeconds: null,
    });
  });
});
