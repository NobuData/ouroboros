import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import {
  READ_AT,
  SEEDED_GITHUB_ID,
  SEEDED_JIRA_ID,
  backlogToken,
  catalogPayload,
  sourcePage,
  statusReport,
} from "../helpers/sources";

const list = vi.fn();
const catalog = vi.fn();
const status = vi.fn();
const readToken = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/sources", () => ({
  sources: {
    list: () => list(),
    catalog: () => catalog(),
    status: (id: string) => status(id),
  },
}));

vi.mock("@/app/api/github-token", () => ({ githubToken: { read: () => readToken() } }));

const { readSources } = await import("@/app/sources/data");

/**
 * The page's reader ([#141](https://github.com/NobuData/ouroboros/issues/141)): two reads at
 * once, then one per source, and one failed read is one degraded region.
 */

type Access = Parameters<typeof readSources>[0];

/** A reader the service tells about the backlog token, and one it does not. */
const ACCESS = { membership: { roles: ["owner"] } } as unknown as Access;
const VIEWER_ACCESS = { membership: { roles: ["viewer"] } } as unknown as Access;

const NOW = new Date(READ_AT);

beforeEach(() => {
  list.mockReset().mockResolvedValue(sourcePage());
  catalog.mockReset().mockResolvedValue(catalogPayload());
  readToken.mockReset().mockResolvedValue(backlogToken());
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

  it("reads the backlog token's state for an owner or an admin", async () => {
    const readings = await readSources(ACCESS, NOW);

    expect(readings.backlogToken).toEqual({ ok: true, value: backlogToken() });
  });

  it("does not ask for it on behalf of a reader the service would refuse", async () => {
    const readings = await readSources(VIEWER_ACCESS, NOW);

    expect(readings.backlogToken).toBeNull();
    expect(readToken).not.toHaveBeenCalled();
  });

  it("degrades the token's state alone when its read failed", async () => {
    readToken.mockRejectedValue(new ApiError(503, "unavailable", "Try again shortly."));

    const readings = await readSources(ACCESS, NOW);

    expect(readings.backlogToken).toEqual({ ok: false, reason: "Try again shortly." });
    expect(readings.sources.ok).toBe(true);
  });
});
