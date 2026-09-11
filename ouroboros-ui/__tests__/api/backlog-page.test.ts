import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_BACKLOG } from "@/app/issues/backlog-poll";

import { SEEDED_SYNCED_AT, backlogListing, syncStatus } from "../helpers/issues";

/**
 * One page of the backlog, read for the table's poll (#117), with the sync's status beside it
 * (#120).
 *
 * The server's half of the poll: it answers in the loop's four cases and never throws, because
 * a route handler answering a poll has nobody behind it to catch anything. The two reads are the
 * seams — what the typed client would have done is `backlog.test.ts`'s — so each case is one
 * outcome in and one answer out. The status is the one read that may fail on its own: the rows
 * are still the rows, and its refusal is a reason inside the page rather than a failed page.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { BACKLOG_TIMEOUT_MS, readBacklogPage } = await import("@/app/api/backlog-page");

const QUERY = { state: "open" as const, sort: "effort" as const, limit: 25, offset: 25 };

/** The status the seeded workspace reads between cycles. */
const STATUS = syncStatus({ running: false, syncedAt: SEEDED_SYNCED_AT });

/** How one seam answers: with a value, or by rejecting with something. */
type Outcome = { readonly resolves: unknown } | { readonly rejects: unknown };

/**
 * A seam that answers one way.
 *
 * Tagged rather than sniffed, because a jsdom `DOMException` — the deadline's own signal — is not
 * an `Error` there, and a seam that resolved with it would be a read that answered.
 *
 * @param outcome How it answers.
 * @returns The mock.
 */
function seam(outcome: Outcome) {
  return vi
    .fn()
    .mockImplementation(() =>
      "rejects" in outcome ? Promise.reject(outcome.rejects) : Promise.resolve(outcome.resolves),
    );
}

/**
 * The two seams, each answering one way.
 *
 * @param listing How the listing read answers.
 * @param status How the status read answers. Defaults to the seeded status.
 * @returns The reads, and the mocks behind them.
 */
function reads(listing: Outcome, status: Outcome = { resolves: STATUS }) {
  const list = seam(listing);
  const read = seam(status);

  return { list, read, seams: { listing: list, status: read } };
}

describe("readBacklogPage", () => {
  it("hands both reads the deadline, the listing its query unchanged, and answers fresh with the page", async () => {
    const { list, read, seams } = reads({ resolves: backlogListing() });

    const answer = await readBacklogPage(QUERY, seams);

    expect(list).toHaveBeenCalledOnce();
    expect(list.mock.calls[0]![0]).toEqual(QUERY);
    expect(list.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]![0]).toBe(list.mock.calls[0]![1]);
    expect(answer).toEqual({
      state: "fresh",
      payload: { listing: backlogListing(), sync: { ok: true, value: STATUS } },
      etag: null,
      pollAfterSeconds: null,
    });
  });

  it("keeps its deadline inside the poll's cadence", () => {
    expect(BACKLOG_TIMEOUT_MS).toBeLessThan(15_000);
  });

  it("reads a 401 as the session being gone, rather than redirecting", async () => {
    const { seams } = reads({ rejects: new ApiError(401, "unauthenticated", "Sign in.") });

    expect(await readBacklogPage(QUERY, seams)).toEqual({ state: "gone" });
  });

  it("carries the service's own sentence for any other refusal of the listing", async () => {
    const { seams } = reads({
      rejects: new ApiError(503, "unavailable", "The database is not answering."),
    });

    expect(await readBacklogPage(QUERY, seams)).toEqual({
      state: "failed",
      reason: "The database is not answering.",
      pollAfterSeconds: null,
    });
  });

  it("says unreachable for a read that never reached the service — a dropped connection, the deadline", async () => {
    for (const failure of [new TypeError("fetch failed"), new DOMException("timed out", "TimeoutError")]) {
      const { seams } = reads({ rejects: failure });

      expect(await readBacklogPage(QUERY, seams)).toEqual({
        state: "failed",
        reason: UNREACHABLE_BACKLOG,
        pollAfterSeconds: null,
      });
    }
  });

  describe("the status failing on its own (#120)", () => {
    it("keeps the service's refusal as the page's reason for it, and the rows as the rows", async () => {
      const { seams } = reads(
        { resolves: backlogListing() },
        { rejects: new ApiError(503, "unavailable", "Not now.") },
      );

      expect(await readBacklogPage(QUERY, seams)).toEqual({
        state: "fresh",
        payload: { listing: backlogListing(), sync: { ok: false, reason: "Not now." } },
        etag: null,
        pollAfterSeconds: null,
      });
    });

    it("reads the session ending on the status as gone, not as a status that could not be read", async () => {
      const { seams } = reads(
        { resolves: backlogListing() },
        { rejects: new ApiError(401, "unauthenticated", "Sign in.") },
      );

      expect(await readBacklogPage(QUERY, seams)).toEqual({ state: "gone" });
    });

    it("fails the page when the status never reached the service, since the listing will not have either", async () => {
      const { seams } = reads(
        { resolves: backlogListing() },
        { rejects: new DOMException("timed out", "TimeoutError") },
      );

      expect(await readBacklogPage(QUERY, seams)).toEqual({
        state: "failed",
        reason: UNREACHABLE_BACKLOG,
        pollAfterSeconds: null,
      });
    });
  });
});
