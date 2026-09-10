import type { BacklogSyncRepository, SyncTarget } from "../backlog-sync/backlog-sync.repository";
import type { BacklogSyncScheduler } from "../backlog-sync/backlog-sync.scheduler";
import type { BacklogSyncService } from "../backlog-sync/backlog-sync.service";
import type { SyncCycleReport } from "../backlog-sync/sync.report";
import type { GithubCredentialsService } from "../github/github.credentials.service";
import { GITHUB_FAILURES } from "../github/github.errors";
import type { GithubRateLimiter } from "../github/github.rate-limit";
import { SyncStatusService } from "./sync-status.service";

/**
 * The three reads, and the one property that is this file's rather than
 * `sync.resources.spec.ts`': **it asks the objects the sync itself uses.**
 *
 * That is not a style preference. `GithubModule` exports `GithubRateLimiter` *"so that a
 * caller reporting a paused state reads the same budget the client enforces rather than a
 * second opinion about it"*, and `BacklogSyncService.lastCycle()` is the report K.4 kept for
 * this endpoint. A status endpoint that computed either for itself would be a screen that
 * disagrees with the loop it describes — which is why the assertions below check *what was
 * asked*, and not only what came back.
 */

const ORG = "acme-robotics-id";
const OTHER = "kensuenobu-id";

/** One enabled repository, polled a moment ago. */
const TARGET: SyncTarget = {
  githubRepoId: "5eed000b-0000-4000-8000-000000000001",
  organizationId: ORG,
  owner: "acme-robotics",
  name: "helios-firmware",
  syncedAt: new Date("2026-09-10T14:07:20.000Z"),
  cursor: "2026-09-10T13:59:04.000Z",
};

/** A cycle in which this workspace's token was refused. */
const REFUSED: SyncCycleReport = {
  startedAt: new Date("2026-09-10T14:07:20.000Z"),
  organizations: [{ organizationId: ORG, pause: GITHUB_FAILURES.unauthorized, repositories: [] }],
  pending: false,
};

/** What each collaborator is asked, per test. */
interface Stubs {
  repositories: jest.Mocked<BacklogSyncRepository>;
  credentials: jest.Mocked<GithubCredentialsService>;
  limiter: jest.Mocked<GithubRateLimiter>;
  sync: jest.Mocked<BacklogSyncService>;
  scheduler: jest.Mocked<BacklogSyncScheduler>;
}

/**
 * A service over stand-ins, healthy unless a test says otherwise.
 *
 * @param overrides - What this case is about.
 * @returns The service and the stubs it was built from.
 */
function build(
  overrides: {
    targets?: readonly SyncTarget[];
    configured?: boolean;
    retryAfterSeconds?: number;
    last?: SyncCycleReport;
    running?: boolean;
  } = {},
): { service: SyncStatusService; stubs: Stubs } {
  const stubs = {
    repositories: {
      enabledRepositoriesFor: jest.fn().mockResolvedValue([...(overrides.targets ?? [TARGET])]),
    } as unknown as jest.Mocked<BacklogSyncRepository>,
    credentials: {
      isConfigured: jest.fn().mockResolvedValue(overrides.configured ?? true),
    } as unknown as jest.Mocked<GithubCredentialsService>,
    limiter: {
      retryAfterSeconds: jest.fn().mockReturnValue(overrides.retryAfterSeconds),
    } as unknown as jest.Mocked<GithubRateLimiter>,
    sync: {
      lastCycle: jest.fn().mockReturnValue(overrides.last),
    } as unknown as jest.Mocked<BacklogSyncService>,
    scheduler: {
      running: jest.fn().mockReturnValue(overrides.running ?? false),
    } as unknown as jest.Mocked<BacklogSyncScheduler>,
  };

  return {
    service: new SyncStatusService(
      stubs.repositories,
      stubs.credentials,
      stubs.limiter,
      stubs.sync,
      stubs.scheduler,
    ),
    stubs,
  };
}

describe("reading a workspace's sync status", () => {
  it("asks only about the workspace it was given", async () => {
    // The tenant guard established it; a read that ignored it would be one workspace's page
    // rendering another's repositories.
    const { service, stubs } = build();

    await service.status(ORG);

    expect(stubs.repositories.enabledRepositoriesFor).toHaveBeenCalledWith(ORG);
    expect(stubs.credentials.isConfigured).toHaveBeenCalledWith(ORG);
  });

  it("reads the budget from the same guard the client enforces, with the caller's clock", async () => {
    const now = new Date("2026-09-10T14:10:00.000Z");
    const { service, stubs } = build({ retryAfterSeconds: 1180 });

    const status = await service.status(ORG, now);

    expect(stubs.limiter.retryAfterSeconds).toHaveBeenCalledWith(ORG, now);
    expect(status.pause).toBe(GITHUB_FAILURES.rateLimited);
    expect(status.retryAfterSeconds).toBe(1180);
  });

  it("reads the pause reasons only an attempt can establish from the last cycle", async () => {
    const { service, stubs } = build({ last: REFUSED });

    const status = await service.status(ORG);

    expect(stubs.sync.lastCycle).toHaveBeenCalled();
    expect(status.pause).toBe(GITHUB_FAILURES.unauthorized);
  });

  it("reports the loop as running while a cycle is in flight", async () => {
    const { service } = build({ running: true });

    expect((await service.status(ORG)).running).toBe(true);
  });

  it("answers a state for a workspace that has configured nothing, rather than failing", async () => {
    // Never a 404: the endpoint exists to say *which* nothing this is.
    const { service } = build({ configured: false, targets: [] });

    const status = await service.status(OTHER);

    expect(status.state).toBe("paused");
    expect(status.pause).toBe(GITHUB_FAILURES.notConfigured);
    expect(status.repositories).toEqual([]);
    expect(status.syncedAt).toBeNull();
  });

  it("renders the healthy case as the freshness tag needs it", async () => {
    const { service } = build();

    const status = await service.status(ORG);

    expect(status).toEqual({
      syncedAt: "2026-09-10T14:07:20.000Z",
      state: "ok",
      pause: null,
      message: null,
      retryAfterSeconds: null,
      running: false,
      repositories: [
        {
          githubRepoId: TARGET.githubRepoId,
          repository: "acme-robotics/helios-firmware",
          syncedAt: "2026-09-10T14:07:20.000Z",
          cursor: "2026-09-10T13:59:04.000Z",
          state: "ok",
          pause: null,
          message: null,
          lastResult: null,
        },
      ],
    });
  });
});
