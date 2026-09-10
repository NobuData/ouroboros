import { Test } from "@nestjs/testing";

import { AuditService } from "../audit/audit.service";
import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DatabaseService } from "../db/db.service";
import { BacklogSyncModule } from "./backlog-sync.module";
import { BacklogSyncRepository } from "./backlog-sync.repository";
import { BacklogSyncScheduler } from "./backlog-sync.scheduler";
import { BacklogSyncService } from "./backlog-sync.service";
import { EstimationOrchestrator } from "../estimation/estimation.orchestrator";
import { ESTIMATION_INTAKE, type EstimationIntake } from "./estimation.intake";

/**
 * The wiring, which is where this module's one replaceable decision lives.
 *
 * `ESTIMATION_INTAKE` is the seam L.3
 * ([#107](https://github.com/NobuData/ouroboros/issues/107)) plugged into: it replaced one
 * binding and changed nothing else here. What is bound now is the orchestrator, and asserting
 * that is what makes *"a new issue enters the estimation pipeline"* a criterion with a visible,
 * checkable answer rather than an implied one — including the part that is easy to get wrong,
 * which is that the sync and the sweep share **one** orchestrator and therefore one work queue.
 *
 * Built with a stand-in `DatabaseService`, because constructing the real one opens a pool —
 * which is precisely what a suite that starts nothing must not do.
 */

describe("the backlog sync module", () => {
  /**
   * Build the module over a validated configuration and a database that never connects.
   *
   * @returns The compiled testing module.
   */
  async function build() {
    return Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), BacklogSyncModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .overrideProvider(AuditService)
      .useValue({ record: jest.fn() })
      .compile();
  }

  it("provides the cycle, its statements and its loop", async () => {
    const module = await build();

    expect(module.get(BacklogSyncService)).toBeInstanceOf(BacklogSyncService);
    expect(module.get(BacklogSyncRepository)).toBeInstanceOf(BacklogSyncRepository);
    expect(module.get(BacklogSyncScheduler)).toBeInstanceOf(BacklogSyncScheduler);
  });

  it("declares no controller — the sync routes live in `backlog/`", async () => {
    const module = await build();

    // `POST /backlog/sync` and `GET /backlog/sync-status` landed in `BacklogModule` (#113);
    // this module owns the cycle they call. Keeping the routes out is what preserves its one
    // property: nothing an HTTP request does can reach inside a cycle. Asserted over the
    // decorator's metadata, which is what Nest itself reads.
    expect(Reflect.getMetadata("controllers", BacklogSyncModule)).toBeUndefined();
    expect(module.get(BacklogSyncService)).toBeInstanceOf(BacklogSyncService);
  });

  it("exports the three things M.4's surface reads, and nothing else", () => {
    // The service for the last cycle's pause reasons, the repository for the stored cursors
    // and freshness stamps beside them, and the scheduler so a trigger can drive one cycle
    // without reaching into the private timer. A fourth export would be this module's
    // internals becoming somebody else's dependency.
    const exports = Reflect.getMetadata("exports", BacklogSyncModule) as { name: string }[];

    expect(exports.map((exported) => exported.name)).toEqual([
      "BacklogSyncService",
      "BacklogSyncRepository",
      "BacklogSyncScheduler",
    ]);
  });

  it("binds the intake to L.3's orchestrator", async () => {
    const module = await build();

    expect(module.get<EstimationIntake>(ESTIMATION_INTAKE)).toBeInstanceOf(EstimationOrchestrator);
  });

  it("binds the *same* orchestrator the estimation module provides, not a second one", async () => {
    const module = await build();

    // `useExisting`, not `useClass`. A second instance would be a second work queue with its
    // own bound and its own dedupe set: the sync's issues and the recovery sweep's would stop
    // being able to see each other, and `OURO_ESTIMATION_CONCURRENCY` would silently mean twice
    // what it says. Identity is the only way to assert that from outside.
    expect(module.get<EstimationIntake>(ESTIMATION_INTAKE)).toBe(
      module.get(EstimationOrchestrator),
    );
  });

  it("resolves the intake into the service through the token", async () => {
    // The seam is only a seam if the service depends on the token rather than on the class.
    const other: EstimationIntake = { accept: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), BacklogSyncModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .overrideProvider(AuditService)
      .useValue({ record: jest.fn() })
      .overrideProvider(ESTIMATION_INTAKE)
      .useValue(other)
      .compile();

    expect(module.get(BacklogSyncService)).toBeInstanceOf(BacklogSyncService);
    expect(module.get<EstimationIntake>(ESTIMATION_INTAKE)).toBe(other);
  });
});
