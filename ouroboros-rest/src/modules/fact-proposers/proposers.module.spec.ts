/** The proposers module's wiring (#412). */

import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { FactProposersController } from "./proposers.controller";
import { FactProposersModule } from "./proposers.module";
import { FACT_SOURCE_OBSERVER } from "./proposers.observer";
import { ProposerRepository } from "./proposers.repository";
import { FactProposersService } from "./proposers.service";

describe("the fact proposers module", () => {
  it("compiles, resolves every layer, and binds the source observer to the service", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), FactProposersModule],
    }).compile();

    expect(moduleRef.get(FactProposersController)).toBeInstanceOf(FactProposersController);
    expect(moduleRef.get(ProposerRepository)).toBeInstanceOf(ProposerRepository);
    expect(moduleRef.get(FACT_SOURCE_OBSERVER)).toBe(moduleRef.get(FactProposersService));

    await moduleRef.close();
  });

  it("exports the source observer and nothing else", () => {
    expect(Reflect.getMetadata("exports", FactProposersModule)).toEqual([FACT_SOURCE_OBSERVER]);
  });

  it("imports none of the source writers, so they can import it without a cycle", () => {
    const imports = (
      Reflect.getMetadata("imports", FactProposersModule) as { name?: string }[]
    ).map((imported) => imported.name);

    expect(imports).not.toEqual(
      expect.arrayContaining(["ControlsModule", "TriageModule", "PullRequestsModule"]),
    );
    expect(imports).toContain("FactsModule");
  });
});
