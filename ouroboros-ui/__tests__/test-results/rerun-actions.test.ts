import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import type { RerunScope } from "@/app/api/test-results";
import {
  RERUN_INVALID,
  RERUN_INVALID_CODE,
  RERUN_UNREACHABLE,
  RERUN_UNREACHABLE_CODE,
} from "@/app/test-results/rerun";

import { BUILD_3_ID } from "../helpers/test-results";

/**
 * The re-run's server hop (#335). The role gate is the service's: this sends only a uuid and one
 * of the two scopes, and hands a refusal back as a value the page can draw.
 */

const rerun = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/test-results", async (original) => ({
  ...(await original<typeof import("@/app/api/test-results")>()),
  testResults: { rerun: (id: string, scope: RerunScope) => rerun(id, scope) },
}));

const { requestRerun } = await import("@/app/test-results/rerun-actions");

beforeEach(() => {
  rerun.mockReset();
});

describe("requestRerun", () => {
  it("queues the scope asked for and returns the service's answer", async () => {
    const queued = { testRunId: BUILD_3_ID, scope: "failed", queueState: "offered" };
    rerun.mockResolvedValue(queued);

    expect(await requestRerun(BUILD_3_ID, "failed")).toEqual({ ok: true, rerun: queued });
    expect(rerun).toHaveBeenCalledExactlyOnceWith(BUILD_3_ID, "failed");
  });

  it("refuses an id that is not a uuid, and a scope that is not one of two, before calling out", async () => {
    const refused = { ok: false, status: 422, code: RERUN_INVALID_CODE, reason: RERUN_INVALID };

    expect(await requestRerun("..", "failed")).toEqual(refused);
    expect(await requestRerun(BUILD_3_ID, "everything" as RerunScope)).toEqual(refused);
    expect(rerun).not.toHaveBeenCalled();
  });

  it("hands the service's refusal back in its own words — a viewer's 403 included", async () => {
    rerun.mockRejectedValue(new ApiError(403, "forbidden", "A viewer may not start a build."));

    expect(await requestRerun(BUILD_3_ID, "full")).toEqual({
      ok: false,
      status: 403,
      code: "forbidden",
      reason: "A viewer may not start a build.",
    });
  });

  it("says a dropped connection as unreachable, and rethrows anything else", async () => {
    rerun.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await requestRerun(BUILD_3_ID, "failed")).toEqual({
      ok: false,
      status: 502,
      code: RERUN_UNREACHABLE_CODE,
      reason: RERUN_UNREACHABLE,
    });

    const redirect = new Error("NEXT_REDIRECT");
    rerun.mockRejectedValueOnce(redirect);
    await expect(requestRerun(BUILD_3_ID, "failed")).rejects.toBe(redirect);
  });
});
