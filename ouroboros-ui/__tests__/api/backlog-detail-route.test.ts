import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IssueDetail } from "@/app/api/backlog";
import { CACHE_CONTROL } from "@/app/api/poll-response";
import { detailUrl } from "@/app/issues/detail-poll";
import type { PollAnswer } from "@/app/poll";

import { issueDetail, issueId } from "../helpers/issues";

/**
 * `GET /api/backlog/{id}` — one issue, on the origin the browser can reach (#119).
 *
 * Two things are the handler's own: the id is the path's and nothing else from the request
 * reaches the reader; and the translation from an answer to a response is
 * `app/api/poll-response.ts`'s, held here from the issue's side as `backlog-route.test.ts` holds
 * it from the listing's.
 */

vi.mock("server-only", () => ({}));

/** What the stubbed reader answers with. Reassigned per case. */
let answer: PollAnswer<IssueDetail> = { state: "gone" };

/** What the reader was asked for. */
let askedFor: string | undefined;

vi.mock("@/app/api/backlog-detail", () => ({
  readIssueDetail: (id: string) => {
    askedFor = id;
    return Promise.resolve(answer);
  },
}));

const { GET } = await import("@/app/api/backlog/[id]/route");
const { BACKLOG_UNAVAILABLE_CODE } = await import("@/app/api/backlog/route");

const ID = issueId(485);

/**
 * One poll.
 *
 * @param id The issue the path names.
 * @param search A query string, which the handler must ignore.
 * @returns The response.
 */
function poll(id: string, search = ""): Promise<Response> {
  return GET(new Request(`http://ui.test${detailUrl(id)}${search}`), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  askedFor = undefined;
  answer = { state: "fresh", payload: issueDetail(), etag: null, pollAfterSeconds: null };
});

describe("the address", () => {
  it("asks for the id the path carries, and nothing from the query string", async () => {
    await poll(ID, "?id=other&limit=1000");

    expect(askedFor).toBe(ID);
  });
});

describe("the answer", () => {
  it("answers the issue as JSON, uncacheable by anything shared", async () => {
    const response = await poll(ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(issueDetail());
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    expect(response.headers.get("ETag")).toBeNull();
  });

  it("tells a poll plainly that the session is over, rather than redirecting it", async () => {
    answer = { state: "gone" };

    const response = await poll(ID);

    expect(response.status).toBe(401);
    expect(response.headers.get("Location")).toBeNull();
    expect((await response.json()).code).toBe("unauthenticated");
  });

  it("reports a failed read as this origin's own, carrying the service's sentence", async () => {
    answer = { state: "failed", reason: "No issue with that id.", pollAfterSeconds: null };

    const response = await poll("not-an-id");

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: BACKLOG_UNAVAILABLE_CODE, message: "No issue with that id." });
  });
});
