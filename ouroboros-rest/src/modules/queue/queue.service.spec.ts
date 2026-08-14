import { queueItemSummary } from "../dashboard/resources";
import type { QueueItem } from "../db/schema";
import type { QueueRepository } from "./queue.repository";
import { QueueService } from "./queue.service";

/**
 * The two rules of the surface, held where they live: the page is assembled through the
 * *aggregate's own mapper* — which is the one-shape criterion as an import rather than a
 * convention — and the totals ride beside the page rather than being recomputed from it,
 * so the whole match speaks even when the window cut it.
 */

/** One row, as the repository returns it. The values are arbitrary; the shape is V009's. */
function row(over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "5eed000a-0000-4000-8000-000000000485",
    organization_id: "acme-robotics-id",
    github_repo_id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
    issue_number: 485,
    issue_title: "Watchdog reset on I²C bus lockup",
    effort: "m",
    workflow_tag: "standard-fix",
    position: 1,
    est_minutes: 45,
    enqueued_at: new Date("2026-08-13T01:37:41.000Z"),
    created_at: new Date("2026-08-13T01:37:41.000Z"),
    updated_at: new Date("2026-08-13T01:37:41.000Z"),
    ...over,
  };
}

describe("the queue service", () => {
  let repository: jest.Mocked<QueueRepository>;
  let service: QueueService;

  beforeEach(() => {
    repository = {
      list: jest.fn().mockResolvedValue([]),
      totals: jest.fn().mockResolvedValue({ count: 0, estMinutes: 0 }),
    } as unknown as jest.Mocked<QueueRepository>;

    service = new QueueService(repository);
  });

  it("assembles the #31 page from the rows and the totals", async () => {
    repository.list.mockResolvedValue([row()]);
    repository.totals.mockResolvedValue({ count: 12, estMinutes: 580 });

    const page = await service.list("acme-robotics-id", {});

    expect(page.total).toBe(12);
    expect(page.totalEstMinutes).toBe(580);
    expect(page.limit).toBe(25);
    expect(page.offset).toBe(0);
    expect(page.items).toHaveLength(1);
  });

  it("maps every row through the aggregate's own mapper", async () => {
    // The byte-identity criterion, met by construction: the item and what the dashboard's
    // `queueHead` slice produces from the same row are the same call — nulls preserved,
    // because an unsized item is not a zero-minute one.
    const stored = row({ est_minutes: null });
    repository.list.mockResolvedValue([stored]);
    repository.totals.mockResolvedValue({ count: 1, estMinutes: 0 });

    const page = await service.list("acme-robotics-id", {});

    expect(page.items[0]).toEqual(queueItemSummary(stored));
    expect(page.items[0].estMinutes).toBeNull();
  });

  it("resolves the window before the repository sees it", async () => {
    await service.list("acme-robotics-id", { limit: 10, offset: 30 });

    expect(repository.list).toHaveBeenCalledWith(
      "acme-robotics-id",
      { repoId: undefined },
      { limit: 10, offset: 30 },
    );
  });

  it("hands the repo filter to both statements", async () => {
    const repo = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

    await service.list("acme-robotics-id", { repo });

    const filter = { repoId: repo };
    expect(repository.list).toHaveBeenCalledWith("acme-robotics-id", filter, {
      limit: 25,
      offset: 0,
    });
    expect(repository.totals).toHaveBeenCalledWith("acme-robotics-id", filter);
  });

  it("reports the totals the repository counted, not the page's own size", async () => {
    // A page 3 of a hundred-item queue still renders "100 queued · est. 9h 40m": the
    // window cuts the rows, never the facts about the whole match.
    repository.list.mockResolvedValue([row()]);
    repository.totals.mockResolvedValue({ count: 100, estMinutes: 580 });

    const page = await service.list("acme-robotics-id", { limit: 1, offset: 2 });

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(100);
    expect(page.totalEstMinutes).toBe(580);
  });
});
