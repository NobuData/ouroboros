import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_LIFECYCLE } from "@/app/lifecycle/banner";

import { PURGE_AFTER, pausedLifecycle } from "../helpers/lifecycle";

/**
 * The lifecycle read behind the shell's poll (BS.6,
 * [#496](https://github.com/NobuData/ouroboros/issues/496)): the read with a deadline, a `401` as
 * gone — and the frozen refusal passed on as the state it describes rather than as a failure.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { LIFECYCLE_UNAVAILABLE_CODE, frozenLifecycle, readLifecyclePoll } = await import(
  "@/app/api/settings-lifecycle-poll"
);

describe("readLifecyclePoll", () => {
  it("reads with a deadline, and answers the lifecycle", async () => {
    const read = vi.fn().mockResolvedValue(pausedLifecycle());

    expect(await readLifecyclePoll(read)).toEqual({
      state: "fresh",
      payload: pausedLifecycle(),
      etag: null,
      pollAfterSeconds: null,
    });
    expect(read.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);
  });

  it("answers pending_delete for the frozen refusal, whoever was refused", async () => {
    const read = vi.fn().mockRejectedValue(
      new ApiError(403, "workspace_pending_delete", "This workspace is pending deletion.", {
        purgeAfter: PURGE_AFTER,
        restorable: false,
      }),
    );

    expect(await readLifecyclePoll(read)).toMatchObject({
      state: "fresh",
      payload: { state: "pending_delete", purgeAfter: PURGE_AFTER, banner: null },
    });
  });

  it("reads a 401 as gone, another refusal as its sentence, and a dropped read as unreachable", async () => {
    expect(
      await readLifecyclePoll(vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in."))),
    ).toEqual({ state: "gone" });
    expect(
      await readLifecyclePoll(
        vi.fn().mockRejectedValue(new ApiError(400, "organization_required", "Choose a workspace.")),
      ),
    ).toEqual({ state: "failed", reason: "Choose a workspace.", pollAfterSeconds: null });
    // The same code as a 409 is the dispatch points' hold, not a frozen surface.
    expect(
      await readLifecyclePoll(
        vi.fn().mockRejectedValue(new ApiError(409, "workspace_pending_delete", "Nothing new starts.")),
      ),
    ).toMatchObject({ state: "failed", reason: "Nothing new starts." });
    expect(await readLifecyclePoll(vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toEqual({
      state: "failed",
      reason: UNREACHABLE_LIFECYCLE,
      pollAfterSeconds: null,
    });
  });

  it("reports under this hop's own code", () => {
    expect(LIFECYCLE_UNAVAILABLE_CODE).toBe("lifecycle_unavailable");
  });
});

describe("frozenLifecycle", () => {
  it("carries only what the refusal said", () => {
    expect(frozenLifecycle({ purgeAfter: PURGE_AFTER, restorable: false })).toEqual({
      state: "pending_delete",
      changedAt: null,
      changedBy: null,
      purgeAfter: PURGE_AFTER,
      recoveryWindowDays: 30,
      banner: null,
    });
    expect(frozenLifecycle({ purgeAfter: 12 }).purgeAfter).toBeNull();
    expect(frozenLifecycle(undefined).purgeAfter).toBeNull();
  });
});
