import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { SEEDED_BATCH_ID, generatedBatch, planningBatch, pushResult } from "../helpers/planning";
import { SEEDED_GITHUB_ID } from "../helpers/sources";

/**
 * The generator card's server hops (#284). A Server Action is a POST endpoint anybody can reach, so
 * no call takes a workspace or a person, the role gates are the service's, and a refusal comes back
 * as a value while anything else keeps travelling.
 */

/** The API facade's operations, per case. */
const api = {
  generate: vi.fn(),
  regenerate: vi.fn(),
  patchDraft: vi.fn(),
  push: vi.fn(),
  resumePush: vi.fn(),
  batch: vi.fn(),
  milestones: vi.fn(),
};

vi.mock("@/app/api/planning", () => ({
  planning: {
    generate: (...args: unknown[]) => api.generate(...args),
    regenerate: (...args: unknown[]) => api.regenerate(...args),
    patchDraft: (...args: unknown[]) => api.patchDraft(...args),
    push: (...args: unknown[]) => api.push(...args),
    resumePush: (...args: unknown[]) => api.resumePush(...args),
    batch: (...args: unknown[]) => api.batch(...args),
    milestones: (...args: unknown[]) => api.milestones(...args),
  },
}));

const { generateBatch, patchDraft, pushBatch, readMilestones, regenerateBatch } = await import(
  "@/app/planning/generator-actions"
);

/** A refusal the service might answer with. */
const REFUSAL = new ApiError(403, "forbidden", "Pushing is for owners and admins.", {});

beforeEach(() => {
  for (const call of Object.values(api)) call.mockReset();
  api.generate.mockResolvedValue(generatedBatch());
  api.regenerate.mockResolvedValue(generatedBatch());
  api.patchDraft.mockResolvedValue(planningBatch());
  api.push.mockResolvedValue(pushResult());
  api.resumePush.mockResolvedValue(pushResult());
  api.batch.mockResolvedValue(planningBatch({ status: "pushed" }));
  api.milestones.mockResolvedValue({ sourceId: SEEDED_GITHUB_ID, supported: false, milestones: [] });
});

describe("generateBatch and regenerateBatch", () => {
  it("forward what the card composed, and answer with the batch", async () => {
    const body = {
      prompt: "p",
      outline: null,
      targetSourceId: SEEDED_GITHUB_ID,
      milestone: null,
      autoSize: true,
      queueSmall: false,
      localKeyPrefix: "OTA",
    };

    await expect(generateBatch(body)).resolves.toEqual({ ok: true, value: generatedBatch() });
    expect(api.generate).toHaveBeenCalledExactlyOnceWith(body);

    await expect(regenerateBatch(SEEDED_BATCH_ID)).resolves.toEqual({ ok: true, value: generatedBatch() });
    expect(api.regenerate).toHaveBeenCalledExactlyOnceWith(SEEDED_BATCH_ID);
  });

  it("answer a refusal as its envelope", async () => {
    api.generate.mockRejectedValue(
      new ApiError(422, "dependency_cycle", "This batch's dependencies form a cycle (OTA-3 → OTA-5 → OTA-3).", {
        cycle: ["OTA-3", "OTA-5", "OTA-3"],
      }),
    );

    await expect(generateBatch({} as never)).resolves.toEqual({
      ok: false,
      refusal: {
        code: "dependency_cycle",
        message: "This batch's dependencies form a cycle (OTA-3 → OTA-5 → OTA-3).",
        details: { cycle: ["OTA-3", "OTA-5", "OTA-3"] },
      },
    });
  });
});

describe("patchDraft", () => {
  it("patches one draft by key", async () => {
    await expect(patchDraft(SEEDED_BATCH_ID, "OTA-2", { selected: false })).resolves.toEqual({
      ok: true,
      value: planningBatch(),
    });
    expect(api.patchDraft).toHaveBeenCalledExactlyOnceWith(SEEDED_BATCH_ID, "OTA-2", { selected: false });
  });
});

describe("pushBatch", () => {
  it("pushes, then reads the batch again so every row's state arrives in one answer", async () => {
    await expect(pushBatch(SEEDED_BATCH_ID, false)).resolves.toEqual({
      ok: true,
      value: { result: pushResult(), batch: planningBatch({ status: "pushed" }) },
    });
    expect(api.push).toHaveBeenCalledExactlyOnceWith(SEEDED_BATCH_ID);
    expect(api.resumePush).not.toHaveBeenCalled();
  });

  it("resumes rather than pushes when asked to", async () => {
    await pushBatch(SEEDED_BATCH_ID, true);

    expect(api.resumePush).toHaveBeenCalledExactlyOnceWith(SEEDED_BATCH_ID);
    expect(api.push).not.toHaveBeenCalled();
  });

  it("answers the push's refusal without reading the batch", async () => {
    api.push.mockRejectedValue(REFUSAL);

    const outcome = await pushBatch(SEEDED_BATCH_ID, false);

    expect(outcome).toMatchObject({ ok: false, refusal: { code: "forbidden" } });
    expect(api.batch).not.toHaveBeenCalled();
  });

  it("still reports a push that landed when the re-read was refused", async () => {
    api.batch.mockRejectedValue(new ApiError(500, "internal_error", "failed", {}));

    await expect(pushBatch(SEEDED_BATCH_ID, false)).resolves.toEqual({
      ok: true,
      value: { result: pushResult(), batch: null },
    });
  });
});

describe("readMilestones", () => {
  it("reads the tracker's milestones", async () => {
    await expect(readMilestones(SEEDED_GITHUB_ID)).resolves.toMatchObject({ ok: true, value: { supported: false } });
    expect(api.milestones).toHaveBeenCalledExactlyOnceWith(SEEDED_GITHUB_ID);
  });
});

describe("what is not a refusal", () => {
  it("travels — Next.js's redirect signal above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    api.milestones.mockRejectedValue(redirect);

    await expect(readMilestones(SEEDED_GITHUB_ID)).rejects.toBe(redirect);
  });
});
