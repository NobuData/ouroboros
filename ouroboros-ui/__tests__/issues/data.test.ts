import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/app/api/access";
import type { BacklogQuery } from "@/app/api/backlog";
import { ApiError } from "@/app/api/errors";
import { DEFAULT_FILTER } from "@/app/issues/filter";
import { PAGE_SIZE } from "@/app/issues/paging";

import { ATLAS, HELIOS, READ_AT, SEEDED_FACETS, SYNCED, backlogListing } from "../helpers/issues";
import { TENANT_ID, enablement, membership, org, repo, sessionUser } from "../helpers/login";

/**
 * The intake page's reader (#115, #116, #120).
 *
 * Four reads issued together, and the suite is about what each is for and how each fails alone:
 * the **view** is asked with the filter bar's query and is where the head's two counts and the chip
 * set come from; the **scope** is asked as `state=all` and is where the confirmation's mirrored
 * count comes from, whatever the bar says; the **enablement** list fills the repository select; the
 * **status** is M.4's, for the guidance and the banner. A refused read is a value rather than a
 * throw, and anything that is not a refusal keeps travelling, which is what keeps a session that
 * expired mid-render from being drawn as an uncounted backlog instead of reaching the login screen.
 */

vi.mock("server-only", () => ({}));

/** What the listing answers each query with, or the signal it throws instead. */
const list = vi.fn();

/** What the status read answers with. */
const status = vi.fn();

/** What the enablement read answers with. */
const readEnablement = vi.fn();

vi.mock("@/app/api/backlog", () => ({
  backlog: { list: (query: unknown) => list(query), status: () => status() },
}));
vi.mock("@/app/api/enablement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/api/enablement")>()),
  readEnablement: (tenantId: string) => readEnablement(tenantId),
}));

const { readIssues } = await import("@/app/issues/data");

/** The workspace the gate hands over. */
const ACCESS: Workspace = {
  session: {
    user: sessionUser(),
    memberships: [membership()],
    membershipTotal: 1,
    activeOrganizationId: TENANT_ID,
    tenantSuggestion: null,
  },
  membership: membership(),
};

/** The seeded workspace's enablement list: one organisation, its two repositories enabled. */
const ENABLEMENT = enablement([
  [
    org(),
    [
      repo({ id: HELIOS.id, name: HELIOS.name }),
      repo({ id: ATLAS.id, name: ATLAS.name }),
      repo({ id: "5eed0006-0000-4000-8000-000000000009", name: "switched-off", enabled: false }),
    ],
  ],
]);

/** Whether a query is the view's — the one carrying the bar's sort — rather than the scope's. */
function isView(query: BacklogQuery): boolean {
  return "sort" in query;
}

/**
 * Answer the two listings differently.
 *
 * @param view What the view listing answers.
 * @param scope What the scope listing answers.
 */
function answer(view: unknown, scope: unknown): void {
  list.mockImplementation((query: BacklogQuery) => (isView(query) ? view : scope));
}

beforeEach(() => {
  list.mockReset().mockResolvedValue(backlogListing());
  status.mockReset().mockResolvedValue(SYNCED.ok ? SYNCED.value : undefined);
  readEnablement.mockReset().mockResolvedValue(ENABLEMENT);
});

describe("what is asked", () => {
  it("asks the view with the bar's query, one page long, from the first page", async () => {
    await readIssues(ACCESS, { ...DEFAULT_FILTER, repo: HELIOS.id, labels: ["bug"], q: "bus" });

    expect(list).toHaveBeenCalledWith({
      repo: HELIOS.id,
      labels: ["bug"],
      state: "open",
      sort: "effort",
      q: "bus",
      limit: PAGE_SIZE,
      offset: 0,
    });
  });

  it("turns the address's page into the view's offset (#117)", async () => {
    await readIssues(ACCESS, DEFAULT_FILTER, 3);

    expect(list).toHaveBeenCalledWith({
      state: "open",
      sort: "effort",
      limit: PAGE_SIZE,
      offset: PAGE_SIZE * 2,
    });
  });

  it("asks the scope for every state and nothing else, one row long, whatever the bar says", async () => {
    await readIssues(ACCESS, { ...DEFAULT_FILTER, repo: HELIOS.id, state: "closed" });

    expect(list).toHaveBeenCalledWith({ state: "all", limit: 1 });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("asks for the enablement list of the workspace the gate resolved", async () => {
    await readIssues(ACCESS, DEFAULT_FILTER);

    expect(readEnablement).toHaveBeenCalledExactlyOnceWith(TENANT_ID);
  });

  it("asks for the sync's status, once, beside the rest (#120)", async () => {
    await readIssues(ACCESS, DEFAULT_FILTER);

    expect(status).toHaveBeenCalledOnce();
  });
});

describe("reading the seeded workspace", () => {
  it("reads nine open, seven sized, nine mirrored, the four labels, the two enabled repositories, the page and the status", async () => {
    expect(await readIssues(ACCESS, DEFAULT_FILTER, 1, () => READ_AT)).toEqual({
      counts: { ok: true, value: { openCount: 9, sizedCount: 7, mirroredCount: 9 } },
      facets: { ok: true, value: SEEDED_FACETS },
      repos: { ok: true, value: [HELIOS, ATLAS] },
      listing: { ok: true, value: backlogListing() },
      sync: SYNCED,
      readAt: READ_AT,
    });
  });

  it("reads the clock once, beside the reads, so the freshness tag has one instant to measure from", async () => {
    let ticks = 0;

    const { readAt } = await readIssues(ACCESS, DEFAULT_FILTER, 1, () => {
      ticks += 1;
      return READ_AT + ticks;
    });

    expect(ticks).toBe(1);
    expect(readAt).toBe(READ_AT + 1);
  });

  it("takes the head's counts from the view and the mirrored count from the scope", async () => {
    // A repository selected: the view counts that repository, the scope still counts the
    // workspace — the set Re-estimate all claims from.
    answer(
      backlogListing({ openCount: 3, sizedCount: 2, total: 3, labelFacets: ["bug"] }),
      backlogListing({ openCount: 9, total: 12 }),
    );

    const { counts, facets } = await readIssues(ACCESS, { ...DEFAULT_FILTER, repo: HELIOS.id });

    expect(counts).toEqual({ ok: true, value: { openCount: 3, sizedCount: 2, mirroredCount: 12 } });
    expect(facets).toEqual({ ok: true, value: ["bug"] });
  });
});

describe("one read failing", () => {
  it("keeps a refused view as the reason for the counts, the chip set and the page", async () => {
    answer(
      Promise.reject(new ApiError(400, "organization_required", "Choose a workspace.")),
      backlogListing(),
    );

    const readings = await readIssues(ACCESS, DEFAULT_FILTER);

    expect(readings.counts).toEqual({ ok: false, reason: "Choose a workspace." });
    expect(readings.facets).toEqual({ ok: false, reason: "Choose a workspace." });
    expect(readings.listing).toEqual({ ok: false, reason: "Choose a workspace." });
    expect(readings.repos).toEqual({ ok: true, value: [HELIOS, ATLAS] });
  });

  it("keeps a refused scope as the counts' reason, and still draws the chip set and the page", async () => {
    answer(backlogListing(), Promise.reject(new ApiError(503, "unavailable", "Not now.")));

    const readings = await readIssues(ACCESS, DEFAULT_FILTER);

    expect(readings.counts).toEqual({ ok: false, reason: "Not now." });
    expect(readings.facets).toEqual({ ok: true, value: SEEDED_FACETS });
    expect(readings.listing).toEqual({ ok: true, value: backlogListing() });
  });

  it("keeps a refused enablement list as the select's reason, and still counts", async () => {
    readEnablement.mockRejectedValue(new ApiError(403, "forbidden", "Not yours."));

    const readings = await readIssues(ACCESS, DEFAULT_FILTER);

    expect(readings.repos).toEqual({ ok: false, reason: "Not yours." });
    expect(readings.counts).toEqual({
      ok: true,
      value: { openCount: 9, sizedCount: 7, mirroredCount: 9 },
    });
  });

  it("keeps a refused status as the banner's reason, and still draws the page (#120)", async () => {
    status.mockRejectedValue(new ApiError(503, "unavailable", "Not now."));

    const readings = await readIssues(ACCESS, DEFAULT_FILTER);

    expect(readings.sync).toEqual({ ok: false, reason: "Not now." });
    expect(readings.listing).toEqual({ ok: true, value: backlogListing() });
  });
});

describe("what keeps travelling", () => {
  it("lets a redirect through rather than drawing around it", async () => {
    list.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(readIssues(ACCESS, DEFAULT_FILTER)).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("lets a dropped connection through too, since it is not an answer from the service", async () => {
    readEnablement.mockRejectedValue(new TypeError("fetch failed"));

    await expect(readIssues(ACCESS, DEFAULT_FILTER)).rejects.toThrow(TypeError);
  });
});
