import { afterEach, describe, expect, it, vi } from "vitest";

import {
  UNREACHABLE_CONTROLS,
  UNREADABLE_CONTROLS,
  controlsUrl,
  createControlsPoll,
  isRunControlList,
  requestControls,
} from "@/app/runs/controls-poll";

import { SEEDED_RUN_ID, runControl } from "../helpers/runs";

/**
 * The run controls' poll reader (#310): the address, the guard, and the answers a read can come
 * back as. The loop itself — cadence, visibility, `X-Ouro-Poll-After` — is `poll.test.ts`'s.
 */

/**
 * A `fetch` answering one response.
 *
 * @param body What to answer with, serialised as JSON.
 * @param status The status.
 * @param headers Extra headers.
 * @returns The stub.
 */
function fetching(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const stub = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } }),
    ),
  );
  vi.stubGlobal("fetch", stub);
  return stub;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the address", () => {
  it("is this origin's, under the run, the id encoded", () => {
    expect(controlsUrl(SEEDED_RUN_ID)).toBe(`/api/runs/${SEEDED_RUN_ID}/controls`);
    expect(controlsUrl("a/b")).toBe("/api/runs/a%2Fb/controls");
  });
});

describe("isRunControlList", () => {
  it("accepts a list, empty or not, and refuses what merely answered on the URL", () => {
    expect(isRunControlList({ controls: [] })).toBe(true);
    expect(isRunControlList({ controls: [runControl()] })).toBe(true);
    expect(isRunControlList(null)).toBe(false);
    expect(isRunControlList("<html>")).toBe(false);
    expect(isRunControlList({})).toBe(false);
    expect(isRunControlList({ controls: [null] })).toBe(false);
    expect(isRunControlList({ controls: [{ id: "x", kind: "pause" }] })).toBe(false);
  });
});

describe("requestControls", () => {
  it("answers fresh with the list and the cadence the route asked for", async () => {
    const list = { controls: [runControl()] };
    fetching(list, 200, { "X-Ouro-Poll-After": "2" });

    expect(await requestControls(controlsUrl("x"))(null)).toMatchObject({
      state: "fresh",
      payload: list,
      pollAfterSeconds: 2,
    });
  });

  it("says the controls could not be read, or reached, in its own words", async () => {
    fetching({ something: "else" });
    expect(await requestControls(controlsUrl("x"))(null)).toMatchObject({ state: "failed", reason: UNREADABLE_CONTROLS });

    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    expect(await requestControls(controlsUrl("x"))(null)).toMatchObject({ state: "failed", reason: UNREACHABLE_CONTROLS });
  });

  it("reads a 401 as a session that has ended", async () => {
    fetching({ code: "unauthenticated", message: "Sign in." }, 401);

    expect(await requestControls(controlsUrl("x"))(null)).toEqual({ state: "gone" });
  });
});

describe("createControlsPoll", () => {
  it("is inert until started, and reads through the seam it is given", async () => {
    const list = { controls: [] };
    const read = vi.fn().mockResolvedValue({ state: "fresh", payload: list, etag: null, pollAfterSeconds: null });
    const poll = createControlsPoll(controlsUrl("x"), { read, visible: () => true });

    expect(read).not.toHaveBeenCalled();

    const stop = poll.start();
    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(list));
    stop();

    expect(read).toHaveBeenCalledOnce();
  });
});
