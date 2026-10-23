import { beforeEach, describe, expect, it, vi } from "vitest";

import { READINESS_REPO, readiness } from "../helpers/readiness";

/** `GET /api/loop/readiness` (DK.2, #1319): the preflight the poll names, in the poll family's shape. */

const readLoopReadiness = vi.fn();

vi.mock("@/app/api/loop-readiness", async () => {
  const actual = await vi.importActual<typeof import("@/app/api/loop-readiness")>("@/app/api/loop-readiness");

  return {
    LOOP_READINESS_UNAVAILABLE_CODE: "loop_readiness_unavailable",
    readinessQuery: actual.readinessQuery,
    readLoopReadiness: (query: unknown) => readLoopReadiness(query),
  };
});
vi.mock("server-only", () => ({}));

const { GET } = await import("@/app/api/loop/readiness/route");

beforeEach(() => {
  readLoopReadiness.mockReset().mockResolvedValue({ state: "fresh", payload: readiness(), etag: null, pollAfterSeconds: null });
});

describe("GET /api/loop/readiness", () => {
  it("reads the query the address names and answers the preflight", async () => {
    const response = await GET(
      new Request(`http://ui.test/api/loop/readiness?repository=${encodeURIComponent(READINESS_REPO)}&workflow=quick-fixes&issue=488`),
    );

    expect(readLoopReadiness).toHaveBeenCalledExactlyOnceWith({ repository: READINESS_REPO, workflow: "quick-fixes", issue: 488 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(readiness());
  });

  it("passes a malformed query on as missing, and answers a failure under this hop's code", async () => {
    readLoopReadiness.mockResolvedValue({ state: "failed", reason: "Name the repository.", pollAfterSeconds: null });

    const response = await GET(new Request("http://ui.test/api/loop/readiness?workflow=quick-fixes"));

    expect(readLoopReadiness).toHaveBeenCalledWith(null);
    expect(response.ok).toBe(false);
    expect(await response.json()).toMatchObject({ code: "loop_readiness_unavailable", message: "Name the repository." });
  });
});
