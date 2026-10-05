import { describe, expect, it, vi } from "vitest";

import { clientAnswering } from "../helpers/api";
import { auditLogPage, auditToday } from "../helpers/audit-log";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { settingsAudit } = await import("@/app/api/settings-audit");

/**
 * The audit log's reads (#495 over #486): the card's today view, and the filtered, keyset-paged
 * log — each sending exactly the query it was given.
 */

describe("settingsAudit", () => {
  it("reads the today view", async () => {
    const { client, requests } = clientAnswering(auditToday());

    expect(await settingsAudit.today(client)).toEqual(auditToday());
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("GET");
    expect(new URL(requests[0].url).pathname).toBe("/api/v1/settings/audit/today");
  });

  it("reads the whole log with no query when nothing narrows it", async () => {
    const { client, requests } = clientAnswering(auditLogPage());

    expect(await settingsAudit.list({}, {}, client)).toEqual(auditLogPage());

    const url = new URL(requests[0].url);
    expect(url.pathname).toBe("/api/v1/settings/audit");
    expect(url.search).toBe("");
  });

  it("sends the filter, the cursor and the page size — and only what was set", async () => {
    const { client, requests } = clientAnswering(auditLogPage());

    await settingsAudit.list(
      { from: "2026-10-01T00:00:00.000Z", actorKind: "bot", action: "policy.*", ref: "pr:509" },
      { cursor: "abc", limit: 50 },
      client,
    );

    const query = new URL(requests[0].url).searchParams;
    expect(Object.fromEntries(query)).toEqual({
      from: "2026-10-01T00:00:00.000Z",
      actorKind: "bot",
      action: "policy.*",
      ref: "pr:509",
      cursor: "abc",
      limit: "50",
    });
  });

  it("rejects with the service's refusal", async () => {
    const { client } = clientAnswering({ code: "forbidden", message: "Owners and admins only." }, 403);

    await expect(settingsAudit.today(client)).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });
});
