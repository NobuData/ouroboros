import { describe, expect, it, vi } from "vitest";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";
import { SEEDED_REPO, seededDetection, unscannedDetection } from "../helpers/knowledge";
import { scanProgress } from "../helpers/onboarding";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { detection } = await import("@/app/api/detection");
const { ApiError } = await import("@/app/api/errors");

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

describe("detection.scan (#391)", () => {
  it("posts the repository and answers the progress", async () => {
    const { client, requests } = clientAnswering({ progress: scanProgress(), joined: false }, 202);

    expect(await detection.scan(SEEDED_REPO, client)).toEqual({ progress: scanProgress(), joined: false });
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(
      `${STUB_BASE_URL}/api/v1/onboarding/detection/scan?repo=${encodeURIComponent(SEEDED_REPO)}`,
    );
  });

  it("throws the debounce's refusal for the caller to word", async () => {
    const { client } = clientAnswering(
      { code: "detection_rescan_too_soon", message: "Try again shortly.", details: { retryAfterSeconds: 12 } },
      409,
    );

    await expect(detection.scan(SEEDED_REPO, client)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("detection.editProtectedPaths (#391)", () => {
  it("puts the whole list and answers the card as stored", async () => {
    const stored = seededDetection({ protectedPaths: [{ glob: "boot/**", source: "edited" }] });
    const { client, requests } = clientAnswering(stored);

    expect(await detection.editProtectedPaths(SEEDED_REPO, ["boot/**"], client)).toEqual(stored);
    expect(requests[0]?.method).toBe("PUT");
    expect(requests[0]?.url).toBe(
      `${STUB_BASE_URL}/api/v1/onboarding/detection/protected-paths?repo=${encodeURIComponent(SEEDED_REPO)}`,
    );
    expect(await requests[0]?.json()).toEqual({ globs: ["boot/**"] });
  });

  it("throws the service's glob refusal", async () => {
    const { client } = clientAnswering(
      { code: "detection_glob_invalid", message: "Not enforceable.", details: { invalid: ["/etc/**"] } },
      422,
    );

    await expect(detection.editProtectedPaths(SEEDED_REPO, ["/etc/**"], client)).rejects.toMatchObject({
      status: 422,
      code: "detection_glob_invalid",
    });
  });
});

