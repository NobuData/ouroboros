import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_RESOLVED } from "@/app/inbox/resolved-view";

import { resolvedDay } from "../helpers/inbox";

/** The resolved list, read for the `/inbox` page's poll (#468): the rest is `poll-read.ts`'s. */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { INBOX_RESOLVED_UNAVAILABLE_CODE, readInboxResolved } = await import("@/app/api/inbox-resolved");

describe("readInboxResolved", () => {
  it("reads the day asked for, with a deadline, and answers it", async () => {
    const read = vi.fn().mockResolvedValue(resolvedDay({ day: "2026-10-02" }));

    const answer = await readInboxResolved("2026-10-02", read);

    expect(read.mock.calls[0]![0]).toBe("2026-10-02");
    expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
    expect(answer).toEqual({
      state: "fresh",
      payload: resolvedDay({ day: "2026-10-02" }),
      etag: null,
      pollAfterSeconds: null,
    });
  });

  it.each([null, undefined, "", "yesterday", "2026-02-31", "2026-10-02' or 1=1"])(
    "asks for today when the day is %j — never forwarding what is not a date",
    async (day) => {
      const read = vi.fn().mockResolvedValue(resolvedDay());

      await readInboxResolved(day, read);

      expect(read.mock.calls[0]![0]).toBeUndefined();
    },
  );

  it("reads a 401 as gone and a dropped read as unreachable", async () => {
    expect(
      await readInboxResolved(null, vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in."))),
    ).toEqual({ state: "gone" });
    expect(await readInboxResolved(null, vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toEqual({
      state: "failed",
      reason: UNREACHABLE_RESOLVED,
      pollAfterSeconds: null,
    });
  });

  it("reports under this hop's own code", () => {
    expect(INBOX_RESOLVED_UNAVAILABLE_CODE).toBe("inbox_resolved_unavailable");
  });
});
