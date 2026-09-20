import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FARM_ENDPOINT,
  UNREACHABLE_FARM,
  UNREADABLE_FARM,
  createFarmPoll,
  isFarmPage,
  requestFarm,
} from "@/app/farm/farm-poll";
import { POLL_AFTER_HEADER } from "@/app/poll";

import { emptyFarm, seededFarm } from "../helpers/farm";

/**
 * The farm's poll reader (#256): the address, the guard, and the answers a read can come back as.
 * The loop itself is `poll.test.ts`'s.
 */

/**
 * A `fetch` answering one response.
 *
 * @param body What to answer with, serialised as JSON.
 * @param status The status.
 * @param headers Headers beside `Content-Type`.
 * @returns The stub.
 */
function fetching(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const stub = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } }),
    ),
  );
  vi.stubGlobal("fetch", stub);
  return stub;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("isFarmPage", () => {
  it("accepts the page, seeded or empty", () => {
    expect(isFarmPage(seededFarm())).toBe(true);
    expect(isFarmPage(emptyFarm())).toBe(true);
  });

  it("refuses what merely answered on the URL", () => {
    expect(isFarmPage(null)).toBe(false);
    expect(isFarmPage("<html>")).toBe(false);
    expect(isFarmPage([])).toBe(false);
    expect(isFarmPage({ code: "farm_unavailable", message: "No." })).toBe(false);
  });

  it("refuses a page missing a card the headline reaches into, rather than throwing in a render", () => {
    const threeCards: Record<string, unknown> = { ...seededFarm().stats };
    delete threeCards.cacheHitRate;

    expect(isFarmPage({ ...seededFarm(), stats: {} })).toBe(false);
    expect(isFarmPage({ ...seededFarm(), stats: threeCards })).toBe(false);
    expect(isFarmPage({ ...seededFarm(), stats: { ...seededFarm().stats, buildsToday: null } })).toBe(false);
  });

  it("refuses a page whose collections are not lists", () => {
    expect(isFarmPage({ ...seededFarm(), pools: null })).toBe(false);
    expect(isFarmPage({ ...seededFarm(), runners: {} })).toBe(false);
  });
});

describe("requestFarm", () => {
  it("asks this origin, and answers fresh with the page and the fleet's cadence", async () => {
    const stub = fetching(seededFarm(), 200, { [POLL_AFTER_HEADER]: "10" });

    const answer = await requestFarm(null);

    expect(stub.mock.calls[0]![0]).toBe(FARM_ENDPOINT);
    expect(FARM_ENDPOINT).toBe("/api/farm");
    expect(answer).toEqual({ state: "fresh", payload: seededFarm(), etag: null, pollAfterSeconds: 10 });
  });

  it("reads a 401 as the session being over", async () => {
    fetching({ code: "unauthenticated", message: "This session is no longer signed in." }, 401);

    await expect(requestFarm(null)).resolves.toEqual({ state: "gone" });
  });

  it("carries this origin's sentence for a failed read", async () => {
    fetching({ code: "farm_unavailable", message: "Choose a workspace." }, 502);

    await expect(requestFarm(null)).resolves.toMatchObject({ state: "failed", reason: "Choose a workspace." });
  });

  it("says unreadable for a 200 that is not the page", async () => {
    fetching({ hello: "world" });

    await expect(requestFarm(null)).resolves.toMatchObject({ state: "failed", reason: UNREADABLE_FARM });
  });

  it("says unreachable when nothing answered at all", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));

    await expect(requestFarm(null)).resolves.toMatchObject({ state: "failed", reason: UNREACHABLE_FARM });
  });
});

describe("createFarmPoll", () => {
  it("is inert until started, then settles on the cadence the answer asked for", async () => {
    vi.useFakeTimers();
    const read = vi.fn(() =>
      Promise.resolve({ state: "fresh" as const, payload: seededFarm(), etag: null, pollAfterSeconds: 10 }),
    );
    const poll = createFarmPoll({ read, visible: () => true });

    expect(read).not.toHaveBeenCalled();

    const stop = poll.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(read).toHaveBeenCalledTimes(1);
    expect(poll.snapshot().data).toEqual(seededFarm());

    // Ten seconds — the fleet's heartbeat — not the contract's fifteen-second default.
    await vi.advanceTimersByTimeAsync(9_999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);

    stop();
  });

  it("does not poll a hidden tab", async () => {
    vi.useFakeTimers();
    const read = vi.fn(() =>
      Promise.resolve({ state: "fresh" as const, payload: seededFarm(), etag: null, pollAfterSeconds: 10 }),
    );
    const stop = createFarmPoll({ read, visible: () => false }).start();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(read).not.toHaveBeenCalled();
    stop();
  });
});
