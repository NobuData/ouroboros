import { Test } from "@nestjs/testing";

import { AuditService } from "../audit/audit.service";
import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DatabaseService } from "../db/db.service";
import { supportsWrites } from "../ticket-sources/ticket-source.provider";
import { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import { BacklogQueueService } from "../backlog/queue.service";
import { EstimationOrchestrator } from "../estimation/estimation.orchestrator";
import { BatchesService } from "./batches.service";
import { PlanningModule } from "./planning.module";
import { QueueSmallHook } from "./queue-small";
import { ReestimationJob } from "./reestimation.job";
import { ReestimationScheduler } from "./reestimation.scheduler";
import { PushRepository } from "./push.repository";
import { PushService } from "./push.service";

/**
 * The wiring (AL.3, [#279](https://github.com/NobuData/ouroboros/issues/279)): the push service
 * resolves over the ticket-source module's registry, and the registry it reaches holds a writable
 * GitHub — so the push AL.4 mounts has somewhere to file.
 *
 * Built with a stand-in `DatabaseService` and `AuditService`, for `ticket-sources.module.spec.ts`'s
 * reason: constructing the real ones opens a pool.
 */
describe("the planning module", () => {
  it("provides the push service over its repository and the SPI's registry", async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), PlanningModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .overrideProvider(AuditService)
      .useValue({ record: jest.fn() })
      .compile();

    expect(module.get(PushService)).toBeInstanceOf(PushService);
    expect(module.get(PushRepository)).toBeInstanceOf(PushRepository);

    const github = module.get(TicketSourceRegistry).find("github");

    expect(github !== undefined && supportsWrites(github)).toBe(true);
  });

  it("sizes through INTAKE-L.3's orchestrator and queues through INTAKE-M.3 — no parallel path", async () => {
    // Decision N3 and N7, verified structurally: the batch service's sizer is the one instance the
    // estimation module exports, the hook's queue write is the backlog module's own service, and
    // this module provides neither of them — nor any estimator, orchestrator or queue of its own.
    const module = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), PlanningModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .overrideProvider(AuditService)
      .useValue({ record: jest.fn() })
      .compile();

    const batches: object = module.get(BatchesService);
    const hook: object = module.get(QueueSmallHook);

    expect(Reflect.get(batches, "orchestrator")).toBe(module.get(EstimationOrchestrator));
    expect(Reflect.get(hook, "queue")).toBe(module.get(BacklogQueueService));

    const provided = (Reflect.getMetadata("providers", PlanningModule) as { name: string }[]).map(
      (provider) => provider.name,
    );

    expect(provided).toEqual([
      "PushService",
      "PushRepository",
      "PlanningRepository",
      "BatchesService",
      "EpicsService",
      "QueueSmallHook",
      "BacklogHealthRepository",
      "BacklogHealthService",
      "ReestimationRepository",
      "ReestimationJob",
      "ReestimationScheduler",
    ]);
    // AL.5's re-estimation job *schedules* sizing and sizes nothing — so the rule is about
    // estimators, orchestrators and sizers, and the job's own three classes are named above.
    expect(
      provided.some((name) =>
        /^(?!Reestimation)(.*estimat|.*sizer|.*queue(service|repository))/i.test(name),
      ),
    ).toBe(false);

    await module.close();
  });

  it("runs the nightly re-estimation through INTAKE-L.3's orchestrator — the one sizer", async () => {
    // AL.5 (#281), verified structurally rather than by behaviour: the job's only way to size a
    // ticket is the orchestrator instance `EstimationModule` exports, and it holds no engine client,
    // estimation repository or queue of its own that a second path could be built from.
    const module = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), PlanningModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .overrideProvider(AuditService)
      .useValue({ record: jest.fn() })
      .compile();

    const job: object = module.get(ReestimationJob);
    const scheduler: object = module.get(ReestimationScheduler);

    expect(Reflect.get(job, "orchestrator")).toBe(module.get(EstimationOrchestrator));
    expect(Reflect.get(scheduler, "job")).toBe(job);

    const dependencies = (
      Reflect.getMetadata("design:paramtypes", ReestimationJob) as { name: string }[]
    ).map((dependency) => dependency.name);

    expect(dependencies).toEqual([
      "ReestimationRepository",
      "EstimationOrchestrator",
      "AppConfigService",
    ]);

    await module.close();
  });
});
