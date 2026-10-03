import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { HELIOS, emptyDuration, seededDuration } from "../helpers/analyzer";
import { SUGGESTION, emptySuggestions, seededSuggestions } from "../helpers/analyzer-suggestions";
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
 * The Build Analyzer facade's duration read (#517) and its suggestion operations (#518): each by
 * repository or by suggestion, naming no workspace, and the service's refusals left as
 * `ApiError`s for the caller to word.
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

describe("analyzer.suggestions", () => {
  it("asks for the repository's suggestion cards, naming no workspace", async () => {
    const { client, requests } = clientAnswering(seededSuggestions());

    expect(await analyzer.suggestions(HELIOS, client)).toEqual(seededSuggestions());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/analyzer/suggestions?repo=${encodeURIComponent(HELIOS)}`);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.headers.get("x-ouro-tenant")).toBeNull();
  });

  it("answers a repository no analysis has composed for as no suggestions, not an error", async () => {
    const { client } = clientAnswering(emptySuggestions());

    expect(await analyzer.suggestions(HELIOS, client)).toMatchObject({ runId: null, suggestions: [] });
  });

  it("carries the poll's deadline to the request", async () => {
    const { client, requests } = clientAnswering(seededSuggestions());
    const deadline = new AbortController();

    await analyzer.suggestions(HELIOS, client, deadline.signal);
    deadline.abort();

    expect(requests[0]?.signal.aborted).toBe(true);
  });
});

describe("what a suggestion may be done with", () => {
  const FINGERPRINT = `sha256:${"4f".repeat(32)}`;

  it("reads a preview by the suggestion's id — a read, with no body", async () => {
    const { client, requests } = clientAnswering({ suggestionId: SUGGESTION.move, fingerprint: FINGERPRINT });

    await analyzer.preview(SUGGESTION.move, client);

    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/analyzer/suggestions/${SUGGESTION.move}/preview`);
    expect(requests[0]?.method).toBe("GET");
  });

  it("applies with the fingerprint of the preview that was read", async () => {
    const { client, requests } = clientAnswering({ suggestion: { id: SUGGESTION.move, status: "applied" } });

    await analyzer.apply(SUGGESTION.move, FINGERPRINT, client);

    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/analyzer/suggestions/${SUGGESTION.move}/apply`);
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.json()).toEqual({ fingerprint: FINGERPRINT });
  });

  it("dismisses with the reason, and with an empty body when none was given", async () => {
    const { client, requests } = clientAnswering({ id: SUGGESTION.flake, status: "dismissed" });

    await analyzer.dismiss(SUGGESTION.flake, "The suite is being rewritten.", client);
    await analyzer.dismiss(SUGGESTION.flake, undefined, client);

    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/analyzer/suggestions/${SUGGESTION.flake}/dismiss`);
    expect(await requests[0]?.json()).toEqual({ reason: "The suite is being rewritten." });
    expect(await requests[1]?.json()).toEqual({});
  });

  it("drafts the named suggestions for the target tracker, in order", async () => {
    const { client, requests } = clientAnswering({ batch: { id: "b", drafts: [] }, suggestionIds: [SUGGESTION.link] }, 201);
    const source = "5eed0005-0000-4000-8000-000000000001";

    await analyzer.draft([SUGGESTION.link], source, client);

    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/analyzer/suggestions/draft`);
    expect(await requests[0]?.json()).toEqual({ suggestionIds: [SUGGESTION.link], targetSourceId: source });
  });

  it("leaves a stale preview, a resolved suggestion and a forbidden call as the service's own errors", async () => {
    for (const [status, code] of [
      [409, "analysis_preview_stale"],
      [409, "analysis_suggestion_resolved"],
      [403, "forbidden"],
    ] as const) {
      const { client } = clientAnswering({ code, message: "refused", details: {} }, status);

      const error = await analyzer.apply(SUGGESTION.move, FINGERPRINT, client).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status, code });
    }
  });
});
