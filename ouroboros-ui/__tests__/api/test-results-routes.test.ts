import { beforeEach, describe, expect, it, vi } from "vitest";

import { CACHE_CONTROL } from "@/app/api/poll-response";
import type { PollAnswer } from "@/app/poll";
import { failureUrl, gateUrl, hintsUrl, pageUrl, timelineUrl } from "@/app/test-results/poll";

import { SEEDED_RUN_ID } from "../helpers/runs";
import { BUILD_3_ID, OVERSHOOT_CASE, caseFailure, gate, hints, page, timeline } from "../helpers/test-results";

/**
 * `GET /api/runs/{id}/tests` and `GET /api/test-runs/{id}/rerun` — the test-results page's two
 * polls, on the origin the browser can reach (#335). The id is the path's and nothing else
 * reaches the reader; a failure is this hop's own code with the service's sentence.
 */

vi.mock("server-only", () => ({}));

/** What the stubbed readers answer. Reassigned per case. */
let answer: PollAnswer<unknown> = { state: "gone" };

/** What each reader was asked for. */
const asked: string[] = [];

vi.mock("@/app/api/test-results-read", () => ({
  TESTS_UNAVAILABLE_CODE: "test_results_unavailable",
  RERUN_GATE_UNAVAILABLE_CODE: "rerun_gate_unavailable",
  TEST_RUN_PAGE_UNAVAILABLE_CODE: "test_run_page_unavailable",
  CASE_FAILURE_UNAVAILABLE_CODE: "case_failure_unavailable",
  TRIAGE_HINTS_UNAVAILABLE_CODE: "triage_hints_unavailable",
  readFailureForPoll: (id: string, caseId: string) => {
    asked.push(`failure:${id}:${caseId}`);
    return Promise.resolve(answer);
  },
  readHintsForPoll: (id: string) => {
    asked.push(`hints:${id}`);
    return Promise.resolve(answer);
  },
  readPageForPoll: (id: string) => {
    asked.push(`page:${id}`);
    return Promise.resolve(answer);
  },
  readTimelineForPoll: (id: string) => {
    asked.push(`timeline:${id}`);
    return Promise.resolve(answer);
  },
  readGateForPoll: (id: string) => {
    asked.push(`gate:${id}`);
    return Promise.resolve(answer);
  },
}));

const timelineRoute = await import("@/app/api/runs/[id]/tests/route");
const gateRoute = await import("@/app/api/test-runs/[id]/rerun/route");
const pageRoute = await import("@/app/api/test-runs/[id]/route");
const failureRoute = await import("@/app/api/test-runs/[id]/cases/[caseId]/failure/route");
const hintsRoute = await import("@/app/api/test-runs/[id]/hints/route");

beforeEach(() => {
  asked.length = 0;
});

describe("the timeline route", () => {
  it("asks for the path's run and answers the timeline, uncacheable by anything shared", async () => {
    answer = { state: "fresh", payload: timeline(), etag: null, pollAfterSeconds: null };

    const response = await timelineRoute.GET(new Request(`http://ui.test${timelineUrl(SEEDED_RUN_ID)}?id=other`), {
      params: Promise.resolve({ id: SEEDED_RUN_ID }),
    });

    expect(asked).toEqual([`timeline:${SEEDED_RUN_ID}`]);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    expect(await response.json()).toEqual(timeline());
  });

  it("answers a failure under its own code with the service's sentence", async () => {
    answer = { state: "failed", reason: "No such run.", pollAfterSeconds: null };

    const response = await timelineRoute.GET(new Request("http://ui.test/"), { params: Promise.resolve({ id: "x" }) });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: "test_results_unavailable", message: "No such run." });
  });
});

describe("the gate route", () => {
  it("asks for the path's attempt and answers the gate", async () => {
    answer = { state: "fresh", payload: gate(), etag: null, pollAfterSeconds: null };

    const response = await gateRoute.GET(new Request(`http://ui.test${gateUrl(BUILD_3_ID)}`), {
      params: Promise.resolve({ id: BUILD_3_ID }),
    });

    expect(asked).toEqual([`gate:${BUILD_3_ID}`]);
    expect(await response.json()).toEqual(gate());
  });

  it("answers an ended session as a 401 rather than a redirect", async () => {
    answer = { state: "gone" };

    const response = await gateRoute.GET(new Request("http://ui.test/"), { params: Promise.resolve({ id: BUILD_3_ID }) });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(expect.objectContaining({ code: "unauthenticated" }));
  });
});

describe("the attempt page route (#337)", () => {
  it("asks for the path's attempt and answers its page, uncacheable by anything shared", async () => {
    answer = { state: "fresh", payload: page(), etag: null, pollAfterSeconds: null };

    const response = await pageRoute.GET(new Request(`http://ui.test${pageUrl(BUILD_3_ID)}?id=other`), {
      params: Promise.resolve({ id: BUILD_3_ID }),
    });

    expect(asked).toEqual([`page:${BUILD_3_ID}`]);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    expect(await response.json()).toEqual(page());
  });

  it("answers a failure under its own code with the service's sentence", async () => {
    answer = { state: "failed", reason: "No such test run.", pollAfterSeconds: null };

    const response = await pageRoute.GET(new Request("http://ui.test/"), { params: Promise.resolve({ id: "x" }) });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: "test_run_page_unavailable", message: "No such test run." });
  });
});

describe("the failure route (#339)", () => {
  it("asks for the path's attempt and case and answers the failure, uncacheable by anything shared", async () => {
    answer = { state: "fresh", payload: caseFailure(), etag: null, pollAfterSeconds: null };

    const response = await failureRoute.GET(
      new Request(`http://ui.test${failureUrl(BUILD_3_ID, OVERSHOOT_CASE.caseId)}?caseId=other`),
      { params: Promise.resolve({ id: BUILD_3_ID, caseId: OVERSHOOT_CASE.caseId }) },
    );

    expect(asked).toEqual([`failure:${BUILD_3_ID}:${OVERSHOOT_CASE.caseId}`]);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    expect(await response.json()).toEqual(caseFailure());
  });

  it("answers a failure under its own code with the service's sentence", async () => {
    answer = { state: "failed", reason: "No such case.", pollAfterSeconds: null };

    const response = await failureRoute.GET(new Request("http://ui.test/"), {
      params: Promise.resolve({ id: "x", caseId: "y" }),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: "case_failure_unavailable", message: "No such case." });
  });
});

describe("the hints route (#339)", () => {
  it("asks for the path's attempt and answers its hints", async () => {
    answer = { state: "fresh", payload: hints(), etag: null, pollAfterSeconds: null };

    const response = await hintsRoute.GET(new Request(`http://ui.test${hintsUrl(BUILD_3_ID)}?id=other`), {
      params: Promise.resolve({ id: BUILD_3_ID }),
    });

    expect(asked).toEqual([`hints:${BUILD_3_ID}`]);
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    expect(await response.json()).toEqual(hints());
  });

  it("answers an ended session as a 401, and a failure under its own code", async () => {
    answer = { state: "gone" };
    expect((await hintsRoute.GET(new Request("http://ui.test/"), { params: Promise.resolve({ id: BUILD_3_ID }) })).status).toBe(401);

    answer = { state: "failed", reason: "No such test run.", pollAfterSeconds: null };
    const response = await hintsRoute.GET(new Request("http://ui.test/"), { params: Promise.resolve({ id: "x" }) });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: "triage_hints_unavailable", message: "No such test run." });
  });
});
