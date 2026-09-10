import { Test } from "@nestjs/testing";

import { AuditService } from "../audit/audit.service";
import { BacklogSyncScheduler } from "../backlog-sync/backlog-sync.scheduler";
import { BacklogSyncService } from "../backlog-sync/backlog-sync.service";
import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DatabaseService } from "../db/db.service";
import { GithubRateLimiter } from "../github/github.rate-limit";
import { BacklogController } from "./backlog.controller";
import { BacklogModule } from "./backlog.module";
import { BacklogDetailController } from "./detail.controller";
import { BacklogDetailRepository } from "./detail.repository";
import { BacklogDetailService } from "./detail.service";
import { BacklogListingController } from "./listing.controller";
import { BacklogListingRepository } from "./listing.repository";
import { BacklogListingService } from "./listing.service";
import { SyncStatusService } from "./sync-status.service";
import { SyncTriggerService } from "./sync-trigger.service";

/**
 * The wiring, and the two identities that make this module's answers the loop's answers
 * rather than a second opinion about them.
 *
 * `GithubModule` exports `GithubRateLimiter` *"so that a caller reporting a paused state reads
 * the same budget the client enforces"*, and `BacklogSyncModule` exports its service and
 * scheduler so a status endpoint can read the last cycle and a trigger can drive one. Both
 * only hold if what is injected here is the **same instance** the sync uses — a second
 * limiter would have no evidence to refuse anything, and a second scheduler would be a second
 * loop. Identity is the only way to assert that from outside.
 *
 * Built with a stand-in `DatabaseService`, because constructing the real one opens a pool —
 * which is precisely what a suite that starts nothing must not do.
 */

describe("the backlog module", () => {
  /**
   * Build the module over a validated configuration and a database that never connects.
   *
   * @returns The compiled testing module.
   */
  async function build() {
    return Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), BacklogModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .overrideProvider(AuditService)
      .useValue({ record: jest.fn() })
      .compile();
  }

  it("compiles, and resolves the route and both services", async () => {
    const module = await build();

    expect(module.get(BacklogController)).toBeInstanceOf(BacklogController);
    expect(module.get(SyncStatusService)).toBeInstanceOf(SyncStatusService);
    expect(module.get(SyncTriggerService)).toBeInstanceOf(SyncTriggerService);

    await module.close();
  });

  it("reads the rate guard the GitHub client enforces, not a second one", async () => {
    const module = await build();

    // One limiter per process: a second would be a countdown on the card that the client has
    // never agreed to.
    expect(module.get(GithubRateLimiter)).toBeInstanceOf(GithubRateLimiter);
    expect(module.get(SyncStatusService)).toBeDefined();

    await module.close();
  });

  it("drives the sync's own loop and reads its own report", async () => {
    const module = await build();

    expect(module.get(BacklogSyncScheduler)).toBeInstanceOf(BacklogSyncScheduler);
    expect(module.get(BacklogSyncService)).toBeInstanceOf(BacklogSyncService);

    await module.close();
  });

  it("exports nothing", () => {
    // The routes are the surface — the queue and dashboard modules' rule. A module wanting
    // the freshness stamp calls the endpoint or imports the sync's repository.
    const exports = Reflect.getMetadata("exports", BacklogModule) as unknown[] | undefined;

    expect(exports ?? []).toEqual([]);
  });

  it("runs no loop of its own", () => {
    // The division with `BacklogSyncModule`: that module owns a cycle and declares no route,
    // and this one declares routes and owns no cycle. A scheduler here would be a second
    // poller nobody asked for. The list grew by M.1's two and M.2's two, and by nothing that
    // ticks.
    const providers = (Reflect.getMetadata("providers", BacklogModule) as unknown[]).map(
      (provider) => (provider as { name?: string }).name,
    );

    expect(providers).toEqual([
      "SyncStatusService",
      "SyncTriggerService",
      "BacklogListingRepository",
      "BacklogListingService",
      "BacklogDetailRepository",
      "BacklogDetailService",
    ]);
    expect(providers).not.toContain("BacklogSyncScheduler");
  });

  it("resolves the listing, and reads the database through a repository of its own", async () => {
    // M.1's read enters through `listing.repository.ts` rather than through the sync's or the
    // estimation module's: those two own *writers* — a poll and a versioned insert — and a
    // screen's read has no business entering through either.
    const module = await build();

    expect(module.get(BacklogListingController)).toBeInstanceOf(BacklogListingController);
    expect(module.get(BacklogListingService)).toBeInstanceOf(BacklogListingService);
    expect(module.get(BacklogListingRepository)).toBeInstanceOf(BacklogListingRepository);

    await module.close();
  });

  it("resolves the detail panel, through a repository of its own", async () => {
    // M.2's read is `detail.repository.ts` for M.1's reason: `BacklogSyncModule` and
    // `EstimationModule` own writers — a poll and a versioned insert — and a screen's read has no
    // business entering through either.
    const module = await build();

    expect(module.get(BacklogDetailController)).toBeInstanceOf(BacklogDetailController);
    expect(module.get(BacklogDetailService)).toBeInstanceOf(BacklogDetailService);
    expect(module.get(BacklogDetailRepository)).toBeInstanceOf(BacklogDetailRepository);

    await module.close();
  });

  it("lists the literal-segment controller before the parameterised one", () => {
    // A routing rule rather than a preference, and M.2 is what made it one: Express matches in
    // registration order, so `BacklogDetailController` ahead of `BacklogController` would turn
    // every `GET /backlog/sync-status` into a request for an issue whose id is the word
    // *sync-status*. `detail.integration-spec.ts` asserts the consequence over a real router.
    const controllers = (Reflect.getMetadata("controllers", BacklogModule) as unknown[]).map(
      (controller) => (controller as { name?: string }).name,
    );

    expect(controllers).toEqual([
      "BacklogController",
      "BacklogListingController",
      "BacklogDetailController",
    ]);
  });
});
