import { type Mock, describe, expect, it, vi } from "vitest";

import type { FirstLoopReads } from "@/app/api/first-loop";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_FIRST_LOOP } from "@/app/get-started/first-loop-view";

import { DRY_RUN_ON, FIRST_RUN_ID, firstConsole, firstPullRequest } from "../helpers/first-loop";
import { runControl } from "../helpers/runs";

/** The first loop's hop (BD.1, #396): four reads under the session, composed. */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { FIRST_LOOP_RUN_MISSING, FIRST_LOOP_UNAVAILABLE_CODE, budgetOf, readFirstLoop } = await import("@/app/api/first-loop");

/** The reads, each a mock. */
interface MockReads {
  readonly console: Mock<FirstLoopReads["console"]>;
  readonly pullRequests: Mock<FirstLoopReads["pullRequests"]>;
  readonly controls: Mock<FirstLoopReads["controls"]>;
  readonly dryRun: Mock<FirstLoopReads["dryRun"]>;
}

/** Reads that answer the seeded first loop, each a mock a case may replace. */
function reads(over: Partial<MockReads> = {}): MockReads {
  return {
    console: vi.fn<FirstLoopReads["console"]>().mockResolvedValue(firstConsole()),
    pullRequests: vi
      .fn<FirstLoopReads["pullRequests"]>()
      .mockResolvedValue(new Map([[FIRST_RUN_ID, firstPullRequest()]])),
    controls: vi.fn<FirstLoopReads["controls"]>().mockResolvedValue({ controls: [] }),
    dryRun: vi.fn<FirstLoopReads["dryRun"]>().mockResolvedValue(DRY_RUN_ON),
    ...over,
  };
}

describe("readFirstLoop", () => {
  it("composes the console, the run's PR, the budget and dry-run", async () => {
    const asked = reads();

    expect(await readFirstLoop(FIRST_RUN_ID, asked)).toEqual({
      state: "fresh",
      payload: { console: firstConsole(), pullRequest: firstPullRequest(), budget: null, dryRun: DRY_RUN_ON },
      etag: null,
      pollAfterSeconds: null,
    });
    expect(asked.console.mock.calls[0]![0]).toBe(FIRST_RUN_ID);
    expect(asked.pullRequests).toHaveBeenCalledWith(FIRST_RUN_ID);
  });

  it("answers no PR while the run has none, and survives a controls or policy read that fails", async () => {
    const answer = await readFirstLoop(
      FIRST_RUN_ID,
      reads({
        pullRequests: vi.fn<FirstLoopReads["pullRequests"]>().mockResolvedValue(new Map()),
        controls: vi.fn<FirstLoopReads["controls"]>().mockRejectedValue(new TypeError("fetch failed")),
        dryRun: vi.fn<FirstLoopReads["dryRun"]>().mockRejectedValue(new ApiError(403, "forbidden", "No.")),
      }),
    );

    expect(answer).toMatchObject({ state: "fresh", payload: { pullRequest: null, budget: null, dryRun: null } });
  });

  it("forwards nothing for a missing or malformed run id", async () => {
    const asked = reads();

    for (const runId of [null, "", "not-a-uuid"]) {
      expect(await readFirstLoop(runId, asked)).toEqual({ state: "failed", reason: FIRST_LOOP_RUN_MISSING, pollAfterSeconds: null });
    }
    expect(asked.console).not.toHaveBeenCalled();
  });

  it("reads a dropped console read as unreachable, under this hop's code", async () => {
    expect(await readFirstLoop(FIRST_RUN_ID, reads({ console: vi.fn<FirstLoopReads["console"]>().mockRejectedValue(new TypeError("fetch failed")) }))).toMatchObject({
      state: "failed",
      reason: UNREACHABLE_FIRST_LOOP,
    });
    expect(FIRST_LOOP_UNAVAILABLE_CODE).toBe("first_loop_unavailable");
  });
});

describe("budgetOf", () => {
  it("names the limit a system abort filed, and nothing for any other control", () => {
    expect(budgetOf({ controls: [runControl({ kind: "abort", detail: "cost_cap_exceeded" })] })).toBe("cost_cap");
    expect(budgetOf({ controls: [runControl({ kind: "abort", detail: "token_budget_exceeded" })] })).toBe("token_budget");
    expect(budgetOf({ controls: [runControl({ kind: "abort", detail: "operator" }), runControl({ kind: "pause" })] })).toBeNull();
    expect(budgetOf({ controls: [] })).toBeNull();
  });
});
