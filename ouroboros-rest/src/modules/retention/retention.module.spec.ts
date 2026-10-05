import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { RetentionController } from "./retention.controller";
import { RetentionModule } from "./retention.module";
import { RetentionSchedule } from "./retention.schedule";
import { RetentionPolicyService } from "./retention.service";

/** The wiring (#482). Nothing connects: `pg` connects lazily, and no query is issued. */
describe("the retention module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), RetentionModule],
    }).compile();

    expect(moduleRef.get(RetentionController)).toBeInstanceOf(RetentionController);
    expect(moduleRef.get(RetentionPolicyService)).toBeInstanceOf(RetentionPolicyService);

    await moduleRef.close();
  });

  it("exports the service and the schedule to the sweeps — one schedule, shared", () => {
    expect(Reflect.getMetadata("exports", RetentionModule)).toEqual([
      RetentionPolicyService,
      RetentionSchedule,
    ]);
  });
});
