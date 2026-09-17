import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { membership, sessionUser } from "../helpers/login";
import { seededRoadmap } from "../helpers/planning";

vi.mock("server-only", () => ({}));

/** What the roadmap read answers, per case. */
const roadmap = vi.fn();

vi.mock("@/app/api/planning", () => ({ planning: { roadmap: () => roadmap() } }));

const { readPlanning } = await import("@/app/planning/data");

/** The planning frame's reader (#283): one failed read is one degraded region. */

/** The gate's answer. */
const ACCESS = {
  session: { user: sessionUser(), memberships: [membership()], tenantSuggestion: null },
  membership: membership(),
} as unknown as Parameters<typeof readPlanning>[0];

beforeEach(() => {
  roadmap.mockReset().mockResolvedValue(seededRoadmap());
});

describe("readPlanning", () => {
  it("reads the roadmap", async () => {
    await expect(readPlanning(ACCESS)).resolves.toEqual({
      roadmap: { ok: true, value: seededRoadmap() },
    });
  });

  it("keeps a refused read as the service's reason rather than a thrown page", async () => {
    roadmap.mockRejectedValue(new ApiError(500, "internal_error", "The service failed.", {}));

    await expect(readPlanning(ACCESS)).resolves.toEqual({
      roadmap: { ok: false, reason: "The service failed." },
    });
  });

  it("lets anything that is not the service's refusal travel", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    roadmap.mockRejectedValue(redirect);

    await expect(readPlanning(ACCESS)).rejects.toBe(redirect);
  });
});
