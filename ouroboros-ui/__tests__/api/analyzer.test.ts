import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { HELIOS, emptyDuration, seededDuration } from "../helpers/analyzer";
import { STUB_BASE_URL, clientAnswering } from "../helpers/api";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { analyzer } = await import("@/app/api/analyzer");

/**
 * The Build Analyzer facade's duration read (#517): the series and its change-points by
 * repository, naming no workspace, and the service's refusals left as `ApiError`s.
 */

describe("analyzer.duration", () => {
  it("asks for the repository's chart, naming no workspace", async () => {
    const { client, requests } = clientAnswering(seededDuration());

    expect(await analyzer.duration(HELIOS, client)).toEqual(seededDuration());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/analyzer/duration?repo=${encodeURIComponent(HELIOS)}`);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.headers.get("x-ouro-tenant")).toBeNull();
  });

  it("answers a repository no run has analysed as an empty chart, not an error", async () => {
    const { client } = clientAnswering(emptyDuration());

    expect(await analyzer.duration(HELIOS, client)).toMatchObject({ runId: null, series: [], changePoints: [] });
  });

  it("carries the poll's deadline to the request", async () => {
    const { client, requests } = clientAnswering(seededDuration());
    const deadline = new AbortController();

    await analyzer.duration(HELIOS, client, deadline.signal);
    deadline.abort();

    expect(requests[0]?.signal.aborted).toBe(true);
  });

  it("leaves a refusal as the service's own error", async () => {
    const { client } = clientAnswering({ code: "validation_failed", message: "repo must be owner/name", details: {} }, 422);

    const error = await analyzer.duration("nope", client).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: "validation_failed" });
  });
});
