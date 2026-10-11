import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DryRunAftermath } from "./dry-runs.aftermath";
import { DryRunsController } from "./dry-runs.controller";
import { DryRunsModule } from "./dry-runs.module";
import { DryRunPickerService } from "./dry-runs.picker.service";
import { DryRunRunner } from "./dry-runs.runner";
import { DryRunsService } from "./dry-runs.service";
import { DryRunSuggestionsController } from "./suggestions.controller";
import { DryRunSuggestionsService } from "./suggestions.service";

describe("DryRunsModule", () => {
  it("resolves the whole lifecycle from the modules it imports", async () => {
    // The pre-check and harness (engine), each stage's alias (routing) and knowledge (context
    // assembly), the catalogue of names (workflows) and the pinned commit (github): a provider
    // one of them stopped exporting fails here, at boot, rather than on the first dry run.
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), DryRunsModule],
    }).compile();

    expect(moduleRef.get(DryRunsService)).toBeInstanceOf(DryRunsService);
    expect(moduleRef.get(DryRunRunner)).toBeInstanceOf(DryRunRunner);
    expect(moduleRef.get(DryRunsController)).toBeInstanceOf(DryRunsController);

    await moduleRef.close();
  });

  it("exports what the copilot needs and nothing else", () => {
    // The copilot's `lookup_tickets` must rank with the scorer the dry-run menu uses, its
    // `propose_suggestion` is recorded by the suggestions service, and it registers with the
    // aftermath to be told a run ended; nothing else here is anybody else's to call.
    expect(Reflect.getMetadata("exports", DryRunsModule)).toEqual([
      DryRunPickerService,
      DryRunSuggestionsService,
      DryRunAftermath,
    ]);
  });

  it("serves the suggestion routes", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), DryRunsModule],
    }).compile();

    expect(moduleRef.get(DryRunSuggestionsController)).toBeInstanceOf(DryRunSuggestionsController);
    expect(moduleRef.get(DryRunAftermath)).toBeInstanceOf(DryRunAftermath);

    await moduleRef.close();
  });

  it("imports nothing of the copilot's, so the copilot may import it", () => {
    const imports = (Reflect.getMetadata("imports", DryRunsModule) as { name?: string }[]).map(
      (imported) => imported.name,
    );

    expect(imports).toEqual([
      "DbModule",
      "EngineModule",
      "RoutingModule",
      "ContextAssemblyModule",
      "WorkflowsModule",
      "GithubModule",
    ]);
  });
});
