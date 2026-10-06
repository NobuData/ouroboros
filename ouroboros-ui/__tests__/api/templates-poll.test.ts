import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_TEMPLATES } from "@/app/get-started/templates-view";

import { REPO, seededTiles } from "../helpers/onboarding";

/**
 * The template tiles' poll hop (#392): one read with a deadline, and nothing forwarded for what
 * is not a repository.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { TEMPLATES_REPO_MISSING, TEMPLATES_UNAVAILABLE_CODE, readTemplatesPoll } =
  await import("@/app/api/templates-poll");

describe("readTemplatesPoll", () => {
  it("reads the repository with a deadline, and answers the tiles", async () => {
    const read = vi.fn().mockResolvedValue(seededTiles());

    expect(await readTemplatesPoll(REPO, read)).toEqual({
      state: "fresh",
      payload: seededTiles(),
      etag: null,
      pollAfterSeconds: null,
    });
    expect(read.mock.calls[0]![0]).toBe(REPO);
    expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
  });

  it.each([null, undefined, "", "helios-firmware", "a/b/c"])(
    "never forwards %j — it is not a repository",
    async (repo) => {
      const read = vi.fn();

      expect(await readTemplatesPoll(repo, read)).toEqual({
        state: "failed",
        reason: TEMPLATES_REPO_MISSING,
        pollAfterSeconds: null,
      });
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("reads a 401 as gone and a dropped read as unreachable, under this hop's code", async () => {
    expect(
      await readTemplatesPoll(
        REPO,
        vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in.")),
      ),
    ).toEqual({ state: "gone" });
    expect(
      await readTemplatesPoll(REPO, vi.fn().mockRejectedValue(new TypeError("fetch failed"))),
    ).toMatchObject({
      state: "failed",
      reason: UNREACHABLE_TEMPLATES,
    });
    expect(TEMPLATES_UNAVAILABLE_CODE).toBe("templates_unavailable");
  });
});
