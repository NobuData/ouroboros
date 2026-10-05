import { describe, expect, it, vi } from "vitest";

/** `GET /api/settings/audit/export.csv` (#495): the request's query, and whatever the reader answered. */

vi.mock("server-only", () => ({}));

const readAuditExport = vi.fn<(query: URLSearchParams) => Promise<Response>>(() =>
  Promise.resolve(new Response("occurred_at\r\n", { status: 200 })),
);

vi.mock("@/app/api/settings-audit-export", () => ({
  readAuditExport: (query: URLSearchParams) => readAuditExport(query),
}));

const { GET } = await import("@/app/api/settings/audit/export.csv/route");

describe("the route", () => {
  it("hands the reader the request's query and answers with the reader's response", async () => {
    const response = await GET(
      new Request(
        "http://ui.test/api/settings/audit/export.csv?from=2026-09-06T00:00:00.000Z&to=2026-10-06T00:00:00.000Z&ref=pr:509",
      ),
    );

    expect(readAuditExport).toHaveBeenCalledOnce();
    expect(Object.fromEntries(readAuditExport.mock.calls[0]![0])).toEqual({
      from: "2026-09-06T00:00:00.000Z",
      to: "2026-10-06T00:00:00.000Z",
      ref: "pr:509",
    });
    expect(await response.text()).toBe("occurred_at\r\n");
  });
});
