import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import type { ResolveThreadEntryRequest } from "@/app/api/pull-requests";
import {
  ACTION_INVALID,
  ACTION_INVALID_CODE,
  ACTION_UNREACHABLE,
  ACTION_UNREACHABLE_CODE,
  MAX_THREAD_REPLY_LENGTH,
  type ThreadResolveRequest,
} from "@/app/prs/outcomes";

import { PR_514_ID, resolution, threadEntry, threadEntryId } from "../helpers/pull-requests";

/**
 * The review thread's server hop (#368). The role gate and whether an entry can be resolved are
 * the service's: this sends only what the dialog could have built — a reply and a flag, never an
 * author — and hands a refusal back as a value the page can draw.
 */

const resolve = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/pull-requests", async (original) => ({
  ...(await original<typeof import("@/app/api/pull-requests")>()),
  pullRequests: {
    resolveThreadEntry: (id: string, entryId: string, request: ResolveThreadEntryRequest) =>
      resolve(id, entryId, request),
  },
}));

const { resolveEntry } = await import("@/app/prs/thread-actions");

/** The refusal made before calling out. */
const REFUSED = { ok: false, status: 422, code: ACTION_INVALID_CODE, reason: ACTION_INVALID };

const ENTRY = threadEntryId(4);

beforeEach(() => {
  resolve.mockReset();
});

describe("Reply & resolve", () => {
  it("sends the reply and the flag, and answers the resolution", async () => {
    const answer = resolution(threadEntry(), "Overflow path fixed.");
    resolve.mockResolvedValue(answer);

    expect(
      await resolveEntry(PR_514_ID, ENTRY, { reply: "Overflow path fixed.", mirror: true }),
    ).toEqual({ ok: true, answer });
    expect(resolve).toHaveBeenCalledWith(PR_514_ID, ENTRY, {
      reply: "Overflow path fixed.",
      mirror: true,
    });
  });

  it("resolves with no reply", async () => {
    resolve.mockResolvedValue(resolution(threadEntry(), null));

    expect((await resolveEntry(PR_514_ID, ENTRY, { mirror: false })).ok).toBe(true);
    expect(resolve).toHaveBeenCalledWith(PR_514_ID, ENTRY, { mirror: false });
  });

  it("takes a reply of exactly the bound, and one of several lines", async () => {
    resolve.mockResolvedValue(resolution(threadEntry(), "x"));

    expect(
      (await resolveEntry(PR_514_ID, ENTRY, { reply: "x".repeat(MAX_THREAD_REPLY_LENGTH), mirror: false }))
        .ok,
    ).toBe(true);
    expect((await resolveEntry(PR_514_ID, ENTRY, { reply: "one\ntwo", mirror: false })).ok).toBe(
      true,
    );
  });

  it("sends nothing but the reply and the flag — no author, kind or watermark", async () => {
    resolve.mockResolvedValue(resolution(threadEntry(), "Fixed."));

    await resolveEntry(PR_514_ID, ENTRY, {
      reply: "Fixed.",
      mirror: false,
      authorKind: "model",
      authorName: "cursor/composer-2",
      simulated: false,
      body: "LGTM",
    } as ThreadResolveRequest);

    expect(resolve).toHaveBeenCalledWith(PR_514_ID, ENTRY, { reply: "Fixed.", mirror: false });
  });

  it("refuses what the dialog could not have built, before calling out", async () => {
    const requests: unknown[] = [
      null,
      "resolve",
      {},
      { reply: "Fixed." },
      { mirror: "yes" },
      { mirror: true },
      { reply: "", mirror: false },
      { reply: " padded ", mirror: false },
      { reply: "x".repeat(MAX_THREAD_REPLY_LENGTH + 1), mirror: false },
      { reply: 7, mirror: false },
    ];

    for (const request of requests) {
      expect(await resolveEntry(PR_514_ID, ENTRY, request as ThreadResolveRequest)).toEqual(
        REFUSED,
      );
    }

    expect(await resolveEntry("514", ENTRY, { mirror: false })).toEqual(REFUSED);
    expect(await resolveEntry(PR_514_ID, "2", { mirror: false })).toEqual(REFUSED);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("hands the service's refusal back in its own words", async () => {
    resolve.mockRejectedValue(
      new ApiError(
        409,
        "pr_thread_entry_resolved",
        "The entry is already resolved — a resolution and its reply are not rewritten.",
      ),
    );

    expect(await resolveEntry(PR_514_ID, ENTRY, { mirror: false })).toEqual({
      ok: false,
      status: 409,
      code: "pr_thread_entry_resolved",
      reason: "The entry is already resolved — a resolution and its reply are not rewritten.",
    });
  });

  it("answers a dropped connection as unreachable", async () => {
    resolve.mockRejectedValue(new TypeError("fetch failed"));

    expect(await resolveEntry(PR_514_ID, ENTRY, { mirror: false })).toEqual({
      ok: false,
      status: 502,
      code: ACTION_UNREACHABLE_CODE,
      reason: ACTION_UNREACHABLE,
    });
  });

  it("lets anything else through — the redirect of an ended session above all", async () => {
    const signal = new Error("NEXT_REDIRECT");
    resolve.mockRejectedValue(signal);

    await expect(resolveEntry(PR_514_ID, ENTRY, { mirror: false })).rejects.toBe(signal);
  });
});
