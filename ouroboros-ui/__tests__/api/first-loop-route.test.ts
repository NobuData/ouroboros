import { beforeEach, describe, expect, it, vi } from "vitest";

import { FIRST_RUN_ID, firstLoop } from "../helpers/first-loop";

/** `GET /api/onboarding/first-loop?run=` (BD.1, #396): the first loop, in the poll family's shape. */

const readFirstLoop = vi.fn();

vi.mock("@/app/api/first-loop", () => ({
  FIRST_LOOP_UNAVAILABLE_CODE: "first_loop_unavailable",
  readFirstLoop: (runId: string | null) => readFirstLoop(runId),
}));

const { GET } = await import("@/app/api/onboarding/first-loop/route");

beforeEach(() => {
  readFirstLoop.mockReset().mockResolvedValue({ state: "fresh", payload: firstLoop(), etag: null, pollAfterSeconds: null });
});

describe("GET /api/onboarding/first-loop", () => {
  it("reads the run the query names and answers the first loop", async () => {
    const response = await GET(new Request(`http://ui.test/api/onboarding/first-loop?run=${FIRST_RUN_ID}`));

    expect(readFirstLoop).toHaveBeenCalledExactlyOnceWith(FIRST_RUN_ID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(firstLoop());
  });

  it("passes a missing run on as missing, and answers a failure under this hop's code", async () => {
    readFirstLoop.mockResolvedValue({ state: "failed", reason: "Name the run.", pollAfterSeconds: null });

    const response = await GET(new Request("http://ui.test/api/onboarding/first-loop"));

    expect(readFirstLoop).toHaveBeenCalledWith(null);
    expect(await response.json()).toMatchObject({ code: "first_loop_unavailable", message: "Name the run." });
  });
});
