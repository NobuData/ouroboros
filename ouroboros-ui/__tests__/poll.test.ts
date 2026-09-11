import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_POLL_SECONDS,
  EMPTY_POLL_SNAPSHOT,
  MAX_POLL_SECONDS,
  MIN_POLL_SECONDS,
  type PollAnswer,
  createPoll,
  readPollAfter,
  requestPayload,
} from "@/app/poll";

/**
 * The generic polling loop (#87, made generic by #117).
 *
 * Every clause of the contract — the interval, the hidden tab, the tag, the backoff, the
 * sequence check — is `summary-poll.test.ts`'s, driven through the dashboard's reader. What is
 * here is what being generic adds: that the loop is indifferent to the payload, that the empty
 * snapshot is one identity for every poll, that a browser reader is built from a guard and two
 * sentences, and the cadence hint's bounds.
 */

/** A payload that is not the dashboard's, to prove the loop does not care. */
interface Weather {
  readonly sky: string;
}

/** A fresh answer carrying one. */
function fresh(sky: string): PollAnswer<Weather> {
  return { state: "fresh", payload: { sky }, etag: null, pollAfterSeconds: null };
}

describe("createPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("carries whatever payload its reader answers with", async () => {
    const poll = createPoll<Weather>(() => Promise.resolve(fresh("clear")), { visible: () => true });

    expect(poll.snapshot()).toBe(EMPTY_POLL_SNAPSHOT);

    const stop = poll.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(poll.snapshot().data).toEqual({ sky: "clear" });
    stop();
  });

  it("asks again on the default cadence until an answer says otherwise", async () => {
    const read = vi.fn().mockResolvedValue(fresh("clear"));
    const poll = createPoll(read, { visible: () => true });

    const stop = poll.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_SECONDS * 1000);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
  });

  it("hands every poll the same empty snapshot, so a server snapshot is identity-stable", () => {
    const one = createPoll<Weather>(() => Promise.resolve(fresh("clear")));
    const two = createPoll<{ readonly n: number }>(() => Promise.resolve({ state: "gone" }));

    expect(one.snapshot()).toBe(EMPTY_POLL_SNAPSHOT);
    expect(two.snapshot()).toBe(EMPTY_POLL_SNAPSHOT);
    expect(Object.isFrozen(EMPTY_POLL_SNAPSHOT)).toBe(true);
  });
});

describe("requestPayload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a body its guard accepts, and reads one it refuses as unreadable", async () => {
    const isWeather = (value: unknown): value is Weather =>
      typeof value === "object" && value !== null && "sky" in value;
    const sentences = { unreachable: "No weather.", unreadable: "Not weather." };

    vi.stubGlobal("fetch", () => Promise.resolve(Response.json({ sky: "grey" })));
    expect(await requestPayload("/api/weather", null, isWeather, sentences)).toEqual({
      state: "fresh",
      payload: { sky: "grey" },
      etag: null,
      pollAfterSeconds: null,
    });

    vi.stubGlobal("fetch", () => Promise.resolve(Response.json({ sea: "calm" })));
    expect(await requestPayload("/api/weather", null, isWeather, sentences)).toEqual({
      state: "failed",
      reason: "Not weather.",
      pollAfterSeconds: null,
    });

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    expect(await requestPayload("/api/weather", null, isWeather, sentences)).toEqual({
      state: "failed",
      reason: "No weather.",
      pollAfterSeconds: null,
    });
  });

  it("passes the tag and the cadence hint back out of a 200", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json({ sky: "grey" }, { headers: { ETag: '"w1"', "X-Ouro-Poll-After": "30" } }),
      ),
    );

    expect(
      await requestPayload("/api/weather", null, (value): value is Weather => value !== null, {
        unreachable: "",
        unreadable: "",
      }),
    ).toMatchObject({ state: "fresh", etag: '"w1"', pollAfterSeconds: 30 });
  });
});

describe("readPollAfter", () => {
  it("reads whole seconds inside the contract's bounds", () => {
    expect(readPollAfter(new Headers({ "X-Ouro-Poll-After": "15" }))).toBe(15);
    expect(readPollAfter(new Headers({ "X-Ouro-Poll-After": ` ${MAX_POLL_SECONDS} ` }))).toBe(MAX_POLL_SECONDS);
    expect(readPollAfter(new Headers({ "X-Ouro-Poll-After": String(MIN_POLL_SECONDS) }))).toBe(MIN_POLL_SECONDS);
  });

  it("treats anything else as no hint rather than an error", () => {
    expect(readPollAfter(new Headers())).toBeNull();
    expect(readPollAfter(new Headers({ "X-Ouro-Poll-After": "soon" }))).toBeNull();
    expect(readPollAfter(new Headers({ "X-Ouro-Poll-After": "1.5" }))).toBeNull();
    expect(readPollAfter(new Headers({ "X-Ouro-Poll-After": "0" }))).toBeNull();
    expect(readPollAfter(new Headers({ "X-Ouro-Poll-After": String(MAX_POLL_SECONDS + 1) }))).toBeNull();
  });
});
