import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { PR_514_ID, prPage, summary } from "../helpers/pull-requests";
import { SEEDED_RUN_ID } from "../helpers/runs";

/**
 * The PR verification page's first read and the by-run lookup (#363): found, missing or failed,
 * with an id that is not a uuid never reaching the service — and a lookup that is best-effort.
 * The roadmap's epics are read for the Merge plan card's picker (#369), best-effort too.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { readEpics, readPr, runPullRequests } = await import("@/app/prs/data");

describe("readPr", () => {
  it("finds the page of the PR the id names", async () => {
    const read = vi.fn().mockResolvedValue(prPage());

    expect(await readPr(PR_514_ID, read)).toEqual({ state: "found", value: prPage() });
    expect(read).toHaveBeenCalledExactlyOnceWith(PR_514_ID);
  });

  it("reads another workspace's PR, and an id the service refuses, as missing", async () => {
    for (const refusal of [
      new ApiError(404, "pull_request_not_found", "No."),
      new ApiError(400, "validation_failed", "No."),
    ]) {
      expect(await readPr(PR_514_ID, vi.fn().mockRejectedValue(refusal))).toEqual({
        state: "missing",
      });
    }
  });

  it("reads an id that is not a uuid as missing without calling out", async () => {
    const read = vi.fn();

    for (const id of ["514", "..", `${PR_514_ID}/../x`]) {
      expect(await readPr(id, read)).toEqual({ state: "missing" });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("reads any other refusal as a failure, in the service's words, and rethrows a bug", async () => {
    const down = new ApiError(503, "unavailable", "The database is down.");
    expect(await readPr(PR_514_ID, vi.fn().mockRejectedValue(down))).toEqual({
      state: "failed",
      reason: "The database is down.",
    });

    const bug = new TypeError("x is undefined");
    await expect(readPr(PR_514_ID, vi.fn().mockRejectedValue(bug))).rejects.toBe(bug);
  });
});

describe("runPullRequests", () => {
  /** A run that opened no PR. */
  const OTHER_RUN = "5eed0009-0000-4000-8000-000000000474";

  it("answers each run's PR as its id and number, by run id", async () => {
    const find = vi.fn().mockResolvedValue(new Map([[SEEDED_RUN_ID, summary()]]));

    const found = await runPullRequests([SEEDED_RUN_ID, OTHER_RUN], find);

    expect([...found]).toEqual([[SEEDED_RUN_ID, { id: PR_514_ID, number: 514 }]]);
    expect(find).toHaveBeenCalledExactlyOnceWith([SEEDED_RUN_ID, OTHER_RUN]);
  });

  it("leaves out an id that is not a uuid, and asks nothing when none is left", async () => {
    const find = vi.fn().mockResolvedValue(new Map());

    await runPullRequests(["482", SEEDED_RUN_ID, `${SEEDED_RUN_ID}/pr`], find);
    expect(find).toHaveBeenCalledExactlyOnceWith([SEEDED_RUN_ID]);

    find.mockClear();
    expect((await runPullRequests(["482", ".."], find)).size).toBe(0);
    expect((await runPullRequests([], find)).size).toBe(0);
    expect(find).not.toHaveBeenCalled();
  });

  it("is best-effort: a refused lookup is no PRs, and a bug is rethrown", async () => {
    const down = new ApiError(503, "unavailable", "The database is down.");
    expect((await runPullRequests([SEEDED_RUN_ID], vi.fn().mockRejectedValue(down))).size).toBe(0);

    const bug = new TypeError("x is undefined");
    await expect(
      runPullRequests([SEEDED_RUN_ID], vi.fn().mockRejectedValue(bug)),
    ).rejects.toBe(bug);
  });
});

describe("readEpics (#369)", () => {
  it("answers the roadmap's epics by id and name, top first", async () => {
    const read = vi.fn().mockResolvedValue([
      { id: "5eed001f-0000-4000-8000-000000000001", name: "OTA hardening", tint: "accent" },
      { id: "5eed001f-0000-4000-8000-000000000002", name: "BLE provisioning v2", tint: "model" },
    ]);

    expect(await readEpics(read)).toEqual([
      { id: "5eed001f-0000-4000-8000-000000000001", name: "OTA hardening" },
      { id: "5eed001f-0000-4000-8000-000000000002", name: "BLE provisioning v2" },
    ]);
    expect(read).toHaveBeenCalledOnce();
  });

  it("answers none for a workspace with no roadmap — which is not a roadmap that could not be read", async () => {
    expect(await readEpics(vi.fn().mockResolvedValue([]))).toEqual([]);
  });

  it("is best-effort: a refused read is null, so the page is still drawn, and a bug is rethrown", async () => {
    const down = new ApiError(503, "unavailable", "The database is down.");
    expect(await readEpics(vi.fn().mockRejectedValue(down))).toBeNull();

    const bug = new TypeError("x is undefined");
    await expect(readEpics(vi.fn().mockRejectedValue(bug))).rejects.toBe(bug);
  });
});
