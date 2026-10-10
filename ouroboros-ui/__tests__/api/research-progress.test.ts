import { describe, expect, it, vi } from "vitest";

import { CACHE_CONTROL } from "@/app/api/poll-response";

import { STARTED_ID } from "../helpers/research";

/**
 * An investigation's progress stream, passed through to the browser (#628): the bytes stream
 * straight through under the protocol's headers, the session goes with the request, the browser's
 * leaving ends the service's stream, and a refusal keeps the service's status and words.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const {
  INVESTIGATION_ID_INVALID,
  INVESTIGATION_ID_INVALID_CODE,
  PROGRESS_UNAVAILABLE_CODE,
  SSE_MEDIA_TYPE,
  STREAM_HEADERS,
  UNREACHABLE_PROGRESS,
  isInvestigationId,
  progressPath,
  readInvestigationProgress,
} = await import("@/app/api/research-progress");

/** The service's address in these cases. */
const BASE = "http://rest.test";

/** Two events, as the service frames them. */
const EVENTS = 'event: progress\ndata: {"kind":"progress","status":"running","sources":3}\n\nevent: done\ndata: {"kind":"done","status":"brief_ready","sources":44}\n\n';

/**
 * A fetch answering one response, remembering what it was asked.
 *
 * @param response What to answer.
 * @returns The stub.
 */
function answering(response: Response) {
  return vi.fn<typeof fetch>(() => Promise.resolve(response));
}

/** A streamed service answer. */
function stream(): Response {
  return new Response(EVENTS, {
    status: 200,
    headers: { "Content-Type": `${SSE_MEDIA_TYPE}; charset=utf-8`, "X-Powered-By": "Express" },
  });
}

describe("isInvestigationId", () => {
  it("accepts a uuid and nothing else", () => {
    expect(isInvestigationId(STARTED_ID)).toBe(true);
    expect(isInvestigationId(STARTED_ID.toUpperCase())).toBe(true);
    for (const value of ["", "RS-128", `${STARTED_ID}/..`, ` ${STARTED_ID}`, null, 7]) {
      expect(isInvestigationId(value)).toBe(false);
    }
  });
});

describe("progressPath", () => {
  it("is the service's stream route, the id encoded", () => {
    expect(progressPath(STARTED_ID)).toBe(`/api/v1/research/investigations/${STARTED_ID}/progress`);
  });
});

describe("readInvestigationProgress", () => {
  it("refuses an id that is not a uuid before calling out", async () => {
    const fetcher = answering(stream());

    const response = await readInvestigationProgress("RS-128", { fetcher, baseUrl: BASE });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code: INVESTIGATION_ID_INVALID_CODE, message: INVESTIGATION_ID_INVALID });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("asks the service for the stream over the visitor's session, and streams it back", async () => {
    const fetcher = answering(stream());

    const response = await readInvestigationProgress(STARTED_ID, {
      fetcher,
      baseUrl: BASE,
      cookie: () => Promise.resolve("better-auth.session_token=abc"),
    });

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${BASE}${progressPath(STARTED_ID)}`);
    expect((init?.headers as Record<string, string>).Cookie).toBe("better-auth.session_token=abc");
    expect((init?.headers as Record<string, string>).Accept).toBe(SSE_MEDIA_TYPE);
    expect(init?.cache).toBe("no-store");

    expect(response.status).toBe(200);
    for (const [name, value] of Object.entries(STREAM_HEADERS)) expect(response.headers.get(name)).toBe(value);
    expect(response.headers.get("X-Powered-By")).toBeNull();
    expect(await response.text()).toBe(EVENTS);
  });

  it("sends no cookie header when the visitor has no session", async () => {
    const fetcher = answering(stream());

    await readInvestigationProgress(STARTED_ID, { fetcher, baseUrl: BASE, cookie: () => Promise.resolve(undefined) });

    expect((fetcher.mock.calls[0]![1]?.headers as Record<string, string>).Cookie).toBeUndefined();
  });

  it("ends the service's stream when the browser leaves", async () => {
    const fetcher = answering(stream());
    const leaving = new AbortController();

    await readInvestigationProgress(STARTED_ID, {
      fetcher,
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
      signal: leaving.signal,
    });
    const upstream = fetcher.mock.calls[0]![1]?.signal;

    expect(upstream?.aborted).toBe(false);
    leaving.abort();
    expect(upstream?.aborted).toBe(true);
  });

  it("passes a refusal through with the service's status and envelope", async () => {
    const refusal = { code: "investigation_not_found", message: "No such investigation in this workspace." };
    const fetcher = answering(Response.json(refusal, { status: 404 }));

    const response = await readInvestigationProgress(STARTED_ID, {
      fetcher,
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(refusal);
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  it("answers 502 when the service could not be reached", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("fetch failed")));

    const response = await readInvestigationProgress(STARTED_ID, {
      fetcher,
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: PROGRESS_UNAVAILABLE_CODE, message: UNREACHABLE_PROGRESS });
  });

  it("gives up on a service that never answers its first byte", async () => {
    const fetcher = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );

    const response = await readInvestigationProgress(STARTED_ID, {
      fetcher,
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
      timeoutMs: 1,
    });

    expect(response.status).toBe(502);
  });
});
