import { beforeEach, describe, expect, it, vi } from "vitest";

import { CACHE_CONTROL } from "@/app/api/poll-response";
import type { RunControlList } from "@/app/api/runs";
import { POLL_AFTER_HEADER, type PollAnswer } from "@/app/poll";
import { controlsUrl } from "@/app/runs/controls-poll";

import { SEEDED_RUN_ID, runControl } from "../helpers/runs";

/**
 * `GET /api/runs/{id}/controls` — the head's chips, on the origin the browser can reach (#310).
 * The id is the path's and nothing else reaches the reader; the cadence travels as the header.
 */

vi.mock("server-only", () => ({}));

/** What the stubbed reader answers with. Reassigned per case. */
let answer: PollAnswer<RunControlList> = { state: "gone" };

/** What the reader was asked for. */
let askedFor: string | undefined;

vi.mock("@/app/api/run-controls", () => ({
  RUN_CONTROLS_UNAVAILABLE_CODE: "run_controls_unavailable",
  readRunControls: (id: string) => {
    askedFor = id;
    return Promise.resolve(answer);
  },
}));

const { GET } = await import("@/app/api/runs/[id]/controls/route");

/**
 * One poll.
 *
 * @param id The run the path names.
 * @param search A query string, which the handler must ignore.
 * @returns The response.
 */
function poll(id: string, search = ""): Promise<Response> {
  return GET(new Request(`http://ui.test${controlsUrl(id)}${search}`), { params: Promise.resolve({ id }) });
}

/** The seeded list. */
const LIST: RunControlList = { controls: [runControl()] };

beforeEach(() => {
  askedFor = undefined;
  answer = { state: "fresh", payload: LIST, etag: null, pollAfterSeconds: 2 };
});

describe("the route", () => {
  it("asks for the id the path carries, and nothing from the query string", async () => {
    await poll(SEEDED_RUN_ID, "?id=other");

    expect(askedFor).toBe(SEEDED_RUN_ID);
  });

  it("answers the list as JSON with its cadence, uncacheable by anything shared", async () => {
    const response = await poll(SEEDED_RUN_ID);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    expect(response.headers.get(POLL_AFTER_HEADER)).toBe("2");
    expect(await response.json()).toEqual(LIST);
  });

  it("answers an ended session with a 401 and a failure with a 502 naming the controls", async () => {
    answer = { state: "gone" };
    expect((await poll(SEEDED_RUN_ID)).status).toBe(401);

    answer = { state: "failed", reason: "No such run.", pollAfterSeconds: null };
    const failed = await poll(SEEDED_RUN_ID);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ code: "run_controls_unavailable", message: "No such run." });
  });
});
