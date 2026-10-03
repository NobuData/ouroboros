import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { RUNNING_POLL_SECONDS, UNREACHABLE_ANALYZER } from "@/app/analyzer/analyzer-poll";

import {
  HELIOS,
  analyzerPage,
  freshPage,
  runningRun,
  seededDuration,
  seededRun,
  seededSchedule,
} from "../helpers/analyzer";
import { seededSuggestions } from "../helpers/analyzer-suggestions";
import { seededBatch, seededTickets, ticketsWith } from "../helpers/analyzer-tickets";

/**
 * The analyzer page, read for the screen's poll (#516) — and its hop, `GET /api/analyzer`: five
 * reads (the run, the schedule, since #517 the duration chart, since #518 the suggestion cards and
 * since #519 the drafted-tickets card) under the poll family's deadline, polled fast while a run
 * is in flight or a drafted batch is still being sized.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { ANALYZER_UNAVAILABLE_CODE, readAnalyzerPage } = await import("@/app/api/analyzer-page");

describe("readAnalyzerPage", () => {
  it("reads the repository it was asked for, with a deadline, at the family's interval when idle", async () => {
    const read = vi.fn().mockResolvedValue(analyzerPage());

    const answer = await readAnalyzerPage(HELIOS, read);

    expect(read.mock.calls[0]![0]).toBe(HELIOS);
    expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
    expect(answer).toEqual(freshPage());
  });

  it("asks to be polled every few seconds while a run is in flight, so progress ticks", async () => {
    const answer = await readAnalyzerPage(HELIOS, vi.fn().mockResolvedValue(analyzerPage({ run: runningRun() })));

    expect(answer).toMatchObject({ state: "fresh", pollAfterSeconds: RUNNING_POLL_SECONDS });
  });

  it("asks as often while a drafted batch is still being sized, so `sizing…` turns into chips (#519)", async () => {
    const sizing = ticketsWith(seededBatch((draft) => (draft.localKey === "BA-2" ? { estimate: null } : undefined)));

    expect(await readAnalyzerPage(HELIOS, vi.fn().mockResolvedValue(analyzerPage({ tickets: sizing })))).toMatchObject({
      state: "fresh",
      pollAfterSeconds: RUNNING_POLL_SECONDS,
    });
  });

  it("goes back to the family's interval once every draft is sized, and for a batch that will never be", async () => {
    // Auto-size off: nothing will size it, so nothing is waited for.
    const unsized = ticketsWith(seededBatch(() => ({ estimate: null }), { autoSize: false }));

    for (const tickets of [seededTickets(), unsized]) {
      expect(await readAnalyzerPage(HELIOS, vi.fn().mockResolvedValue(analyzerPage({ tickets })))).toMatchObject({
        state: "fresh",
        pollAfterSeconds: null,
      });
    }
  });

  it("reads a 401 as gone, a refusal as the service's sentence, and a dropped read as unreachable", async () => {
    expect(await readAnalyzerPage(HELIOS, vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in.")))).toEqual({
      state: "gone",
    });
    expect(
      await readAnalyzerPage(
        HELIOS,
        vi.fn().mockRejectedValue(new ApiError(404, "analysis_repository_not_found", "No such repository.")),
      ),
    ).toEqual({ state: "failed", reason: "No such repository.", pollAfterSeconds: null });
    expect(await readAnalyzerPage(HELIOS, vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toEqual({
      state: "failed",
      reason: UNREACHABLE_ANALYZER,
      pollAfterSeconds: null,
    });
  });

  it("reports under this hop's own code", () => {
    expect(ANALYZER_UNAVAILABLE_CODE).toBe("analyzer_unavailable");
  });
});

describe("the page's own read", () => {
  const latest = vi.fn();
  const schedule = vi.fn();
  const duration = vi.fn();
  const suggestions = vi.fn();
  const tickets = vi.fn();
  const CLIENT = { name: "the anonymous client" };

  beforeEach(() => {
    vi.resetModules();
    latest.mockReset().mockResolvedValue(seededRun());
    schedule.mockReset().mockResolvedValue(seededSchedule());
    duration.mockReset().mockResolvedValue(seededDuration());
    suggestions.mockReset().mockResolvedValue(seededSuggestions());
    tickets.mockReset().mockResolvedValue(seededTickets());
    vi.doMock("@/app/api/analyzer", () => ({ analyzer: { latest, schedule, duration, suggestions, tickets } }));
    vi.doMock("@/app/api/server", () => ({ anonymousApi: () => CLIENT }));
  });

  afterEach(() => {
    vi.doUnmock("@/app/api/analyzer");
    vi.doUnmock("@/app/api/server");
  });

  it("makes the run, schedule, duration, suggestion and ticket reads together, through one client, under the deadline", async () => {
    const page = await import("@/app/api/analyzer-page");

    const answer = await page.readAnalyzerPage(HELIOS);

    expect(answer).toEqual(freshPage());
    for (const read of [latest, schedule, duration, suggestions, tickets]) {
      expect(read).toHaveBeenCalledExactlyOnceWith(HELIOS, CLIENT, expect.any(AbortSignal));
    }
  });

  it("fails the whole page when the suggestion cards cannot be read, rather than drawing half of it", async () => {
    suggestions.mockRejectedValue(new TypeError("fetch failed"));
    const page = await import("@/app/api/analyzer-page");

    expect(await page.readAnalyzerPage(HELIOS)).toEqual({
      state: "failed",
      reason: UNREACHABLE_ANALYZER,
      pollAfterSeconds: null,
    });
  });

  it("fails the whole page when the drafted tickets cannot be read, rather than drawing half of it", async () => {
    tickets.mockRejectedValue(new TypeError("fetch failed"));
    const page = await import("@/app/api/analyzer-page");

    expect(await page.readAnalyzerPage(HELIOS)).toEqual({
      state: "failed",
      reason: UNREACHABLE_ANALYZER,
      pollAfterSeconds: null,
    });
  });

  it("fails the whole page when the duration chart cannot be read, rather than drawing half of it", async () => {
    duration.mockRejectedValue(new TypeError("fetch failed"));
    const page = await import("@/app/api/analyzer-page");

    expect(await page.readAnalyzerPage(HELIOS)).toEqual({
      state: "failed",
      reason: UNREACHABLE_ANALYZER,
      pollAfterSeconds: null,
    });
  });
});

describe("GET /api/analyzer", () => {
  const read = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    read.mockReset().mockResolvedValue(freshPage());
    vi.doMock("@/app/api/analyzer-page", () => ({
      ANALYZER_UNAVAILABLE_CODE: "analyzer_unavailable",
      readAnalyzerPage: (repo: string) => read(repo),
    }));
  });

  it("reads the repository the poll names and answers the page", async () => {
    const { GET } = await import("@/app/api/analyzer/route");

    const response = await GET(new Request("http://ui.test/api/analyzer?repo=acme-robotics%2Fhelios-firmware"));

    expect(read).toHaveBeenCalledExactlyOnceWith(HELIOS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(analyzerPage());
  });

  it("refuses a poll naming no repository, without asking the service", async () => {
    const { GET } = await import("@/app/api/analyzer/route");

    const response = await GET(new Request("http://ui.test/api/analyzer"));

    expect(response.status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });

  it("answers a failure under this hop's code", async () => {
    read.mockResolvedValue({ state: "failed", reason: "No such repository.", pollAfterSeconds: null });
    const { GET } = await import("@/app/api/analyzer/route");

    const response = await GET(new Request("http://ui.test/api/analyzer?repo=a%2Fb"));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: "analyzer_unavailable", message: "No such repository." });
  });
});
