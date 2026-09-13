import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import {
  READ_AT,
  SEEDED_GITHUB_ID,
  SEEDED_JIRA_ID,
  catalogPayload,
  sourcePage,
  statusReport,
} from "../helpers/sources";

const list = vi.fn();
const catalog = vi.fn();
const status = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/sources", () => ({
  sources: {
    list: () => list(),
    catalog: () => catalog(),
    status: (id: string) => status(id),
  },
}));

const { readSources } = await import("@/app/sources/data");

/**
 * The page's reader ([#141](https://github.com/NobuData/ouroboros/issues/141)): two reads at
 * once, then one per source, and one failed read is one degraded region.
 */

const ACCESS = {} as Parameters<typeof readSources>[0];

const NOW = new Date(READ_AT);

beforeEach(() => {
  list.mockReset().mockResolvedValue(sourcePage());
  catalog.mockReset().mockResolvedValue(catalogPayload());
  status.mockReset().mockImplementation((id: string) => Promise.resolve(statusReport({ sourceId: id })));
});

describe("readSources", () => {
  it("reads the listing and the catalog, then a status per source", async () => {
    const readings = await readSources(ACCESS, NOW);

    expect(readings.sources).toEqual({ ok: true, value: sourcePage().items });
    expect(readings.catalog).toEqual({ ok: true, value: catalogPayload().kinds });
    expect([...readings.statuses.keys()]).toEqual([SEEDED_GITHUB_ID, SEEDED_JIRA_ID]);
    expect(readings.statuses.get(SEEDED_JIRA_ID)).toEqual({
      ok: true,
      value: statusReport({ sourceId: SEEDED_JIRA_ID }),
    });
    expect(readings.now).toBe(READ_AT);
  });

  it("degrades the catalog alone when it was refused", async () => {
    catalog.mockRejectedValue(new ApiError(500, "internal_error", "Boom."));

    const readings = await readSources(ACCESS, NOW);

    expect(readings.sources.ok).toBe(true);
    expect(readings.catalog).toEqual({ ok: false, reason: "Boom." });
    expect(readings.statuses.size).toBe(2);
  });

  it("asks for no status when the listing itself was refused", async () => {
    list.mockRejectedValue(new ApiError(503, "unavailable", "Down."));

    const readings = await readSources(ACCESS, NOW);

    expect(readings.sources).toEqual({ ok: false, reason: "Down." });
    expect(readings.statuses.size).toBe(0);
    expect(status).not.toHaveBeenCalled();
  });

  it("degrades one row's status without touching its neighbours", async () => {
    status.mockImplementation((id: string) =>
      id === SEEDED_JIRA_ID
        ? Promise.reject(new ApiError(404, "ticket_source_not_found", "Gone."))
        : Promise.resolve(statusReport({ sourceId: id })),
    );

    const readings = await readSources(ACCESS, NOW);

    expect(readings.statuses.get(SEEDED_GITHUB_ID)?.ok).toBe(true);
    expect(readings.statuses.get(SEEDED_JIRA_ID)).toEqual({ ok: false, reason: "Gone." });
  });

  it("lets anything that is not an ApiError through — the redirect signal above all", async () => {
    list.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(readSources(ACCESS, NOW)).rejects.toThrow("NEXT_REDIRECT");
  });
});
