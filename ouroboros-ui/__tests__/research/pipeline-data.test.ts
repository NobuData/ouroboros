import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { investigationList, investigationRow, seededRoadmap } from "../helpers/research";

/**
 * Which roadmap the pipeline's seat shows (#631): the newest finished investigation's that has
 * one, `issues_filed` before `brief_ready`, a `404` meaning "not this one".
 */

const investigations = vi.fn();
const roadmap = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/research", () => ({
  research: {
    investigations: (query: unknown) => investigations(query),
    roadmap: (id: unknown) => roadmap(id),
  },
}));

const { readFeaturedPipeline } = await import("@/app/research/pipeline-data");

/** The service's answer for an investigation with no roadmap document. */
function notFound(): ApiError {
  return new ApiError(404, "roadmap_not_found", "RS-127 has no roadmap document.");
}

const ROAD = { slug: "roadmap_improvements", name: "Roadmap & improvements", tint: "road" };

beforeEach(() => {
  investigations.mockReset().mockResolvedValue(investigationList({ items: [] }));
  roadmap.mockReset().mockRejectedValue(notFound());
});

describe("the pipeline's first paint", () => {
  it("shows the newest filed investigation's roadmap, with its kind", async () => {
    investigations.mockResolvedValueOnce(
      investigationList({ items: [investigationRow({ id: "rs-124", status: "issues_filed", kind: ROAD })] }),
    );
    roadmap.mockResolvedValueOnce(seededRoadmap());

    expect(await readFeaturedPipeline()).toEqual({ ok: true, value: { roadmap: seededRoadmap(), kind: ROAD } });
    expect(investigations).toHaveBeenCalledTimes(1);
    expect(investigations).toHaveBeenCalledWith({ status: "issues_filed", limit: 3 });
    expect(roadmap).toHaveBeenCalledWith("rs-124");
  });

  it("asks a row the service links to a roadmap before a newer one it does not", async () => {
    const link = { kind: "roadmap" as const, label: "to roadmap →", roadmapDocId: "doc" };

    investigations.mockResolvedValueOnce(
      investigationList({ items: [investigationRow({ id: "newer" }), investigationRow({ id: "linked", link })] }),
    );
    roadmap.mockResolvedValueOnce(seededRoadmap());

    await readFeaturedPipeline();

    expect(roadmap.mock.calls).toEqual([["linked"]]);
  });

  it("moves on from an investigation with no roadmap, to briefs not yet filed", async () => {
    investigations
      .mockResolvedValueOnce(investigationList({ items: [investigationRow({ id: "filed" })] }))
      .mockResolvedValueOnce(investigationList({ items: [investigationRow({ id: "ready", kind: ROAD })] }));
    roadmap.mockRejectedValueOnce(notFound()).mockResolvedValueOnce(seededRoadmap());

    const reading = await readFeaturedPipeline();

    expect(reading).toMatchObject({ ok: true, value: { kind: ROAD } });
    expect(investigations.mock.calls.map(([query]) => (query as { status: string }).status)).toEqual([
      "issues_filed",
      "brief_ready",
    ]);
    expect(roadmap.mock.calls).toEqual([["filed"], ["ready"]]);
  });

  it("shows nothing for a workspace with no roadmap", async () => {
    investigations.mockResolvedValue(investigationList({ items: [investigationRow()] }));

    expect(await readFeaturedPipeline()).toEqual({ ok: true, value: null });
  });

  it("keeps any other refusal as the reason the seat prints", async () => {
    investigations.mockResolvedValueOnce(investigationList({ items: [investigationRow()] }));
    roadmap.mockRejectedValueOnce(new ApiError(503, "unavailable", "The service is restarting."));

    expect(await readFeaturedPipeline()).toEqual({ ok: false, reason: "The service is restarting." });
  });

  it("lets what is not an answer from the service travel", async () => {
    investigations.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(readFeaturedPipeline()).rejects.toThrow("fetch failed");
  });
});
