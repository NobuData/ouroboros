import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";
import { SEEDED_REPO, repoMapReport } from "../helpers/knowledge";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { repoMap } = await import("@/app/api/repo-map");

/**
 * The repo-map generator's facade (#418): one POST naming the repository, answered with the
 * report — or with the rate limit as the `ApiError` the table turns into a wait.
 */

describe("repoMap.regenerate", () => {
  it("posts the repository and answers with the report, naming no workspace", async () => {
    const { client, requests } = clientAnswering(repoMapReport());

    expect(await repoMap.regenerate({ repo: SEEDED_REPO }, client)).toEqual(repoMapReport());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/knowledge/repo-map/regenerate`);
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.json()).toEqual({ repo: SEEDED_REPO });
    expect(requests[0]?.headers.get("x-ouro-tenant")).toBeNull();
  });

  it("answers the rate limit as the service's error, with the wait in its details", async () => {
    const { client } = clientAnswering(
      { code: "repo_map_regenerate_too_soon", message: "Too soon.", details: { retryAfterSeconds: 41 } },
      409,
    );

    const error = await repoMap.regenerate({ repo: SEEDED_REPO }, client).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "repo_map_regenerate_too_soon", details: { retryAfterSeconds: 41 } });
  });
});
