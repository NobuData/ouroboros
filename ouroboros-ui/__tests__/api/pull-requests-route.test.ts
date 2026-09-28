import { beforeEach, describe, expect, it, vi } from "vitest";

import { CACHE_CONTROL } from "@/app/api/poll-response";
import type { PollAnswer } from "@/app/poll";
import { pageUrl } from "@/app/prs/poll";

import { PR_514_ID, prPage } from "../helpers/pull-requests";

/**
 * `GET /api/prs/{id}` — the PR verification page's poll, on the origin the browser can reach
 * (#363). The id is the path's and nothing else reaches the reader; a failure is this hop's own
 * code with the service's sentence.
 */

vi.mock("server-only", () => ({}));

/** What the stubbed reader answers. Reassigned per case. */
let answer: PollAnswer<unknown> = { state: "gone" };

/** What the reader was asked for. */
const asked: string[] = [];

vi.mock("@/app/api/pull-requests-read", () => ({
  PR_UNAVAILABLE_CODE: "pull_request_unavailable",
  readPageForPoll: (id: string) => {
    asked.push(id);
    return Promise.resolve(answer);
  },
}));

const route = await import("@/app/api/prs/[id]/route");

beforeEach(() => {
  asked.length = 0;
});

describe("the PR page route", () => {
  it("asks for the path's PR and answers the page, uncacheable by anything shared", async () => {
    answer = { state: "fresh", payload: prPage(), etag: null, pollAfterSeconds: null };

    const response = await route.GET(new Request(`http://ui.test${pageUrl(PR_514_ID)}?id=other`), {
      params: Promise.resolve({ id: PR_514_ID }),
    });

    expect(asked).toEqual([PR_514_ID]);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    expect(await response.json()).toEqual(prPage());
  });

  it("answers a failure under its own code with the service's sentence", async () => {
    answer = { state: "failed", reason: "No such PR.", pollAfterSeconds: null };

    const response = await route.GET(new Request("http://ui.test/"), {
      params: Promise.resolve({ id: "x" }),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      code: "pull_request_unavailable",
      message: "No such PR.",
    });
  });

  it("answers an ended session as a 401 rather than a redirect", async () => {
    answer = { state: "gone" };

    const response = await route.GET(new Request("http://ui.test/"), {
      params: Promise.resolve({ id: PR_514_ID }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(expect.objectContaining({ code: "unauthenticated" }));
  });
});
