import { Test } from "@nestjs/testing";

import { AuditService } from "../audit/audit.service";
import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DatabaseService } from "../db/db.service";
import { BacklogSyncModule } from "./backlog-sync.module";
import { BacklogSyncRepository } from "./backlog-sync.repository";
import { BacklogSyncScheduler } from "./backlog-sync.scheduler";
import { BacklogSyncService } from "./backlog-sync.service";
import {
  ESTIMATION_INTAKE,
  LoggingEstimationIntake,
  type EstimationIntake,
} from "./estimation.intake";

/**
 * The wiring, which is where this module's one replaceable decision lives.
 *
 * `ESTIMATION_INTAKE` is the seam L.3
 * ([#107](https://github.com/NobuData/ouroboros/issues/107)) plugs into: it replaces one
 * binding and changes nothing else here. Until it does, the placeholder is what is bound —
 * and asserting that here is what makes *"a new issue enters the estimation pipeline"* a
 * criterion with a visible, checkable, current answer rather than an implied one.
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

  it("declares no controller — the sync routes are M.4's", async () => {
    const module = await build();

    // `POST /backlog/sync` and `GET /backlog/sync-status` are #113's; this ticket owns the
    // cycle they will call, which is why the service is exported and no route is mounted.
    // Asserted over the decorator's metadata, which is what Nest itself reads.
    expect(Reflect.getMetadata("controllers", BacklogSyncModule)).toBeUndefined();
    expect(module.get(BacklogSyncService)).toBeInstanceOf(BacklogSyncService);
  });

  it("binds the placeholder intake until L.3 replaces it", async () => {
    const module = await build();

    expect(module.get<EstimationIntake>(ESTIMATION_INTAKE)).toBeInstanceOf(LoggingEstimationIntake);
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
