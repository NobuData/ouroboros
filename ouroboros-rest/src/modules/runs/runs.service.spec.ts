import { runSummary } from "../dashboard/resources";
import { runRow as row } from "./runs.fixture";
import type { RunsRepository } from "./runs.repository";
import { RunsService } from "./runs.service";

/**
 * The listing's rule, held where it lives: the page is assembled through the *aggregate's own
 * mapper* — which is the one-shape criterion as an import rather than a convention. The
 * one-run read (and its `404`) is the console's since AP.2: `console.service.spec.ts`.
 */

describe("the runs service", () => {
  let repository: jest.Mocked<RunsRepository>;
  let service: RunsService;

  beforeEach(() => {
    repository = {
      list: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RunsRepository>;

    service = new RunsService(repository);
  });

  describe("the listing", () => {
    it("assembles the #31 page from the rows and the total", async () => {
      repository.list.mockResolvedValue([row()]);
      repository.count.mockResolvedValue(42);

      const page = await service.list("acme-robotics-id", { status: "active" });

      expect(page.total).toBe(42);
      expect(page.limit).toBe(25);
      expect(page.offset).toBe(0);
      expect(page.items).toHaveLength(1);
    });

    it("maps every row through the aggregate's own mapper", async () => {
      // The byte-identity criterion, met by construction: the item and what the dashboard's
      // slices produce from the same row are the same call.
      const stored = row();
      repository.list.mockResolvedValue([stored]);
      repository.count.mockResolvedValue(1);

      const page = await service.list("acme-robotics-id", { status: "active" });

      expect(page.items[0]).toEqual(runSummary(stored));
    });

    it("resolves the window before the repository sees it", async () => {
      await service.list("acme-robotics-id", { status: "terminal", limit: 10, offset: 30 });

      expect(repository.list).toHaveBeenCalledWith(
        "acme-robotics-id",
        { status: "terminal", repoId: undefined },
        { limit: 10, offset: 30 },
      );
    });

    it("hands the repo filter to both statements", async () => {
      const repo = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

      await service.list("acme-robotics-id", { status: "active", repo });

      const filter = { status: "active", repoId: repo };
      expect(repository.list).toHaveBeenCalledWith("acme-robotics-id", filter, {
        limit: 25,
        offset: 0,
      });
      expect(repository.count).toHaveBeenCalledWith("acme-robotics-id", filter);
    });
  });
});
