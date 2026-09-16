import { Test } from "@nestjs/testing";

import { AuditService } from "../audit/audit.service";
import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DatabaseService } from "../db/db.service";
import { supportsWrites } from "../ticket-sources/ticket-source.provider";
import { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import { PlanningModule } from "./planning.module";
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
});
