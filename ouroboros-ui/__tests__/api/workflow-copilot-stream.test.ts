import { describe, expect, it, vi } from "vitest";

import { CACHE_CONTROL } from "@/app/api/poll-response";

import { SECURITY_PATCH_ID, SESSION_ID, copilotSession } from "../helpers/workflow-copilot";

/**
 * The conversation's three writes, passed through to the browser (CE.2, #566): another site's
 * request is refused before anything is forwarded, the ids are uuids or nothing is asked, the
 * body and the session travel, a reply streams straight back under the protocol's headers, the
 * browser's leaving ends the service's stream, and a refusal keeps the service's status and words.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const {
  COPILOT_BODY_TOO_LARGE,
  COPILOT_ID_INVALID,
  COPILOT_REQUEST_INVALID_CODE,
  COPILOT_UNAVAILABLE_CODE,
  CROSS_ORIGIN,
  CROSS_ORIGIN_CODE,
  MAX_BODY_BYTES,
  SSE_MEDIA_TYPE,
  STREAM_HEADERS,
  UNREACHABLE_COPILOT,
  answersPath,
  isCopilotId,
  messagesPath,
  passCopilotWrite,
  sameOrigin,
  sessionsPath,
} = await import("@/app/api/workflow-copilot-stream");

const sessionsRoute = await import("@/app/api/workflows/[id]/copilot/sessions/route");
const messagesRoute = await import("@/app/api/workflows/[id]/copilot/sessions/[sessionId]/messages/route");
const answersRoute = await import(
  "@/app/api/workflows/[id]/copilot/sessions/[sessionId]/messages/[messageId]/answers/route"
);

/** The service's address in these cases. */
const BASE = "http://rest.test";

const MESSAGE_ID = "5eed0c0c-0000-4000-8000-000000000002";

/** Two events, as the service frames them. */
const EVENTS = 'event: delta\ndata: {"kind":"delta","text":"Drafted"}\n\nevent: done\ndata: {"kind":"done"}\n\n';

/** A fetch answering one response, remembering what it was asked. */
function answering(response: Response) {
  return vi.fn<typeof fetch>(() => Promise.resolve(response));
}

/** A streamed service answer. */
function stream(): Response {
  return new Response(EVENTS, {
    status: 201,
    headers: { "Content-Type": `${SSE_MEDIA_TYPE}; charset=utf-8`, "X-Powered-By": "Express" },
  });
}

/** The browser's request, from this site unless told otherwise. */
function request(body: unknown = { text: "add a stage" }, headers: Record<string, string> = {}, signal?: AbortSignal): Request {
  return new Request("http://ui.test/api/workflows/x/copilot/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: "ui.test", Origin: "http://ui.test", ...headers },
    body: JSON.stringify(body),
    signal,
  });
}

const WIRING = { baseUrl: BASE, cookie: () => Promise.resolve("better-auth.session_token=abc") };

describe("the service's paths", () => {
  it("are the three writes beneath one workflow, every id encoded", () => {
    expect(sessionsPath(SECURITY_PATCH_ID)).toBe(`/api/v1/workflows/${SECURITY_PATCH_ID}/copilot/sessions`);
    expect(messagesPath(SECURITY_PATCH_ID, SESSION_ID)).toBe(
      `/api/v1/workflows/${SECURITY_PATCH_ID}/copilot/sessions/${SESSION_ID}/messages`,
    );
    expect(answersPath(SECURITY_PATCH_ID, SESSION_ID, MESSAGE_ID)).toBe(
      `/api/v1/workflows/${SECURITY_PATCH_ID}/copilot/sessions/${SESSION_ID}/messages/${MESSAGE_ID}/answers`,
    );
    expect(sessionsPath("a/b")).toBe("/api/v1/workflows/a%2Fb/copilot/sessions");
  });
});

describe("isCopilotId", () => {
  it("accepts a uuid and nothing else", () => {
    expect(isCopilotId(SESSION_ID)).toBe(true);
    expect(isCopilotId(SESSION_ID.toUpperCase())).toBe(true);
    for (const value of ["", "security-patch", `${SESSION_ID}/..`, ` ${SESSION_ID}`, null, 7]) {
      expect(isCopilotId(value)).toBe(false);
    }
  });
});

describe("sameOrigin", () => {
  it.each([
    ["this site's own fetch", { host: "ui.test", origin: "http://ui.test", "sec-fetch-site": "same-origin" }, true],
    ["a request with neither header — a script, not a browser's form", { host: "ui.test" }, true],
    ["an origin matching the forwarded host behind a proxy", { host: "10.0.0.4:3000", "x-forwarded-host": "app.example.com", origin: "https://app.example.com" }, true],
    ["another site's origin", { host: "ui.test", origin: "https://evil.example" }, false],
    ["a sibling subdomain", { host: "ui.test", origin: "http://x.ui.test" }, false],
    ["another port", { host: "ui.test", origin: "http://ui.test:8080" }, false],
    ["a request the browser calls cross-site", { host: "ui.test", "sec-fetch-site": "cross-site" }, false],
    ["a request the browser calls same-site but not same-origin", { host: "ui.test", origin: "http://ui.test", "sec-fetch-site": "same-site" }, false],
    ["an opaque origin", { host: "ui.test", origin: "null" }, false],
    ["an origin with no host to compare it to", { origin: "http://ui.test" }, false],
  ])("judges %s", (_what, headers, expected) => {
    expect(sameOrigin(new Headers(headers))).toBe(expected);
  });
});

describe("passCopilotWrite", () => {
  it("refuses another site's request before reading or forwarding anything", async () => {
    const fetcher = answering(stream());

    const response = await passCopilotWrite(
      request({ text: "x" }, { Origin: "https://evil.example" }),
      [SECURITY_PATCH_ID],
      sessionsPath(SECURITY_PATCH_ID),
      { ...WIRING, fetcher },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: CROSS_ORIGIN_CODE, message: CROSS_ORIGIN, details: {} });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a uuid before calling out", async () => {
    const fetcher = answering(stream());

    const response = await passCopilotWrite(request(), [SECURITY_PATCH_ID, "../../admin"], "/anything", {
      ...WIRING,
      fetcher,
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code: COPILOT_REQUEST_INVALID_CODE, message: COPILOT_ID_INVALID, details: {} });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses a body past the bound before calling out", async () => {
    const fetcher = answering(stream());

    const response = await passCopilotWrite(
      request({ text: "é".repeat(MAX_BODY_BYTES / 2) }),
      [SECURITY_PATCH_ID, SESSION_ID],
      messagesPath(SECURITY_PATCH_ID, SESSION_ID),
      { ...WIRING, fetcher },
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ message: COPILOT_BODY_TOO_LARGE });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("posts the body as sent over the visitor's session, and streams the reply back", async () => {
    const fetcher = answering(stream());

    const response = await passCopilotWrite(
      request({ text: "add a stage" }),
      [SECURITY_PATCH_ID, SESSION_ID],
      messagesPath(SECURITY_PATCH_ID, SESSION_ID),
      { ...WIRING, fetcher },
    );

    const [url, init] = fetcher.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;

    expect(url).toBe(`${BASE}${messagesPath(SECURITY_PATCH_ID, SESSION_ID)}`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ text: "add a stage" }));
    expect(init?.cache).toBe("no-store");
    expect(headers.Cookie).toBe("better-auth.session_token=abc");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Accept).toContain(SSE_MEDIA_TYPE);
    // Nothing of the browser's own request headers travels: no Origin, no Host, no workspace.
    expect(Object.keys(headers).sort()).toEqual(["Accept", "Content-Type", "Cookie"]);

    expect(response.status).toBe(200);
    for (const [name, value] of Object.entries(STREAM_HEADERS)) expect(response.headers.get(name)).toBe(value);
    expect(response.headers.get("X-Powered-By")).toBeNull();
    expect(await response.text()).toBe(EVENTS);
  });

  it("sends no cookie header when the visitor has no session, and no content type with no body", async () => {
    const fetcher = answering(Response.json(copilotSession(), { status: 201 }));

    const bare = new Request("http://ui.test/api/workflows/x/copilot/sessions", {
      method: "POST",
      headers: { Host: "ui.test", Origin: "http://ui.test" },
    });

    await passCopilotWrite(bare, [SECURITY_PATCH_ID], sessionsPath(SECURITY_PATCH_ID), {
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
      fetcher,
    });

    const init = fetcher.mock.calls[0]![1];

    expect(init?.headers).toEqual({ Accept: `${SSE_MEDIA_TYPE}, application/json` });
    expect(init?.body).toBeUndefined();
  });

  it("passes a JSON answer through with its status — the started session", async () => {
    const fetcher = answering(Response.json(copilotSession(), { status: 201 }));

    const response = await passCopilotWrite(request({}), [SECURITY_PATCH_ID], sessionsPath(SECURITY_PATCH_ID), {
      ...WIRING,
      fetcher,
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(copilotSession());
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
  });

  it.each([
    [409, "copilot_session_closed"],
    [403, "forbidden"],
    [404, "workflow_not_found"],
    [422, "copilot_answer_invalid"],
    [401, "unauthenticated"],
  ])("passes a %i refusal through with the service's status and envelope", async (status, code) => {
    const refusal = { code, message: "The service's sentence.", details: {} };
    const fetcher = answering(Response.json(refusal, { status }));

    const response = await passCopilotWrite(
      request(),
      [SECURITY_PATCH_ID, SESSION_ID],
      messagesPath(SECURITY_PATCH_ID, SESSION_ID),
      { ...WIRING, fetcher },
    );

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(refusal);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
  });

  it("ends the service's stream when the browser leaves", async () => {
    const fetcher = answering(stream());
    const leaving = new AbortController();

    await passCopilotWrite(
      request({ text: "x" }, {}, leaving.signal),
      [SECURITY_PATCH_ID, SESSION_ID],
      messagesPath(SECURITY_PATCH_ID, SESSION_ID),
      { ...WIRING, fetcher },
    );
    const upstream = fetcher.mock.calls[0]![1]?.signal;

    expect(upstream?.aborted).toBe(false);
    leaving.abort();
    expect(upstream?.aborted).toBe(true);
  });

  it("answers 502 when the service could not be reached", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("fetch failed")));

    const response = await passCopilotWrite(request(), [SECURITY_PATCH_ID], sessionsPath(SECURITY_PATCH_ID), {
      ...WIRING,
      fetcher,
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: COPILOT_UNAVAILABLE_CODE, message: UNREACHABLE_COPILOT, details: {} });
  });

  it("gives up on a service that never answers its first byte", async () => {
    const fetcher = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );

    const response = await passCopilotWrite(request(), [SECURITY_PATCH_ID], sessionsPath(SECURITY_PATCH_ID), {
      ...WIRING,
      fetcher,
      timeoutMs: 5,
    });

    expect(response.status).toBe(502);
  });
});

describe("the three routes", () => {
  it("are never static", () => {
    expect(sessionsRoute.dynamic).toBe("force-dynamic");
    expect(messagesRoute.dynamic).toBe("force-dynamic");
    expect(answersRoute.dynamic).toBe("force-dynamic");
  });

  it("each refuse ids that are not uuids without calling the service", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");

    const responses = await Promise.all([
      sessionsRoute.POST(request({}), { params: Promise.resolve({ id: "security-patch" }) }),
      messagesRoute.POST(request(), { params: Promise.resolve({ id: SECURITY_PATCH_ID, sessionId: "latest" }) }),
      answersRoute.POST(request({ question: 0, selected: "Yes" }), {
        params: Promise.resolve({ id: SECURITY_PATCH_ID, sessionId: SESSION_ID, messageId: "2" }),
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([422, 422, 422]);
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });

  it("each refuse another site's request", async () => {
    const cross = { Origin: "https://evil.example" };

    const responses = await Promise.all([
      sessionsRoute.POST(request({}, cross), { params: Promise.resolve({ id: SECURITY_PATCH_ID }) }),
      messagesRoute.POST(request({ text: "x" }, cross), {
        params: Promise.resolve({ id: SECURITY_PATCH_ID, sessionId: SESSION_ID }),
      }),
      answersRoute.POST(request({ question: 0, selected: "Yes" }, cross), {
        params: Promise.resolve({ id: SECURITY_PATCH_ID, sessionId: SESSION_ID, messageId: MESSAGE_ID }),
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
  });
});
