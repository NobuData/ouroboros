import { describe, expect, it, vi } from "vitest";

import { CACHE_CONTROL } from "@/app/api/poll-response";

import { DRY_RUN_ID, SECURITY_PATCH_ID, SUGGESTION_SKIP_ID, TICKET_489_ID, seededDryRun } from "../helpers/workflow-copilot";

/**
 * The dry-run card's reads and writes, passed through to the browser (CE.4, #568): another
 * site's request is refused before anything is forwarded, the ids are uuids or nothing is asked,
 * a read forwards no body and a write forwards the browser's, a run's events stream straight back
 * under the protocol's headers, the browser's leaving ends the service's stream, and a refusal
 * keeps the service's status and words.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { CROSS_ORIGIN, CROSS_ORIGIN_CODE, COPILOT_REQUEST_INVALID_CODE, MAX_BODY_BYTES, SSE_MEDIA_TYPE, STREAM_HEADERS } =
  await import("@/app/api/workflow-copilot-stream");
const {
  CANDIDATE_LIMIT,
  DRY_RUN_BODY_TOO_LARGE,
  DRY_RUN_ID_INVALID,
  DRY_RUN_UNAVAILABLE_CODE,
  UNREACHABLE_DRY_RUN,
  candidatesPath,
  dryRunPath,
  dryRunsPath,
  passDryRun,
  suggestionPath,
} = await import("@/app/api/workflow-dry-run-pass");

const startRoute = await import("@/app/api/workflows/[id]/dry-runs/route");
const candidatesRoute = await import("@/app/api/workflows/[id]/dry-runs/candidates/route");
const detailRoute = await import("@/app/api/workflows/[id]/dry-runs/[dryRunId]/route");
const eventsRoute = await import("@/app/api/workflows/[id]/dry-runs/[dryRunId]/events/route");
const cancelRoute = await import("@/app/api/workflows/[id]/dry-runs/[dryRunId]/cancel/route");
const rerunRoute = await import("@/app/api/workflows/[id]/dry-runs/[dryRunId]/rerun/route");
const suggestionsRoute = await import("@/app/api/workflows/[id]/dry-runs/[dryRunId]/suggestions/route");
const explanationRoute = await import(
  "@/app/api/workflows/[id]/dry-runs/[dryRunId]/suggestions/[suggestionId]/explanation/route"
);
const applyRoute = await import("@/app/api/workflows/[id]/dry-runs/[dryRunId]/suggestions/[suggestionId]/apply/route");
const ignoreRoute = await import("@/app/api/workflows/[id]/dry-runs/[dryRunId]/suggestions/[suggestionId]/ignore/route");

/** The service's address in these cases. */
const BASE = "http://rest.test";

/** The service's path for the workflow's dry runs. */
const RUNS = `/api/v1/workflows/${SECURITY_PATCH_ID}/dry-runs`;

/** Two events, as the service frames them. */
const EVENTS = 'event: stage_started\ndata: {"kind":"stage_started","seq":4,"stageKey":"build","displayName":"build"}\n\n';

/** A fetch answering one response, remembering what it was asked. */
function answering(response: Response) {
  return vi.fn<typeof fetch>(() => Promise.resolve(response));
}

/** The browser's request, from this site unless told otherwise. */
function request(method: "GET" | "POST", body?: unknown, headers: Record<string, string> = {}, signal?: AbortSignal): Request {
  return new Request("http://ui.test/api/workflows/x/dry-runs", {
    method,
    headers: { Host: "ui.test", ...(method === "POST" ? { Origin: "http://ui.test", "Content-Type": "application/json" } : {}), ...headers },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    signal,
  });
}

/** The wiring every case shares. */
function wiring(fetcher: typeof fetch) {
  return { fetcher, baseUrl: BASE, cookie: async () => "ouro_session=abc" };
}

describe("the service's paths", () => {
  it("names each route under the workflow's dry runs, every id encoded", () => {
    expect(dryRunsPath(SECURITY_PATCH_ID)).toBe(RUNS);
    expect(candidatesPath(SECURITY_PATCH_ID)).toBe(`${RUNS}/candidates?limit=${CANDIDATE_LIMIT}`);
    expect(dryRunPath(SECURITY_PATCH_ID, DRY_RUN_ID)).toBe(`${RUNS}/${DRY_RUN_ID}`);
    expect(dryRunPath(SECURITY_PATCH_ID, DRY_RUN_ID, "events")).toBe(`${RUNS}/${DRY_RUN_ID}/events`);
    expect(dryRunPath(SECURITY_PATCH_ID, DRY_RUN_ID, "cancel")).toBe(`${RUNS}/${DRY_RUN_ID}/cancel`);
    expect(dryRunPath(SECURITY_PATCH_ID, DRY_RUN_ID, "rerun")).toBe(`${RUNS}/${DRY_RUN_ID}/rerun`);
    expect(suggestionPath(SECURITY_PATCH_ID, DRY_RUN_ID, SUGGESTION_SKIP_ID, "apply")).toBe(
      `${RUNS}/${DRY_RUN_ID}/suggestions/${SUGGESTION_SKIP_ID}/apply`,
    );
    expect(dryRunPath("a/b", "c d")).toBe("/api/v1/workflows/a%2Fb/dry-runs/c%20d");
  });
});

describe("a read", () => {
  it("asks the service with the session's cookies and no body, and hands back its JSON and status", async () => {
    const fetcher = answering(Response.json(seededDryRun()));

    const response = await passDryRun(
      request("GET"),
      [SECURITY_PATCH_ID, DRY_RUN_ID],
      dryRunPath(SECURITY_PATCH_ID, DRY_RUN_ID),
      wiring(fetcher),
    );

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`${BASE}${RUNS}/${DRY_RUN_ID}`);
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect((init?.headers as Record<string, string>).Cookie).toBe("ouro_session=abc");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(init?.cache).toBe("no-store");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    await expect(response.json()).resolves.toMatchObject({ id: DRY_RUN_ID });
  });

  it("sends no cookie header when the visitor has no session", async () => {
    const fetcher = answering(Response.json({}));

    await passDryRun(request("GET"), [SECURITY_PATCH_ID], candidatesPath(SECURITY_PATCH_ID), {
      fetcher,
      baseUrl: BASE,
      cookie: async () => undefined,
    });

    expect((fetcher.mock.calls[0][1]?.headers as Record<string, string>).Cookie).toBeUndefined();
  });
});

describe("a write", () => {
  it("forwards the body as the browser sent it, as a POST", async () => {
    const fetcher = answering(Response.json(seededDryRun(), { status: 201 }));
    const body = { ticketId: TICKET_489_ID, draftRev: 3 };

    const response = await passDryRun(request("POST", body), [SECURITY_PATCH_ID], dryRunsPath(SECURITY_PATCH_ID), wiring(fetcher));

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`${BASE}${RUNS}`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify(body));
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(response.status).toBe(201);
  });

  it("hands a refusal back with the service's status and envelope, so the card says its sentence", async () => {
    const envelope = {
      code: "dry_run_in_progress",
      message: "This workflow already has a dry run in progress. Follow it, or cancel it first.",
      details: { dryRunId: DRY_RUN_ID },
    };
    const fetcher = answering(Response.json(envelope, { status: 409 }));

    const response = await passDryRun(request("POST", {}), [SECURITY_PATCH_ID], dryRunsPath(SECURITY_PATCH_ID), wiring(fetcher));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(envelope);
  });

  it("refuses a body over the bound before anything is sent", async () => {
    const fetcher = answering(Response.json({}));

    const response = await passDryRun(
      request("POST", { text: "x".repeat(MAX_BODY_BYTES) }),
      [SECURITY_PATCH_ID],
      dryRunsPath(SECURITY_PATCH_ID),
      wiring(fetcher),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: COPILOT_REQUEST_INVALID_CODE, message: DRY_RUN_BODY_TOO_LARGE });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("a run's events", () => {
  it("stream straight back under the protocol's headers, and nothing else of the service's", async () => {
    const fetcher = answering(
      new Response(EVENTS, { status: 200, headers: { "Content-Type": `${SSE_MEDIA_TYPE}; charset=utf-8`, "X-Powered-By": "Express" } }),
    );

    const response = await passDryRun(
      request("GET"),
      [SECURITY_PATCH_ID, DRY_RUN_ID],
      dryRunPath(SECURITY_PATCH_ID, DRY_RUN_ID, "events"),
      wiring(fetcher),
    );

    expect(response.status).toBe(200);
    for (const [name, value] of Object.entries(STREAM_HEADERS)) expect(response.headers.get(name)).toBe(value);
    expect(response.headers.get("X-Powered-By")).toBeNull();
    expect((fetcher.mock.calls[0][1]?.headers as Record<string, string>).Accept).toContain(SSE_MEDIA_TYPE);
    await expect(response.text()).resolves.toBe(EVENTS);
  });

  it("end the service's stream when the browser leaves", async () => {
    const leaving = new AbortController();
    const fetcher = answering(new Response(EVENTS, { status: 200, headers: { "Content-Type": SSE_MEDIA_TYPE } }));

    await passDryRun(
      request("GET", undefined, {}, leaving.signal),
      [SECURITY_PATCH_ID, DRY_RUN_ID],
      dryRunPath(SECURITY_PATCH_ID, DRY_RUN_ID, "events"),
      wiring(fetcher),
    );
    const upstream = fetcher.mock.calls[0][1]?.signal as AbortSignal;

    expect(upstream.aborted).toBe(false);
    leaving.abort();
    expect(upstream.aborted).toBe(true);
  });
});

describe("what this hop refuses itself", () => {
  it("refuses another site's request before anything is forwarded — reads included", async () => {
    const fetcher = answering(Response.json({}));

    const elsewhere: Record<string, string>[] = [{ Origin: "http://evil.test" }, { "Sec-Fetch-Site": "cross-site" }];

    for (const headers of elsewhere) {
      const response = await passDryRun(request("GET", undefined, headers), [SECURITY_PATCH_ID], dryRunsPath(SECURITY_PATCH_ID), wiring(fetcher));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: CROSS_ORIGIN_CODE, message: CROSS_ORIGIN });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a uuid before anything is forwarded", async () => {
    const fetcher = answering(Response.json({}));

    const response = await passDryRun(request("GET"), [SECURITY_PATCH_ID, "../../admin"], "/anything", wiring(fetcher));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: COPILOT_REQUEST_INVALID_CODE, message: DRY_RUN_ID_INVALID });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("answers 502 in the service's envelope when the service cannot be reached, and never throws", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("fetch failed")));

    const response = await passDryRun(request("POST", {}), [SECURITY_PATCH_ID], dryRunsPath(SECURITY_PATCH_ID), wiring(fetcher));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ code: DRY_RUN_UNAVAILABLE_CODE, message: UNREACHABLE_DRY_RUN, details: {} });
  });
});

describe("the route handlers", () => {
  const ids = { id: "not-a-uuid", dryRunId: DRY_RUN_ID, suggestionId: SUGGESTION_SKIP_ID };
  const context = { params: Promise.resolve(ids) };

  it("are dynamic, and each answers only the method the card uses", () => {
    const reads = [candidatesRoute, detailRoute, eventsRoute, suggestionsRoute, explanationRoute];
    const writes = [startRoute, cancelRoute, rerunRoute, applyRoute, ignoreRoute];

    for (const route of [...reads, ...writes]) expect(route.dynamic).toBe("force-dynamic");
    for (const route of reads) expect(Object.keys(route).sort()).toEqual(["GET", "dynamic"]);
    for (const route of writes) expect(Object.keys(route).sort()).toEqual(["POST", "dynamic"]);
  });

  it("check the path's ids before asking the service for anything", async () => {
    const answers = await Promise.all([
      startRoute.POST(request("POST", {}), context),
      candidatesRoute.GET(request("GET"), context),
      detailRoute.GET(request("GET"), context),
      eventsRoute.GET(request("GET"), context),
      cancelRoute.POST(request("POST"), context),
      rerunRoute.POST(request("POST"), context),
      suggestionsRoute.GET(request("GET"), context),
      explanationRoute.GET(request("GET"), context),
      applyRoute.POST(request("POST"), context),
      ignoreRoute.POST(request("POST"), context),
    ]);

    for (const answer of answers) {
      expect(answer.status).toBe(422);
      await expect(answer.json()).resolves.toMatchObject({ message: DRY_RUN_ID_INVALID });
    }
  });
});
