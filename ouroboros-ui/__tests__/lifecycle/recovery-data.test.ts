import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { PURGE_AFTER, lifecycle, pausedLifecycle, pendingDeleteLifecycle } from "../helpers/lifecycle";

/**
 * What the recovery screen reads (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)):
 * an owner's read is the state, and anybody else's refusal is the other half of the answer.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { readRecovery } = await import("@/app/lifecycle/recovery-data");

describe("readRecovery", () => {
  it("draws the screen for an owner, who alone is answered while it is pending deletion", async () => {
    expect(await readRecovery(() => Promise.resolve(pendingDeleteLifecycle()))).toEqual({
      state: "frozen",
      purgeAfter: PURGE_AFTER,
      restorable: true,
    });
  });

  it("draws it for anybody else from the refusal's own details", async () => {
    const refused = () =>
      Promise.reject(
        new ApiError(403, "workspace_pending_delete", "Pending deletion.", {
          purgeAfter: PURGE_AFTER,
          restorable: false,
        }),
      );

    expect(await readRecovery(refused)).toEqual({
      state: "frozen",
      purgeAfter: PURGE_AFTER,
      restorable: false,
    });
  });

  it("claims nothing the refusal did not say", async () => {
    const refused = () =>
      Promise.reject(new ApiError(403, "workspace_pending_delete", "Pending deletion.", {}));

    expect(await readRecovery(refused)).toEqual({ state: "frozen", purgeAfter: null, restorable: false });
  });

  it("has no screen for a workspace that is active or paused", async () => {
    expect(await readRecovery(() => Promise.resolve(lifecycle()))).toEqual({ state: "open" });
    expect(await readRecovery(() => Promise.resolve(pausedLifecycle()))).toEqual({ state: "open" });
  });

  it("reads a 401 as signed out, and lets any other refusal travel", async () => {
    expect(
      await readRecovery(() => Promise.reject(new ApiError(401, "unauthenticated", "Sign in."))),
    ).toEqual({ state: "signed-out" });

    await expect(
      readRecovery(() => Promise.reject(new ApiError(503, "unavailable", "Restarting."))),
    ).rejects.toMatchObject({ status: 503 });
    await expect(readRecovery(() => Promise.reject(new TypeError("fetch failed")))).rejects.toThrow(
      "fetch failed",
    );
  });
});
