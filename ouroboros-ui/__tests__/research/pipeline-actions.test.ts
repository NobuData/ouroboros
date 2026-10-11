import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { HUMAN_SUGGESTION_ID, RS124_ID, appliedRoadmap, seededRoadmap } from "../helpers/research";

/**
 * The pipeline card's two server hops (#631): each answers the whole card, and a refusal comes
 * back as a value with the service's own code and sentence.
 */

const apply = vi.fn();
const dismiss = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/research", () => ({
  research: {
    applyRoadmapSuggestion: (investigationId: unknown, suggestionId: unknown) => apply(investigationId, suggestionId),
    dismissRoadmapSuggestion: (investigationId: unknown, suggestionId: unknown) =>
      dismiss(investigationId, suggestionId),
  },
}));

const { applyRoadmapSuggestion, dismissRoadmapSuggestion } = await import("@/app/research/pipeline-actions");

beforeEach(() => {
  apply.mockReset();
  dismiss.mockReset();
});

describe("the pipeline's writes", () => {
  it("answer the card the service returned", async () => {
    apply.mockResolvedValueOnce(appliedRoadmap());
    dismiss.mockResolvedValueOnce(seededRoadmap());

    expect(await applyRoadmapSuggestion(RS124_ID, HUMAN_SUGGESTION_ID)).toEqual({ ok: true, roadmap: appliedRoadmap() });
    expect(await dismissRoadmapSuggestion(RS124_ID, HUMAN_SUGGESTION_ID)).toEqual({ ok: true, roadmap: seededRoadmap() });
    expect(apply).toHaveBeenCalledWith(RS124_ID, HUMAN_SUGGESTION_ID);
    expect(dismiss).toHaveBeenCalledWith(RS124_ID, HUMAN_SUGGESTION_ID);
  });

  it("turn the service's refusal into a value", async () => {
    apply.mockRejectedValueOnce(new ApiError(502, "roadmap_skill_failed", "create-roadmap could not run."));
    dismiss.mockRejectedValueOnce(new ApiError(403, "forbidden", "Only an owner or an admin may dismiss."));

    expect(await applyRoadmapSuggestion(RS124_ID, HUMAN_SUGGESTION_ID)).toEqual({
      ok: false,
      refusal: { code: "roadmap_skill_failed", message: "create-roadmap could not run." },
    });
    expect(await dismissRoadmapSuggestion(RS124_ID, HUMAN_SUGGESTION_ID)).toEqual({
      ok: false,
      refusal: { code: "forbidden", message: "Only an owner or an admin may dismiss." },
    });
  });

  it("let what is not an answer from the service travel — the redirect signal, a dropped connection", async () => {
    apply.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(applyRoadmapSuggestion(RS124_ID, HUMAN_SUGGESTION_ID)).rejects.toThrow("fetch failed");
  });
});
