import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { HELIOS, corpusOf, emptyDuration, seededCorpus, seededDuration } from "../helpers/analyzer";
import { noMeasurements, seededMeasurements } from "../helpers/analyzer-measurements";
import { SUGGESTION, emptySuggestions, seededSuggestions } from "../helpers/analyzer-suggestions";
import { TICKETS_BATCH_ID, emptyTickets, pushReport, seededBatch, seededTickets } from "../helpers/analyzer-tickets";
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
 * The Build Analyzer facade's duration read (#517), its suggestion operations (#518), the
 * drafted-tickets card's read and push (#519), the measurements read (#520) and the corpus read
 * (#521): each by repository, by suggestion or by batch, naming no workspace, and the service's
 * refusals left as `ApiError`s for the caller to word.
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

describe("the drafted-tickets card (#519)", () => {
  it("asks for the repository's tickets, naming no workspace", async () => {
    const { client, requests } = clientAnswering(seededTickets());

    expect(await analyzer.tickets(HELIOS, client)).toEqual(seededTickets());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/analyzer/tickets?repo=${encodeURIComponent(HELIOS)}`);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.headers.get("x-ouro-tenant")).toBeNull();
  });

  it("answers a repository no analysis has composed a ticket for as an empty card, not an error", async () => {
    const { client } = clientAnswering(emptyTickets());

    expect(await analyzer.tickets(HELIOS, client)).toEqual({ repo: HELIOS, undrafted: [], batches: [] });
  });

  it("carries the poll's deadline to the request", async () => {
    const { client, requests } = clientAnswering(seededTickets());
    const deadline = new AbortController();

    await analyzer.tickets(HELIOS, client, deadline.signal);
    deadline.abort();

    expect(requests[0]?.signal.aborted).toBe(true);
  });

  it("pushes a batch by its id, with no body — what is pushed is what is ticked", async () => {
    const report = pushReport(seededBatch());
    const { client, requests } = clientAnswering(report);

    expect(await analyzer.push(TICKETS_BATCH_ID, client)).toEqual(report);
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/analyzer/batches/${TICKETS_BATCH_ID}/push`);
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.text()).toBe("");
  });

  it("leaves a push in progress, a batch already pushed and a forbidden call as the service's own errors", async () => {
    for (const [status, code] of [
      [409, "push_in_progress"],
      [409, "batch_not_pushable"],
      [403, "forbidden"],
      [404, "analysis_batch_not_found"],
    ] as const) {
      const { client } = clientAnswering({ code, message: "refused", details: {} }, status);

      const error = await analyzer.push(TICKETS_BATCH_ID, client).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status, code });
    }
  });
});

describe("the predicted-vs-measured card (#520)", () => {
  it("asks for the repository's measurements, naming no workspace", async () => {
    const { client, requests } = clientAnswering(seededMeasurements());

    expect(await analyzer.measurements(HELIOS, client)).toEqual(seededMeasurements());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/analyzer/measurements?repo=${encodeURIComponent(HELIOS)}`);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.headers.get("x-ouro-tenant")).toBeNull();
  });

  it("answers a repository nothing was applied in as an empty answer with the formula, not an error", async () => {
    const { client } = clientAnswering(noMeasurements());

    expect(await analyzer.measurements(HELIOS, client)).toMatchObject({ measurements: [], calibration: [] });
    expect((await analyzer.measurements(HELIOS, client)).formula).toMatch(/^factor = /);
  });

  it("carries the poll's deadline to the request", async () => {
    const { client, requests } = clientAnswering(seededMeasurements());
    const deadline = new AbortController();

    await analyzer.measurements(HELIOS, client, deadline.signal);
    deadline.abort();

    expect(requests[0]?.signal.aborted).toBe(true);
  });

  it("leaves a refusal as the service's own error", async () => {
    const { client } = clientAnswering({ code: "analysis_repository_not_found", message: "No such repository." }, 404);

    const error = await analyzer.measurements("acme-robotics/gone", client).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: "analysis_repository_not_found" });
  });
});

describe("the corpus state (#521)", () => {
  it("asks for the repository's corpus, naming no workspace", async () => {
    const { client, requests } = clientAnswering(seededCorpus());

    expect(await analyzer.corpus(HELIOS, client)).toEqual(seededCorpus());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/analyzer/corpus?repo=${encodeURIComponent(HELIOS)}`);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.headers.get("x-ouro-tenant")).toBeNull();
  });

  it("answers a repository with no builds as an empty corpus nothing analysed, not an error", async () => {
    const { client } = clientAnswering(corpusOf([0, 0]));

    expect(await analyzer.corpus(HELIOS, client)).toMatchObject({
      builds: 0,
      daysWithBuilds: 0,
      sufficient: false,
      analyzed: null,
    });
  });

  it("carries the poll's deadline to the request", async () => {
    const { client, requests } = clientAnswering(seededCorpus());
    const deadline = new AbortController();

    await analyzer.corpus(HELIOS, client, deadline.signal);
    deadline.abort();

    expect(requests[0]?.signal.aborted).toBe(true);
  });
});
