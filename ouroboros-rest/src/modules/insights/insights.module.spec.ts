import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { CalibrationController } from "./calibration.controller";
import { CALIBRATION_MERGE_OBSERVER } from "./calibration.observer";
import { CalibrationRepository } from "./calibration.repository";
import { CalibrationService } from "./calibration.service";
import { InsightsModule } from "./insights.module";

/** The wiring (BI.4, #435). Nothing connects: `pg` connects lazily. */

describe("the insights module", () => {
  it("compiles, resolves every layer, and binds the merge observer to the service", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), InsightsModule],
    }).compile();

    expect(moduleRef.get(CalibrationController)).toBeInstanceOf(CalibrationController);
    expect(moduleRef.get(CalibrationRepository)).toBeInstanceOf(CalibrationRepository);
    expect(moduleRef.get(CALIBRATION_MERGE_OBSERVER)).toBe(moduleRef.get(CalibrationService));

    await moduleRef.close();
  });

  it("exports the merge observer — the PR sync reports merges through it", () => {
    expect(Reflect.getMetadata("exports", InsightsModule)).toEqual([CALIBRATION_MERGE_OBSERVER]);
  });
});
