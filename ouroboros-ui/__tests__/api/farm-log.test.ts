import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { BAD_LOG_OFFSET, UNREACHABLE_LOG } from "@/app/farm/log-poll";

import { LIVE_JOB_ID, buildLog } from "../helpers/farm";

/**
 * One page of a build's log, read for the live card's stream (#261): the translation is
 * `poll-read.ts`'s, and what is this reader's own is that the cadence is the *page's* — two
 * seconds while the build runs, fifteen after — and that an `after` which is not an offset is
 * refused without a read.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { FARM_LOG_UNAVAILABLE_CODE, readFarmLog } = await import("@/app/api/farm-log");

describe("readFarmLog", () => {
  it("reads the job from the offset asked for, under a deadline", async () => {
    const read = vi.fn().mockResolvedValue(buildLog("abc", { offset: 18_122 }));

    await readFarmLog(LIVE_JOB_ID, "18122", read);

    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![0]).toBe(LIVE_JOB_ID);
    expect(read.mock.calls[0]![1]).toBe(18_122);
    expect(read.mock.calls[0]![2]).toBeInstanceOf(AbortSignal);
  });

  it("reads from the start when the address carried no offset", async () => {
    const read = vi.fn().mockResolvedValue(buildLog());

    await readFarmLog(LIVE_JOB_ID, null, read);

    expect(read.mock.calls[0]![1]).toBe(0);
  });

  it("answers the page with its own cadence — two seconds live, fifteen finished", async () => {
    const live = buildLog("abc");
    const done = buildLog("abc", { live: false, pollAfter: 15 });

    expect(await readFarmLog(LIVE_JOB_ID, "0", vi.fn().mockResolvedValue(live))).toEqual({
      state: "fresh",
      payload: live,
      etag: null,
      pollAfterSeconds: 2,
    });
    expect(await readFarmLog(LIVE_JOB_ID, "0", vi.fn().mockResolvedValue(done))).toMatchObject({
      pollAfterSeconds: 15,
    });
  });

  it("refuses an offset that is not one without asking the service anything", async () => {
    const read = vi.fn();

    for (const after of ["-1", "abc", "1.5", "1e3"]) {
      expect(await readFarmLog(LIVE_JOB_ID, after, read)).toEqual({
        state: "failed",
        reason: BAD_LOG_OFFSET,
        pollAfterSeconds: null,
      });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("reads a 401 as gone, a refusal as the service's sentence, and a dropped read as unreachable", async () => {
    const refusing = (error: unknown) => vi.fn().mockRejectedValue(error);

    expect(await readFarmLog(LIVE_JOB_ID, "0", refusing(new ApiError(401, "unauthenticated", "Sign in.")))).toEqual({
      state: "gone",
    });
    expect(
      await readFarmLog(LIVE_JOB_ID, "0", refusing(new ApiError(404, "farm_job_not_found", "No such build job."))),
    ).toEqual({ state: "failed", reason: "No such build job.", pollAfterSeconds: null });
    expect(await readFarmLog(LIVE_JOB_ID, "0", refusing(new TypeError("fetch failed")))).toEqual({
      state: "failed",
      reason: UNREACHABLE_LOG,
      pollAfterSeconds: null,
    });
  });

  it("reports under this hop's own code", () => {
    expect(FARM_LOG_UNAVAILABLE_CODE).toBe("farm_log_unavailable");
  });
});
