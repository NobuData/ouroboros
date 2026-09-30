import { describe, expect, it, vi } from "vitest";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";
import { SEEDED_COMPLETIONS } from "../helpers/dashboard";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { runs } = await import("@/app/api/runs");

/**
 * The run listing (#420): one family at a time, bounded — what **+ New playbook from a past
 * run…** offers, newest first.
 */

describe("runs.list", () => {
  it("asks for one family with its bound, naming no workspace", async () => {
    const page = { items: [...SEEDED_COMPLETIONS], total: 4, limit: 25, offset: 0 };
    const { client, requests } = clientAnswering(page);

    expect(await runs.list("terminal", 25, client)).toEqual(page);
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/runs?status=terminal&limit=25`);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.headers.get("x-ouro-tenant")).toBeNull();
  });
});
