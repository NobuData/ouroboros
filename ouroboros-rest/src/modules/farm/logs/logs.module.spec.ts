import { FarmLogsModule } from "./logs.module";
import { FARM_LOG_RETENTION } from "./log.retention";
import { FarmLogsService } from "./logs.service";

/** The module's shape (#253). */
describe("the build logs module", () => {
  it("imports the gateway, which never imports it back", () => {
    const imported = (Reflect.getMetadata("imports", FarmLogsModule) as { name?: string }[]).map(
      (module) => module.name,
    );

    expect(imported).toEqual(["DbModule", "FarmGatewayModule"]);
  });

  it("exports the read for its readers to come and the retention token for #482", () => {
    expect(Reflect.getMetadata("exports", FarmLogsModule)).toEqual([
      FarmLogsService,
      FARM_LOG_RETENTION,
    ]);
  });

  it("binds the retention policy from the configured budget, thirty days per chunk", () => {
    const providers = Reflect.getMetadata("providers", FarmLogsModule) as {
      provide?: unknown;
      useFactory?: (config: { farmLogBudgetBytes: number }) => unknown;
    }[];
    const retention = providers.find((provider) => provider.provide === FARM_LOG_RETENTION);

    expect(retention?.useFactory?.({ farmLogBudgetBytes: 12_345_678 })).toEqual({
      days: 30,
      budgetBytesPerOrg: 12_345_678,
    });
  });
});
