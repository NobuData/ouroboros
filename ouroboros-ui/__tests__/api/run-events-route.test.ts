import { describe, expect, it, vi } from "vitest";

import type { RunEventsPage } from "@/app/api/runs";
import { POLL_AFTER_HEADER, type PollAnswer } from "@/app/poll";

import { SEEDED_RUN_ID, eventsPage } from "../helpers/runs";

/** `GET /api/runs/{id}/events?after=` (#312): the path's id, the query's cursor, the reader's cadence. */

vi.mock("server-only", () => ({}));

const readRunEvents = vi.fn<(id: string, after: string | null) => Promise<PollAnswer<RunEventsPage>>>();

vi.mock("@/app/api/run-events", () => ({
  RUN_EVENTS_UNAVAILABLE_CODE: "run_events_unavailable",
  readRunEvents: (id: string, after: string | null) => readRunEvents(id, after),
}));

const { GET } = await import("@/app/api/runs/[id]/events/route");

describe("the route", () => {
  it("passes the id and the raw cursor, and answers the page with its cadence", async () => {
    readRunEvents.mockResolvedValue({ state: "fresh", payload: eventsPage(), etag: null, pollAfterSeconds: 5 });

    const response = await GET(new Request(`http://ui.test/api/runs/${SEEDED_RUN_ID}/events?after=7`), {
      params: Promise.resolve({ id: SEEDED_RUN_ID }),
    });

    expect(readRunEvents).toHaveBeenCalledWith(SEEDED_RUN_ID, "7");
    expect(response.headers.get(POLL_AFTER_HEADER)).toBe("5");
    expect(await response.json()).toEqual(eventsPage());
  });

  it("answers a failure with a 502 naming the transcript", async () => {
    readRunEvents.mockResolvedValue({ state: "failed", reason: "No.", pollAfterSeconds: null });

    const response = await GET(new Request(`http://ui.test/api/runs/${SEEDED_RUN_ID}/events`), {
      params: Promise.resolve({ id: SEEDED_RUN_ID }),
    });

    expect(readRunEvents).toHaveBeenLastCalledWith(SEEDED_RUN_ID, null);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: "run_events_unavailable", message: "No." });
  });
});
