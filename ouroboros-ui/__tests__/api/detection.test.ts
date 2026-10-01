import { describe, expect, it, vi } from "vitest";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";
import { SEEDED_REPO, seededDetection, unscannedDetection } from "../helpers/knowledge";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { detection } = await import("@/app/api/detection");

/**
 * The detection facade (#420): one read by repository, naming no workspace, answering the newest
 * scan — or `scan: null` for a repository never scanned, which is a state and not a failure.
 */

describe("detection.read", () => {
  it("asks for the repository's newest scan", async () => {
    const { client, requests } = clientAnswering(seededDetection());

    expect(await detection.read(SEEDED_REPO, client)).toEqual(seededDetection());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/onboarding/detection?repo=${encodeURIComponent(SEEDED_REPO)}`);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.headers.get("x-ouro-tenant")).toBeNull();
  });

  it("answers a repository never scanned as a value, not an error", async () => {
    const { client } = clientAnswering(unscannedDetection());

    expect(await detection.read(SEEDED_REPO, client)).toMatchObject({ scan: null, rows: [] });
  });
});
