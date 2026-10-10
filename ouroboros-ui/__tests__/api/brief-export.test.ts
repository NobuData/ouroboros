import { describe, expect, it, vi } from "vitest";

import { CACHE_CONTROL } from "@/app/api/poll-response";

import { STARTED_ID } from "../helpers/research";

/**
 * A brief's Markdown export, passed through to the browser (#630): the file streams through under
 * the service's own name, the session goes with the request, a refusal keeps the service's status
 * and words — and every answer is made safe to serve from this origin.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const {
  BRIEF_EXPORT_UNAVAILABLE_CODE,
  BRIEF_ID_INVALID_CODE,
  SAFETY_HEADERS,
  UNREACHABLE_BRIEF_EXPORT,
  briefExportPath,
  briefExportUrl,
  readBriefExport,
} = await import("@/app/api/brief-export");

const BASE = "http://rest.test";
const FILE = "# RS-127 — Autonomous docking vs. the field\n\n…[07]…\n";

function answering(response: Response) {
  return vi.fn<typeof fetch>(() => Promise.resolve(response));
}

function expectSafe(response: Response): void {
  for (const [name, value] of Object.entries(SAFETY_HEADERS)) expect(response.headers.get(name)).toBe(value);
  expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
}

describe("the addresses", () => {
  it("are the service's export route and this origin's link, the id encoded", () => {
    expect(briefExportPath(STARTED_ID)).toBe(`/api/v1/research/investigations/${STARTED_ID}/brief/export`);
    expect(briefExportUrl(STARTED_ID)).toBe(`/api/research/investigations/${STARTED_ID}/brief/export`);
    expect(briefExportUrl("a/b")).toBe("/api/research/investigations/a%2Fb/brief/export");
  });
});

describe("readBriefExport", () => {
  it("refuses an id that is not a uuid before calling out", async () => {
    const fetcher = answering(new Response(FILE));

    const response = await readBriefExport("RS-127", { fetcher, baseUrl: BASE });

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe(BRIEF_ID_INVALID_CODE);
    expect(fetcher).not.toHaveBeenCalled();
    expectSafe(response);
  });

  it("passes the file through with its type and name, over the visitor's session", async () => {
    const fetcher = answering(
      new Response(FILE, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": 'attachment; filename="RS-127-brief.md"',
          "X-Powered-By": "Express",
        },
      }),
    );

    const response = await readBriefExport(STARTED_ID, {
      fetcher,
      baseUrl: BASE,
      cookie: () => Promise.resolve("better-auth.session_token=abc"),
    });

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${BASE}${briefExportPath(STARTED_ID)}`);
    expect((init?.headers as Record<string, string>).Cookie).toBe("better-auth.session_token=abc");
    expect(init?.cache).toBe("no-store");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="RS-127-brief.md"');
    expect(response.headers.get("X-Powered-By")).toBeNull();
    expect(await response.text()).toBe(FILE);
    expectSafe(response);
  });

  it("passes a refusal through with the service's status and envelope", async () => {
    const refusal = { code: "brief_not_found", message: "This investigation has no brief yet." };
    const fetcher = answering(Response.json(refusal, { status: 404 }));

    const response = await readBriefExport(STARTED_ID, { fetcher, baseUrl: BASE, cookie: () => Promise.resolve(undefined) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(refusal);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expectSafe(response);
  });

  it("answers 502 when the service could not be reached", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("fetch failed")));

    const response = await readBriefExport(STARTED_ID, { fetcher, baseUrl: BASE, cookie: () => Promise.resolve(undefined) });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: BRIEF_EXPORT_UNAVAILABLE_CODE, message: UNREACHABLE_BRIEF_EXPORT });
    expectSafe(response);
  });
});
