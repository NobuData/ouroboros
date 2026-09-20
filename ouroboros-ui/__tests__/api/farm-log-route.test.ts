import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BuildLog } from "@/app/api/farm";
import { CACHE_CONTROL } from "@/app/api/poll-response";
import { ETAG_HEADER, POLL_AFTER_HEADER, type PollAnswer } from "@/app/poll";

import { LIVE_JOB_ID, buildLog } from "../helpers/farm";

/**
 * `GET /api/farm/jobs/{id}/log?after=` — one page of a build's log, on the origin the browser can
 * reach (#261). The job comes from the path and the offset from the query, both handed to the
 * reader exactly as they arrived; the page's cadence travels as `X-Ouro-Poll-After`.
 */

vi.mock("server-only", () => ({}));

/** What the stubbed reader answers with. Reassigned per case. */
let answer: PollAnswer<BuildLog> = { state: "gone" };

/** What the reader was asked for. */
const readFarmLog = vi.fn((id: string, after: string | null) => {
  void id;
  void after;
  return Promise.resolve(answer);
});

vi.mock("@/app/api/farm-log", () => ({
  FARM_LOG_UNAVAILABLE_CODE: "farm_log_unavailable",
  readFarmLog: (id: string, after: string | null) => readFarmLog(id, after),
}));

const { GET } = await import("@/app/api/farm/jobs/[id]/log/route");

/**
 * Ask the route.
 *
 * @param query The address's query string, with its `?`.
 * @returns The response.
 */
function ask(query = ""): Promise<Response> {
  return GET(new Request(`http://ui.test/api/farm/jobs/${LIVE_JOB_ID}/log${query}`), {
    params: Promise.resolve({ id: LIVE_JOB_ID }),
  });
}

beforeEach(() => {
  readFarmLog.mockClear();
  answer = { state: "fresh", payload: buildLog("abc", { offset: 100 }), etag: null, pollAfterSeconds: 2 };
});

describe("the route", () => {
  it("answers the page as JSON with its cadence, uncacheable by anything shared", async () => {
    const response = await ask("?after=100");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(buildLog("abc", { offset: 100 }));
    expect(response.headers.get(POLL_AFTER_HEADER)).toBe("2");
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    expect(response.headers.get(ETAG_HEADER)).toBeNull();
  });

  it("hands the reader the job from the path and the offset as it arrived", async () => {
    await ask("?after=100");
    expect(readFarmLog).toHaveBeenLastCalledWith(LIVE_JOB_ID, "100");

    await ask();
    expect(readFarmLog).toHaveBeenLastCalledWith(LIVE_JOB_ID, null);

    // Not parsed here: what counts as an offset is the reader's to decide, once.
    await ask("?after=abc");
    expect(readFarmLog).toHaveBeenLastCalledWith(LIVE_JOB_ID, "abc");
  });

  it("tells a poll plainly that the session is over, rather than redirecting it", async () => {
    answer = { state: "gone" };

    const response = await ask();

    expect(response.status).toBe(401);
    expect(response.headers.get("Location")).toBeNull();
  });

  it("reports a failed read as this origin's own, carrying the service's sentence", async () => {
    answer = { state: "failed", reason: "This workspace has no such build job.", pollAfterSeconds: null };

    const response = await ask();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      code: "farm_log_unavailable",
      message: "This workspace has no such build job.",
    });
  });
});
