import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { membership, sessionUser } from "../helpers/login";
import { SEEDED_BATCH_ID, planningBatch, seededRoadmap } from "../helpers/planning";
import { catalogPayload, sourcePage } from "../helpers/sources";

vi.mock("server-only", () => ({}));

/** What the roadmap read answers, per case. */
const roadmap = vi.fn();

/** What the batch read answers, per case. */
const batch = vi.fn();

/** What the sources listing answers, per case. */
const list = vi.fn();

/** What the catalog answers, per case. */
const catalog = vi.fn();

vi.mock("@/app/api/planning", () => ({
  planning: { roadmap: () => roadmap(), batch: (id: string) => batch(id) },
}));
vi.mock("@/app/api/sources", () => ({ sources: { list: () => list(), catalog: () => catalog() } }));

const { readPlanning } = await import("@/app/planning/data");

/** The planning page's reader (#283, #284): one failed read is one degraded region. */

/** The gate's answer. */
const ACCESS = {
  session: { user: sessionUser(), memberships: [membership()], tenantSuggestion: null },
  membership: membership(),
} as unknown as Parameters<typeof readPlanning>[0];

beforeEach(() => {
  roadmap.mockReset().mockResolvedValue(seededRoadmap());
  batch.mockReset().mockResolvedValue(planningBatch());
  list.mockReset().mockResolvedValue(sourcePage());
  catalog.mockReset().mockResolvedValue(catalogPayload());
});

describe("readPlanning", () => {
  it("reads the roadmap, the sources and the catalog, and no batch when none is named", async () => {
    await expect(readPlanning(ACCESS)).resolves.toEqual({
      roadmap: { ok: true, value: seededRoadmap() },
      sources: { ok: true, value: sourcePage() },
      catalog: { ok: true, value: catalogPayload() },
      batch: null,
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it("reads the batch the address names", async () => {
    const readings = await readPlanning(ACCESS, SEEDED_BATCH_ID);

    expect(batch).toHaveBeenCalledExactlyOnceWith(SEEDED_BATCH_ID);
    expect(readings.batch).toEqual({ ok: true, value: planningBatch() });
  });

  it("keeps each refused read as the service's reason rather than a thrown page", async () => {
    roadmap.mockRejectedValue(new ApiError(500, "internal_error", "The service failed.", {}));
    list.mockRejectedValue(new ApiError(500, "internal_error", "Sources failed.", {}));
    catalog.mockRejectedValue(new ApiError(500, "internal_error", "Catalog failed.", {}));
    batch.mockRejectedValue(new ApiError(404, "planning_batch_not_found", "No such batch.", {}));

    await expect(readPlanning(ACCESS, SEEDED_BATCH_ID)).resolves.toEqual({
      roadmap: { ok: false, reason: "The service failed." },
      sources: { ok: false, reason: "Sources failed." },
      catalog: { ok: false, reason: "Catalog failed." },
      batch: { ok: false, reason: "No such batch." },
    });
  });

  it("lets anything that is not the service's refusal travel", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    roadmap.mockRejectedValue(redirect);

    await expect(readPlanning(ACCESS)).rejects.toBe(redirect);
  });
});
