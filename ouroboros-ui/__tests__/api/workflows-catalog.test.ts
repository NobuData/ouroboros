import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { clientAnswering } from "../helpers/api";
import { stageCatalog } from "../helpers/workflows";

// The facade sits on the server-side client — see `server.test.ts` for what each of these answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { workflows } = await import("@/app/api/workflows");

/**
 * The stage catalog's read (R.3, #145) as the inspector consumes it (S.4, #150): one request, the
 * body handed back as served, the session's workspace, and a refusal that stays an `ApiError`.
 */

describe("workflows.catalog", () => {
  it("reads the catalog in one request and returns the body itself", async () => {
    const { client, requests } = clientAnswering(stageCatalog());

    await expect(workflows.catalog(client)).resolves.toEqual(stageCatalog());

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("GET");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/v1/workflows/catalog");
    // The workspace is the session's, as for every call in this module.
    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
  });

  it("rejects with the service's refusal", async () => {
    const { client } = clientAnswering(
      { code: "organization_required", message: "Choose a workspace first.", details: {} },
      403,
    );

    const failure = await workflows.catalog(client).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(403);
  });
});
