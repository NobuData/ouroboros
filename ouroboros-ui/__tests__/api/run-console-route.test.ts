import { beforeEach, describe, expect, it, vi } from "vitest";

import { CACHE_CONTROL } from "@/app/api/poll-response";
import type { RunConsole } from "@/app/api/runs";
import { runUrl } from "@/app/runs/console-poll";
import type { PollAnswer } from "@/app/poll";

import { SEEDED_RUN_ID, runConsole } from "../helpers/runs";

/**
 * `GET /api/runs/{id}` — one run, on the origin the browser can reach (#309). The id is the
 * path's and nothing else reaches the reader.
 */

vi.mock("server-only", () => ({}));

/** What the stubbed reader answers with. Reassigned per case. */
let answer: PollAnswer<RunConsole> = { state: "gone" };

/** What the reader was asked for. */
let askedFor: string | undefined;

vi.mock("@/app/api/run-console", () => ({
  RUN_UNAVAILABLE_CODE: "run_unavailable",
  readRunConsole: (id: string) => {
    askedFor = id;
    return Promise.resolve(answer);
  },
}));

const { GET } = await import("@/app/api/runs/[id]/route");

/**
 * One poll.
 *
 * @param id The run the path names.
 * @param search A query string, which the handler must ignore.
 * @returns The response.
 */
function poll(id: string, search = ""): Promise<Response> {
  return GET(new Request(`http://ui.test${runUrl(id)}${search}`), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  askedFor = undefined;
  answer = { state: "fresh", payload: runConsole(), etag: null, pollAfterSeconds: null };
});

describe("the route", () => {
  it("asks for the id the path carries, and nothing from the query string", async () => {
    await poll(SEEDED_RUN_ID, "?id=other");

    expect(askedFor).toBe(SEEDED_RUN_ID);
  });

  it("answers the snapshot as JSON, uncacheable by anything shared", async () => {
    const response = await poll(SEEDED_RUN_ID);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    expect(await response.json()).toEqual(runConsole());
  });

  it("answers an ended session with a 401 and a failure with a 502 naming the run", async () => {
    answer = { state: "gone" };
    expect((await poll(SEEDED_RUN_ID)).status).toBe(401);

    answer = { state: "failed", reason: "No such run.", pollAfterSeconds: null };
    const failed = await poll(SEEDED_RUN_ID);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ code: "run_unavailable", message: "No such run." });
  });
});
