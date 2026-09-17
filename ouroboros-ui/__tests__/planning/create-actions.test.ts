import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { planningEpic } from "../helpers/planning";

/**
 * The **New roadmap** dialog's server hop (#283). A Server Action is a POST endpoint anybody can
 * reach, so the call takes no workspace and no person, and the role gate is the service's.
 */

/** What the API answers, per case. */
const createEpic = vi.fn();

vi.mock("@/app/api/planning", () => ({
  planning: { createEpic: (body: unknown) => createEpic(body) },
}));

const { createRoadmap } = await import("@/app/planning/create-actions");

/** A body the dialog composes. */
const BODY = { name: "Secure boot", roadmapName: "Helios 3.0", startMonth: null, endMonth: null, status: "unscoped" as const };

beforeEach(() => {
  createEpic.mockReset().mockResolvedValue(planningEpic({ id: "epic-1", roadmapName: "Helios 3.0" }));
});

describe("createRoadmap", () => {
  it("forwards the body as the dialog composed it, and nothing else", async () => {
    await createRoadmap(BODY);

    expect(createEpic).toHaveBeenCalledExactlyOnceWith(BODY);
  });

  it("answers with the stored epic's id and the roadmap name it carries", async () => {
    await expect(createRoadmap(BODY)).resolves.toEqual({
      ok: true,
      epicId: "epic-1",
      roadmapName: "Helios 3.0",
    });
  });

  it("answers a refusal as a value, so the dialog stays open over the page", async () => {
    createEpic.mockRejectedValue(new ApiError(403, "forbidden", "Owners and admins only.", {}));

    await expect(createRoadmap(BODY)).resolves.toEqual({
      ok: false,
      refusal: { code: "forbidden", message: "Owners and admins only.", details: {} },
    });
  });

  it("lets anything that is not the service's refusal travel — the redirect signal above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    createEpic.mockRejectedValue(redirect);

    await expect(createRoadmap(BODY)).rejects.toBe(redirect);
  });
});
