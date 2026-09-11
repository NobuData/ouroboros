import type { SyncStatusResource } from "./sync.resources";
import { DEFAULT_BACKLOG_SORT, DEFAULT_BACKLOG_STATE, type ListBacklogQuery } from "./listing.dto";
import type { BacklogListRow, BacklogListingRepository } from "./listing.repository";
import { BacklogListingService, filterOf } from "./listing.service";
import type { SyncStatusService } from "./sync-status.service";

/**
 * The four rules of the listing surface: **the defaults are the mockup's**, **the five reads
 * are one answer**, **`queued` is matched against the queue rather than carried on the row**,
 * and **`syncedAt` is lifted rather than re-derived**.
 *
 * The third is the one that needs a suite of its own. M.4
 * ([#113](https://github.com/NobuData/ouroboros/issues/113)) left this ticket a computed
 * freshness stamp precisely so the tag beside the table and the tag from
 * `GET /api/v1/backlog/sync-status` cannot disagree; a second `max(synced_at)` here would
 * compile, pass every content assertion, and answer a different question — that column moves
 * when a row is written, and the tag is about when a poll *ran*.
 */

const WORKSPACE = "acme-robotics-id";

/** One row, as the statement returns it. */
const ROW: BacklogListRow = {
  id: "5eed0018-0000-4000-8000-000000000485",
  number: 485,
  title: "Watchdog reset on I²C bus lockup",
  labels: ["bug", "i2c"],
  state: "open",
  sizingStatus: "sized",
  githubRepoId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  repository: "acme-robotics/helios-firmware",
  effort: "m",
  confidence: 92,
  suggestedWorkflow: "standard-fix",
  routedModel: "claude-fable-5",
  estMinutes: 45,
};

/** The status the sync endpoint would answer, with the tag's instant on it. */
const STATUS = {
  syncedAt: "2026-09-10T12:00:00.000Z",
  state: "ok",
  pause: null,
  message: null,
  retryAfterSeconds: null,
  running: false,
  repositories: [],
} satisfies SyncStatusResource;

describe("the backlog listing service", () => {
  let backlog: jest.Mocked<BacklogListingRepository>;
  let sync: jest.Mocked<SyncStatusService>;
  let listing: BacklogListingService;

  beforeEach(() => {
    backlog = {
      list: jest.fn().mockResolvedValue([ROW]),
      counts: jest.fn().mockResolvedValue({ total: 9, openCount: 9, sizedCount: 7 }),
      labelFacets: jest.fn().mockResolvedValue(["bug", "i2c"]),
      queuedIssues: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<BacklogListingRepository>;
    sync = {
      status: jest.fn().mockResolvedValue(STATUS),
    } as unknown as jest.Mocked<SyncStatusService>;

    listing = new BacklogListingService(backlog, sync);
  });

  describe("the defaults", () => {
    it("opens on the mockup's `Open ▾` and *Sort: estimated effort ▾*", async () => {
      await listing.list(WORKSPACE, {});

      expect(backlog.list).toHaveBeenCalledWith(
        WORKSPACE,
        { state: DEFAULT_BACKLOG_STATE },
        DEFAULT_BACKLOG_SORT,
        { limit: 25, offset: 0 },
      );
    });

    it("carries every filter through untouched when one is named", async () => {
      const query: ListBacklogQuery = {
        repo: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
        labels: ["bug", "tech-debt"],
        state: "all",
        sort: "number",
        q: "watchdog",
        limit: 10,
        offset: 20,
      };

      await listing.list(WORKSPACE, query);

      expect(backlog.list).toHaveBeenCalledWith(
        WORKSPACE,
        {
          repoId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
          state: "all",
          labels: ["bug", "tech-debt"],
          search: "watchdog",
        },
        "number",
        { limit: 10, offset: 20 },
      );
    });

    it("resolves a query string to a filter with nothing undefined in it", () => {
      // The repository is never handed an `undefined` to decide about: an absent parameter is an
      // absent key, so a predicate is added or it is not.
      expect(filterOf({})).toEqual({ state: "open" });
      expect(Object.keys(filterOf({}))).toEqual(["state"]);
    });
  });

  describe("the one answer", () => {
    it("reads rows, counts, facets, the queue and freshness together", async () => {
      await listing.list(WORKSPACE, {});

      expect(backlog.list).toHaveBeenCalledTimes(1);
      expect(backlog.counts).toHaveBeenCalledTimes(1);
      expect(backlog.labelFacets).toHaveBeenCalledTimes(1);
      expect(backlog.queuedIssues).toHaveBeenCalledTimes(1);
      expect(sync.status).toHaveBeenCalledWith(WORKSPACE);
    });

    it("counts against the same filter the rows were read with", async () => {
      // A page whose `total` came from a different `where` is a page number that is wrong at the
      // end of the list.
      await listing.list(WORKSPACE, { labels: ["bug"], q: "watchdog" });

      const [, rowFilter] = backlog.list.mock.calls[0];
      const [, countFilter] = backlog.counts.mock.calls[0];

      expect(countFilter).toEqual(rowFilter);
    });

    it("builds the chip set from the scope, not from the chips", async () => {
      // Selecting `bug` must not delete every other chip: the facets take the repository and
      // nothing else.
      await listing.list(WORKSPACE, {
        repo: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
        labels: ["bug"],
        state: "closed",
        q: "watchdog",
      });

      expect(backlog.labelFacets).toHaveBeenCalledWith(
        WORKSPACE,
        "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
      );
    });

    it("reads the queue under the same repository the rows were read under", async () => {
      // A listing narrowed to one repository must not draw its pills from another's queue —
      // and, filtered or not, the queue read is the whole workspace's rather than the page's,
      // so a row on page 3 is decided by the same set page 1 was.
      await listing.list(WORKSPACE, {
        repo: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
        offset: 50,
      });

      expect(backlog.queuedIssues).toHaveBeenCalledWith(
        WORKSPACE,
        "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
      );
    });

    it("assembles the page, the head and the chips into one body", async () => {
      expect(await listing.list(WORKSPACE, {})).toEqual({
        items: [expect.objectContaining({ number: 485 })],
        total: 9,
        limit: 25,
        offset: 0,
        meta: { openCount: 9, sizedCount: 7, syncedAt: "2026-09-10T12:00:00.000Z" },
        labelFacets: ["bug", "i2c"],
      });
    });

    it("keeps `total` and the head's counts as different numbers", async () => {
      // `total` is what the filter matched; the head is what is in the backlog. A screen showing
      // one filtered row over *"9 open issues"* is right, and a `total` of 9 would be wrong.
      backlog.counts.mockResolvedValue({ total: 1, openCount: 9, sizedCount: 7 });

      const answer = await listing.list(WORKSPACE, { q: "#485" });

      expect(answer.total).toBe(1);
      expect(answer.meta.openCount).toBe(9);
    });
  });

  describe("the queued pill", () => {
    it("is false for an issue the queue does not hold", async () => {
      const [row] = (await listing.list(WORKSPACE, {})).items;

      expect(row.queued).toBe(false);
    });

    it("is true for one it does, without touching the sizing status", async () => {
      backlog.queuedIssues.mockResolvedValue([
        { githubRepoId: ROW.githubRepoId, number: ROW.number },
      ]);

      const [row] = (await listing.list(WORKSPACE, {})).items;

      expect(row.queued).toBe(true);
      expect(row.sizingStatus).toBe("sized");
    });

    it("does not draw the pill on another repository's issue of the same number", async () => {
      // `queue_items` is unique on `(organization_id, issue_number)` and so holds one `#485`
      // per workspace however many repositories number one — V009's deliberate over-reach. For
      // display that key is too wide, which is why the match carries the repository too.
      backlog.queuedIssues.mockResolvedValue([
        { githubRepoId: "0f0f0f0f-0000-4000-8000-000000000001", number: ROW.number },
      ]);

      const [row] = (await listing.list(WORKSPACE, {})).items;

      expect(row.queued).toBe(false);
    });
  });

  describe("the freshness stamp", () => {
    it("is the sync endpoint's own number", async () => {
      const answer = await listing.list(WORKSPACE, {});

      expect(answer.meta.syncedAt).toBe(STATUS.syncedAt);
    });

    it("is null when no poll has stamped one, rather than the time of this request", async () => {
      // The ticket's criterion. A request timestamp would read as *"synced just now"* on a sync
      // that last ran yesterday — or never.
      sync.status.mockResolvedValue({ ...STATUS, syncedAt: null });

      expect((await listing.list(WORKSPACE, {})).meta.syncedAt).toBeNull();
    });
  });

  describe("an empty workspace", () => {
    it("answers a page with zeros and no chips, which is a state to render", async () => {
      backlog.list.mockResolvedValue([]);
      backlog.counts.mockResolvedValue({ total: 0, openCount: 0, sizedCount: 0 });
      backlog.labelFacets.mockResolvedValue([]);
      backlog.queuedIssues.mockResolvedValue([]);

      const answer = await listing.list(WORKSPACE, {});

      expect(answer.items).toEqual([]);
      expect(answer.meta).toEqual({ openCount: 0, sizedCount: 0, syncedAt: STATUS.syncedAt });
      expect(answer.labelFacets).toEqual([]);
    });
  });
});
