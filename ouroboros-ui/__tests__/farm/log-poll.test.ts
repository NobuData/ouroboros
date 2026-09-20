import { afterEach, describe, expect, it, vi } from "vitest";

import {
  UNREACHABLE_LOG,
  UNREADABLE_LOG,
  isBuildLog,
  logEndpoint,
  readAfter,
  requestLog,
} from "@/app/farm/log-poll";
import { POLL_AFTER_HEADER } from "@/app/poll";

import { LIVE_JOB_ID, buildLog } from "../helpers/farm";

/**
 * The log's poll reader (#261): the address — which carries the offset — the guard, and the
 * answers a read can come back as. The loop that owns the offset is `log-stream.test.ts`'s.
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
});

describe("logEndpoint", () => {
  it("asks this origin for the job's log from an offset", () => {
    expect(logEndpoint(LIVE_JOB_ID, 18_122)).toBe(`/api/farm/jobs/${LIVE_JOB_ID}/log?after=18122`);
  });

  it("escapes an id, which arrives from a payload and is going into a path", () => {
    expect(logEndpoint("../../auth?x=1", 0)).toBe("/api/farm/jobs/..%2F..%2Fauth%3Fx%3D1/log?after=0");
  });
});

describe("readAfter", () => {
  it("reads a log from its start when no offset was given", () => {
    expect(readAfter(null)).toBe(0);
    expect(readAfter("")).toBe(0);
  });

  it("reads a whole, non-negative number", () => {
    expect(readAfter("0")).toBe(0);
    expect(readAfter("18122")).toBe(18_122);
  });

  it("refuses anything else, rather than reading a log from somewhere nobody asked for", () => {
    for (const raw of ["-1", "1.5", "1e3", "0x10", " 12", "abc", "12abc", "99999999999999999999"]) {
      expect(readAfter(raw), raw).toBeNull();
    }
  });
});

describe("isBuildLog", () => {
  it("accepts a page — empty, with text, with holes and with a tail", () => {
    expect(isBuildLog(buildLog())).toBe(true);
    expect(isBuildLog(buildLog("[6/7] Linking zephyr.elf …"))).toBe(true);
    expect(
      isBuildLog(
        buildLog("a\nb\n", {
          elisions: [{ offset: 2, bytes: 10, missingChunks: 1 }],
          tail: { bytes: 5, missingChunks: 0, capped: true },
        }),
      ),
    ).toBe(true);
  });

  it("refuses what merely answered on the URL", () => {
    expect(isBuildLog(null)).toBe(false);
    expect(isBuildLog("<html>")).toBe(false);
    expect(isBuildLog([])).toBe(false);
    expect(isBuildLog({ code: "farm_log_unavailable", message: "No." })).toBe(false);
  });

  it("refuses a page whose offsets the stream could not do arithmetic on", () => {
    expect(isBuildLog({ ...buildLog("abc"), nextOffset: "3" })).toBe(false);
    expect(isBuildLog({ ...buildLog("abc"), offset: -1 })).toBe(false);
    expect(isBuildLog({ ...buildLog("abc"), end: 1.5 })).toBe(false);
    // A page that ends before it starts.
    expect(isBuildLog({ ...buildLog("abc"), offset: 10, nextOffset: 3 })).toBe(false);
  });

  it("refuses a page whose live flag is not a flag: the cursor is bound to it", () => {
    expect(isBuildLog({ ...buildLog("abc"), live: "true" })).toBe(false);
    expect(isBuildLog({ ...buildLog("abc"), live: undefined })).toBe(false);
  });

  it("refuses a hole without a position or a count, and a tail that is not one", () => {
    expect(isBuildLog({ ...buildLog("abc"), elisions: [{ bytes: 1, missingChunks: 0 }] })).toBe(false);
    expect(isBuildLog({ ...buildLog("abc"), elisions: [{ offset: 1, bytes: "1", missingChunks: 0 }] })).toBe(false);
    expect(isBuildLog({ ...buildLog("abc"), elisions: "none" })).toBe(false);
    expect(isBuildLog({ ...buildLog("abc"), tail: { capped: true } })).toBe(false);
    expect(isBuildLog({ ...buildLog("abc"), tail: undefined })).toBe(false);
  });
});

describe("requestLog", () => {
  it("asks from the offset, uncached, with the session's cookies and no tag", async () => {
    const fetched = fetching(buildLog("abc", { offset: 100 }), 200, { [POLL_AFTER_HEADER]: "2" });

    const answer = await requestLog(LIVE_JOB_ID, 100);

    expect(fetched).toHaveBeenCalledTimes(1);
    expect(fetched.mock.calls[0]![0]).toBe(`/api/farm/jobs/${LIVE_JOB_ID}/log?after=100`);
    expect(fetched.mock.calls[0]![1]).toMatchObject({ cache: "no-store", credentials: "same-origin" });
    expect(new Headers(fetched.mock.calls[0]![1]!.headers).get("If-None-Match")).toBeNull();
    expect(answer).toEqual({
      state: "fresh",
      payload: buildLog("abc", { offset: 100 }),
      etag: null,
      pollAfterSeconds: 2,
    });
  });

  it("reads a 401 as gone", async () => {
    fetching({ code: "unauthenticated", message: "Sign in." }, 401);

    expect(await requestLog(LIVE_JOB_ID, 0)).toEqual({ state: "gone" });
  });

  it("carries the service's sentence out of a refusal", async () => {
    fetching({ code: "farm_log_unavailable", message: "This workspace has no such build job." }, 502);

    expect(await requestLog(LIVE_JOB_ID, 0)).toMatchObject({
      state: "failed",
      reason: "This workspace has no such build job.",
    });
  });

  it("says unreadable for a 200 that is not a page, and unreachable when nothing answered", async () => {
    fetching({ hello: "world" });
    expect(await requestLog(LIVE_JOB_ID, 0)).toMatchObject({ state: "failed", reason: UNREADABLE_LOG });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await requestLog(LIVE_JOB_ID, 0)).toMatchObject({ state: "failed", reason: UNREACHABLE_LOG });
  });
});
