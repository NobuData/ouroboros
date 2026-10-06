import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_DEFAULTS } from "@/app/get-started/defaults-view";

import { REPO, selfHostedDefaults } from "../helpers/onboarding";

/**
 * The right column's poll hop (#394): one read with a deadline, and nothing forwarded for what
 * is not a repository.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { DEFAULTS_REPO_MISSING, DEFAULTS_UNAVAILABLE_CODE, readDefaultsPoll } = await import("@/app/api/defaults-poll");

describe("readDefaultsPoll", () => {
  it("reads the repository with a deadline, and answers the column", async () => {
    const read = vi.fn().mockResolvedValue(selfHostedDefaults());

    expect(await readDefaultsPoll(REPO, read)).toEqual({
      state: "fresh",
      payload: selfHostedDefaults(),
      etag: null,
      pollAfterSeconds: null,
    });
    expect(read.mock.calls[0]![0]).toBe(REPO);
    expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
  });

  it.each([null, undefined, "", "helios-firmware", "a/b/c"])("never forwards %j — it is not a repository", async (repo) => {
    const read = vi.fn();

    expect(await readDefaultsPoll(repo, read)).toEqual({
      state: "failed",
      reason: DEFAULTS_REPO_MISSING,
      pollAfterSeconds: null,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("reads a 401 as gone and a dropped read as unreachable, under this hop's code", async () => {
    expect(await readDefaultsPoll(REPO, vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in.")))).toEqual({
      state: "gone",
    });
    expect(await readDefaultsPoll(REPO, vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toMatchObject({
      state: "failed",
      reason: UNREACHABLE_DEFAULTS,
    });
    expect(DEFAULTS_UNAVAILABLE_CODE).toBe("onboarding_defaults_unavailable");
  });
});
