import { describe, expect, it, vi } from "vitest";

import { CACHE_CONTROL } from "@/app/api/poll-response";

/**
 * The audit log's CSV export, passed through to the browser (#495 over #486): the body streams
 * straight through, only the export's own parameters travel, a request without a range is
 * refused before anything is sent, and a refusal keeps the service's status and words.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const {
  AUDIT_EXPORT_PATH,
  EXPORT_PARAMETERS,
  EXPORT_RANGE_REQUIRED,
  EXPORT_RANGE_REQUIRED_CODE,
  EXPORT_UNAVAILABLE_CODE,
  EXPORT_UNREACHABLE,
  PASSED_HEADERS,
  exportQuery,
  readAuditExport,
} = await import("@/app/api/settings-audit-export");

/** The service's address in these cases. */
const BASE = "http://rest.test";

/** Two lines of CSV. */
const FILE = "occurred_at,actor_kind,actor\r\n2026-10-05T14:12:00.000Z,human,Ken\r\n";

/** A bounded range. */
const RANGE = "from=2026-09-06T00%3A00%3A00.000Z&to=2026-10-06T00%3A00%3A00.000Z";

/**
 * A fetch answering one response.
 *
 * @param response What to answer.
 * @returns The stub.
 */
function answering(response: Response) {
  return vi.fn<typeof fetch>(() => Promise.resolve(response));
}

describe("exportQuery", () => {
  it("keeps the export's own parameters, each once, and drops everything else", () => {
    const query = new URLSearchParams(
      `${RANGE}&actorKind=bot&actorKind=human&ref=pr%3A509&limit=100000&cursor=x&action=`,
    );

    expect(Object.fromEntries(exportQuery(query))).toEqual({
      from: "2026-09-06T00:00:00.000Z",
      to: "2026-10-06T00:00:00.000Z",
      actorKind: "bot",
      ref: "pr:509",
    });
    expect(EXPORT_PARAMETERS).toEqual([
      "from",
      "to",
      "actorKind",
      "actorId",
      "actorService",
      "action",
      "ref",
    ]);
  });
});

describe("readAuditExport", () => {
  it("asks the service with the session and streams the file back with its type, name and count", async () => {
    const fetcher = answering(
      new Response(FILE, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="audit-2026-09-06_2026-10-06.csv"',
          "X-Ouro-Export-Rows": "1",
          "Set-Cookie": "leak=1",
        },
      }),
    );

    const response = await readAuditExport(new URLSearchParams(`${RANGE}&actorKind=human`), {
      fetcher,
      baseUrl: BASE,
      cookie: () => Promise.resolve("better-auth.session_token=abc"),
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${BASE}${AUDIT_EXPORT_PATH}?${RANGE}&actorKind=human`);
    expect(init?.headers).toEqual({ Cookie: "better-auth.session_token=abc" });
    expect(init?.cache).toBe("no-store");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toContain("audit-2026-09-06");
    expect(response.headers.get("X-Ouro-Export-Rows")).toBe("1");
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    // Only the headers the file needs travel back.
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(PASSED_HEADERS).toEqual(["Content-Type", "Content-Disposition", "X-Ouro-Export-Rows"]);
    expect(await response.text()).toBe(FILE);
  });

  it("hands the body over as a stream rather than reading it whole", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(FILE));
        controller.close();
      },
    });
    const response = await readAuditExport(new URLSearchParams(RANGE), {
      fetcher: answering(new Response(body, { status: 200 })),
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
    });

    expect(response.body).toBe(body);
  });

  it("sends no cookie header when there is no session", async () => {
    const fetcher = answering(new Response("", { status: 401 }));

    await readAuditExport(new URLSearchParams(RANGE), {
      fetcher,
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
    });

    expect(fetcher.mock.calls[0]![1]?.headers).toEqual({});
  });

  it("refuses a request without both ends of the range before sending anything", async () => {
    for (const query of ["", "from=2026-09-06T00:00:00.000Z", "to=2026-10-06T00:00:00.000Z", "from=&to="]) {
      const fetcher = vi.fn();
      const response = await readAuditExport(new URLSearchParams(query), {
        fetcher,
        baseUrl: BASE,
        cookie: () => Promise.resolve("c=1"),
      });

      expect(fetcher, query).not.toHaveBeenCalled();
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        code: EXPORT_RANGE_REQUIRED_CODE,
        message: EXPORT_RANGE_REQUIRED,
      });
    }
  });

  it("passes a refusal through with the service's status and words", async () => {
    const refusal = JSON.stringify({ code: "audit_export_range_too_long", message: "At most 366 days." });
    const response = await readAuditExport(new URLSearchParams(RANGE), {
      fetcher: answering(new Response(refusal, { status: 422, headers: { "Content-Type": "application/json" } })),
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: "audit_export_range_too_long",
      message: "At most 366 days.",
    });
  });

  it("answers a 502 with a sentence when the service cannot be reached", async () => {
    const response = await readAuditExport(new URLSearchParams(RANGE), {
      fetcher: vi.fn<typeof fetch>(() => Promise.reject(new Error("ECONNREFUSED"))),
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
    });

    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    expect(await response.json()).toEqual({ code: EXPORT_UNAVAILABLE_CODE, message: EXPORT_UNREACHABLE });
  });
});
