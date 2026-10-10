import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../../config/config.module";
import { testConfiguration } from "../../config/configuration.fixture";
import { InvestigationLoopModule } from "../loop/investigation-loop.module";
import { InvestigationLoopService } from "../loop/investigation-loop.service";
import { BriefsController } from "./briefs.controller";
import { BriefsModule } from "./briefs.module";
import { BriefsRepository } from "./briefs.repository";
import { BriefsService } from "./briefs.service";
import { MatrixBuilderService } from "./matrix-builder.service";

/**
 * The wiring. Nothing connects: `pg` connects lazily, and no query is issued. The exports are
 * asserted because they are the contracts the investigation loop (#620) and the gaps handoff
 * (#624) build on.
 */
describe("the briefs module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), BriefsModule],
    }).compile();

    expect(moduleRef.get(BriefsController)).toBeInstanceOf(BriefsController);
    expect(moduleRef.get(BriefsService)).toBeInstanceOf(BriefsService);
    expect(moduleRef.get(MatrixBuilderService)).toBeInstanceOf(MatrixBuilderService);
    expect(moduleRef.get(BriefsRepository)).toBeInstanceOf(BriefsRepository);

    await moduleRef.close();
  });

  it("exports the read model and the matrix builder", () => {
    expect(Reflect.getMetadata("exports", BriefsModule)).toEqual([
      BriefsService,
      MatrixBuilderService,
    ]);
  });

  it("gives the investigation loop its matrix builder", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), InvestigationLoopModule],
    }).compile();

    expect(moduleRef.get(InvestigationLoopService)).toBeInstanceOf(InvestigationLoopService);
    expect(moduleRef.get(MatrixBuilderService, { strict: false })).toBeInstanceOf(
      MatrixBuilderService,
    );

    await moduleRef.close();
  });
});
