import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../../config/config.module";
import { testConfiguration } from "../../config/configuration.fixture";
import { FakeResearchTool } from "./adapters/fake.tool.fixture";
import { ResearchToolInvoker } from "./research-tool.invoker";
import { RESEARCH_TOOL_ADAPTERS, ResearchToolRegistry } from "./research-tool.registry";
import { ResearchToolSettings } from "./research-tool.settings";
import { ResearchToolsModule } from "./research-tools.module";
import { ResearchToolsInternalController } from "./tools.internal.controller";

/**
 * The wiring. Nothing connects: `pg` connects lazily, and no query is issued.
 */
describe("the research tools module", () => {
  it("compiles, with the internal route and the web tool registered", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), ResearchToolsModule],
    }).compile();

    expect(moduleRef.get(ResearchToolsInternalController)).toBeInstanceOf(
      ResearchToolsInternalController,
    );
    expect(moduleRef.get(ResearchToolInvoker)).toBeInstanceOf(ResearchToolInvoker);
    // CL.2 (#615) registers the web tool; CL.3–CL.6 each register one more.
    expect(moduleRef.get(ResearchToolRegistry).slugs()).toEqual(["web"]);

    await moduleRef.close();
  });

  it("registers adapters under the one token, which a suite can bind to the fake", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), ResearchToolsModule],
    })
      .overrideProvider(RESEARCH_TOOL_ADAPTERS)
      .useValue([new FakeResearchTool()])
      .compile();

    expect(moduleRef.get(ResearchToolRegistry).slugs()).toEqual(["fake"]);

    await moduleRef.close();
  });

  it("lets #629 replace the settings reader", async () => {
    class Stored extends ResearchToolSettings {}

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), ResearchToolsModule],
    })
      .overrideProvider(ResearchToolSettings)
      .useClass(Stored)
      .compile();

    expect(moduleRef.get(ResearchToolSettings)).toBeInstanceOf(Stored);

    await moduleRef.close();
  });

  it("answers nothing configured by default", async () => {
    expect(await new ResearchToolSettings().settingsFor("org-acme", "web")).toBeNull();
  });
});
