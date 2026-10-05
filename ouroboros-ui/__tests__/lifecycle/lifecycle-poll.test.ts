import { afterEach, describe, expect, it, vi } from "vitest";

import { UNREACHABLE_LIFECYCLE, UNREADABLE_LIFECYCLE } from "@/app/lifecycle/banner";
import {
  LIFECYCLE_ENDPOINT,
  createLifecyclePoll,
  requestLifecycle,
} from "@/app/lifecycle/lifecycle-poll";

import { pausedLifecycle } from "../helpers/lifecycle";

/**
 * The shell's lifecycle poll (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)):
 * the conditional GET against this origin, and the loop over it.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Answer the next fetch.
 *
 * @param response What to answer with, or an error to reject with.
 * @returns The spy.
 */
function answering(response: Response | Error) {
  const fetcher = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal("fetch", fetcher);

  return fetcher;
}

describe("requestLifecycle", () => {
  it("asks this origin's route, uncached, and answers the lifecycle", async () => {
    const fetcher = answering(Response.json(pausedLifecycle()));

    expect(await requestLifecycle(null)).toMatchObject({ state: "fresh", payload: pausedLifecycle() });
    expect(LIFECYCLE_ENDPOINT).toBe("/api/settings/lifecycle");
    expect(fetcher.mock.calls[0]).toMatchObject([LIFECYCLE_ENDPOINT, { cache: "no-store" }]);
  });

  it("reads a 401 as gone", async () => {
    answering(Response.json({ code: "unauthenticated", message: "Sign in." }, { status: 401 }));

    expect(await requestLifecycle(null)).toEqual({ state: "gone" });
  });

  it("says what could not be reached, and what could not be read", async () => {
    answering(new TypeError("fetch failed"));
    expect(await requestLifecycle(null)).toMatchObject({ state: "failed", reason: UNREACHABLE_LIFECYCLE });

    answering(Response.json({ state: "archived" }));
    expect(await requestLifecycle(null)).toMatchObject({ state: "failed", reason: UNREADABLE_LIFECYCLE });
  });
});

describe("createLifecyclePoll", () => {
  it("reads once on start and publishes the answer", async () => {
    const read = vi.fn().mockResolvedValue({
      state: "fresh",
      payload: pausedLifecycle(),
      etag: null,
      pollAfterSeconds: null,
    });
    const poll = createLifecyclePoll({ read, visible: () => true });

    const stop = poll.start();
    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(pausedLifecycle()));
    stop();

    expect(read).toHaveBeenCalledTimes(1);
  });
});
