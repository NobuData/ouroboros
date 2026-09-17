import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { membership, sessionUser } from "../helpers/login";
import {
  SEEDED_BATCH_ID,
  SEEDED_READ_AT,
  planningBatch,
  seededHealth,
  seededRoadmap,
} from "../helpers/planning";
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

/** What the backlog health read answers, per case (#285). */
const health = vi.fn();

vi.mock("@/app/api/planning", () => ({
  planning: { roadmap: () => roadmap(), batch: (id: string) => batch(id), health: () => health() },
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
  health.mockReset().mockResolvedValue(seededHealth());
});

/** The instant every case reads the page at, so `now` is arithmetic rather than the clock. */
const READ_AT = new Date(SEEDED_READ_AT);

describe("readPlanning", () => {
  it("reads the roadmap, the sources, the catalog and the health, and no batch when none is named", async () => {
    await expect(readPlanning(ACCESS, null, READ_AT)).resolves.toEqual({
      roadmap: { ok: true, value: seededRoadmap() },
      sources: { ok: true, value: sourcePage() },
      catalog: { ok: true, value: catalogPayload() },
      health: { ok: true, value: seededHealth() },
      batch: null,
      now: SEEDED_READ_AT,
    });
    expect(batch).not.toHaveBeenCalled();
  });

  // The footnote's *ago* is measured from one instant, taken here — see `data.ts`'s note.
  it("stamps the instant the page was read", async () => {
    expect((await readPlanning(ACCESS, null, READ_AT)).now).toBe(SEEDED_READ_AT);
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
    health.mockRejectedValue(new ApiError(500, "internal_error", "Health failed.", {}));
    batch.mockRejectedValue(new ApiError(404, "planning_batch_not_found", "No such batch.", {}));

    await expect(readPlanning(ACCESS, SEEDED_BATCH_ID, READ_AT)).resolves.toEqual({
      roadmap: { ok: false, reason: "The service failed." },
      sources: { ok: false, reason: "Sources failed." },
      catalog: { ok: false, reason: "Catalog failed." },
      health: { ok: false, reason: "Health failed." },
      batch: { ok: false, reason: "No such batch." },
      now: SEEDED_READ_AT,
    });
  });

  it("lets anything that is not the service's refusal travel", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    roadmap.mockRejectedValue(redirect);

    await expect(readPlanning(ACCESS)).rejects.toBe(redirect);
  });
});
