import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlanningBatch } from "@/app/api/planning";
import { CACHE_CONTROL } from "@/app/api/poll-response";
import { batchUrl } from "@/app/planning/batch-poll";
import { POLL_AFTER_HEADER, type PollAnswer } from "@/app/poll";

import { SEEDED_BATCH_ID, planningBatch } from "../helpers/planning";

/**
 * `GET /api/planning/batches/{id}` — one batch, on the origin the browser can reach (#284). The id
 * is the path's and nothing else reaches the reader; the cadence the reader decided travels as
 * `X-Ouro-Poll-After`.
 */

vi.mock("server-only", () => ({}));

/** What the stubbed reader answers with. Reassigned per case. */
let answer: PollAnswer<PlanningBatch> = { state: "gone" };

/** What the reader was asked for. */
let askedFor: string | undefined;

vi.mock("@/app/api/planning-batch", () => ({
  PLANNING_UNAVAILABLE_CODE: "planning_unavailable",
  readPlanningBatch: (id: string) => {
    askedFor = id;
    return Promise.resolve(answer);
  },
}));

const { GET } = await import("@/app/api/planning/batches/[id]/route");

/**
 * One poll.
 *
 * @param id The batch the path names.
 * @param search A query string, which the handler must ignore.
 * @returns The response.
 */
function poll(id: string, search = ""): Promise<Response> {
  return GET(new Request(`http://ui.test${batchUrl(id)}${search}`), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  askedFor = undefined;
  answer = { state: "fresh", payload: planningBatch(), etag: null, pollAfterSeconds: 3 };
});

describe("the route", () => {
  it("asks for the id the path carries, and nothing from the query string", async () => {
    await poll(SEEDED_BATCH_ID, "?id=other");

    expect(askedFor).toBe(SEEDED_BATCH_ID);
  });

  it("answers the batch as JSON with the cadence it asked for, uncacheable by anything shared", async () => {
    const response = await poll(SEEDED_BATCH_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(planningBatch());
    expect(response.headers.get(POLL_AFTER_HEADER)).toBe("3");
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
  });

  it("tells a poll plainly that the session is over", async () => {
    answer = { state: "gone" };

    const response = await poll(SEEDED_BATCH_ID);

    expect(response.status).toBe(401);
    expect(response.headers.get("Location")).toBeNull();
  });

  it("reports a failed read as this origin's own, carrying the service's sentence", async () => {
    answer = { state: "failed", reason: "No such batch.", pollAfterSeconds: null };

    const response = await poll("nope");

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: "planning_unavailable", message: "No such batch." });
  });
});
