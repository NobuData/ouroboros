import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { RUNNING_POLL_SECONDS, UNREACHABLE_ANALYZER } from "@/app/analyzer/analyzer-poll";

import { HELIOS, analyzerPage, freshPage, runningRun } from "../helpers/analyzer";

/**
 * The analyzer page, read for the screen's poll (#516) — and its hop, `GET /api/analyzer`: two
 * reads under the poll family's deadline, polled fast while a run is in flight.
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
