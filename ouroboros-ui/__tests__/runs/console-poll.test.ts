import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RUN_ENDPOINT,
  UNREACHABLE_RUN,
  UNREADABLE_RUN,
  createRunPoll,
  isRunConsole,
  requestRun,
  runUrl,
} from "@/app/runs/console-poll";

import { SEEDED_RUN_ID, runConsole } from "../helpers/runs";

/**
 * The run console's poll reader (#309): the address, the guard, and the answers a read can come
 * back as. The loop itself — cadence, visibility, `X-Ouro-Poll-After` — is `poll.test.ts`'s.
 */

/**
 * A `fetch` answering one response.
 *
 * @param body What to answer with, serialised as JSON.
 * @param status The status.
 * @returns The stub.
 */
function fetching(body: unknown, status = 200) {
  const stub = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })),
  );
  vi.stubGlobal("fetch", stub);
  return stub;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the address", () => {
  it("is this origin's, with the run's id as its last segment, encoded", () => {
    expect(runUrl(SEEDED_RUN_ID)).toBe(`${RUN_ENDPOINT}/${SEEDED_RUN_ID}`);
    expect(runUrl("a/b?c")).toBe("/api/runs/a%2Fb%3Fc");
  });
});

describe("isRunConsole", () => {
  it("accepts a snapshot, and refuses what merely answered on the URL", () => {
    expect(isRunConsole(runConsole())).toBe(true);
    expect(isRunConsole(null)).toBe(false);
    expect(isRunConsole("<html>")).toBe(false);
    expect(isRunConsole({ ...runConsole(), asOf: undefined })).toBe(false);
    expect(isRunConsole({ ...runConsole(), run: null })).toBe(false);
    expect(isRunConsole({ ...runConsole(), head: { loopSeq: "1847" } })).toBe(false);
    expect(isRunConsole({ ...runConsole(), resources: {} })).toBe(false);
  });
});

describe("requestRun", () => {
  it("answers fresh with the snapshot, asked of this origin without a cache", async () => {
    const stub = fetching(runConsole());

    const answer = await requestRun(runUrl(SEEDED_RUN_ID))(null);

    expect(answer).toMatchObject({ state: "fresh", payload: runConsole() });
    expect(stub).toHaveBeenCalledWith(runUrl(SEEDED_RUN_ID), expect.objectContaining({ cache: "no-store" }));
  });

  it("says the run could not be read when the body is not one", async () => {
    fetching({ something: "else" });

    expect(await requestRun(runUrl("x"))(null)).toMatchObject({ state: "failed", reason: UNREADABLE_RUN });
  });

  it("carries the service's own sentence for a refusal", async () => {
    fetching({ code: "run_unavailable", message: "The service is down." }, 502);

    expect(await requestRun(runUrl("x"))(null)).toMatchObject({ state: "failed", reason: "The service is down." });
  });

  it("says the run could not be reached when nothing answered", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));

    expect(await requestRun(runUrl("x"))(null)).toMatchObject({ state: "failed", reason: UNREACHABLE_RUN });
  });

  it("reads a 401 as a session that has ended", async () => {
    fetching({ code: "unauthenticated", message: "Sign in." }, 401);

    expect(await requestRun(runUrl("x"))(null)).toEqual({ state: "gone" });
  });
});

describe("createRunPoll", () => {
  it("is inert until started, and reads through the seam it is given", async () => {
    const read = vi.fn().mockResolvedValue({ state: "fresh", payload: runConsole(), etag: null, pollAfterSeconds: null });
    const poll = createRunPoll(runUrl("x"), { read, visible: () => true });

    expect(read).not.toHaveBeenCalled();

    const stop = poll.start();
    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(runConsole()));
    stop();

    expect(read).toHaveBeenCalledOnce();
  });
});
