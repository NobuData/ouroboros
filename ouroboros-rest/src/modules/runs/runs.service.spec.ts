import type { Run } from "../db/schema";
import { runSummary } from "../dashboard/resources";
import type { NotFoundError } from "../errors/error.envelope";
import type { RunsRepository } from "./runs.repository";
import { RunsService } from "./runs.service";

/**
 * The two rules of the surface, held where they live: the page is assembled through the
 * *aggregate's own mapper* — which is the one-shape criterion as an import rather than a
 * convention — and an absent row is the `404`, whatever the reason for the absence.
 */

/** One row, as the repository returns it. The values are arbitrary; the shape is V008's. */
function row(over: Partial<Run> = {}): Run {
  return {
    id: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
    organization_id: "acme-robotics-id",
    github_repo_id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
    issue_number: 482,
    issue_title: "Fix flaky CAN-bus telemetry test",
    workflow_tag: "standard-fix",
    model: "claude-fable-5",
    status: "coding",
    stage_label: "Implementing",
    stage_index: 4,
    stage_total: 6,
    started_at: new Date("2026-08-13T14:25:01.000Z"),
    finished_at: null,
    pr_number: null,
    checks_passed: null,
    checks_total: null,
    created_at: new Date("2026-08-13T14:25:01.000Z"),
    updated_at: new Date("2026-08-13T14:25:01.000Z"),
    ...over,
  };
}

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

  describe("the detail", () => {
    it("answers the run in the listing's shape", async () => {
      const stored = row({ status: "merged", finished_at: new Date("2026-08-13T15:00:00Z") });
      repository.find.mockResolvedValue(stored);

      await expect(service.read("acme-robotics-id", stored.id)).resolves.toEqual(
        runSummary(stored),
      );
    });

    it("turns absence into run_not_found, naming the id the caller sent", async () => {
      // Absence includes "another workspace's": the repository cannot tell the two apart,
      // so nothing downstream can leak the difference.
      const failure = await service
        .read("acme-robotics-id", "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94")
        .then(() => {
          throw new Error("resolved for a run that does not exist");
        })
        .catch((thrown: NotFoundError) => thrown);

      expect(failure.envelope()).toEqual({
        code: "run_not_found",
        message: "No such run.",
        details: { runId: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94" },
      });
    });
  });
});
