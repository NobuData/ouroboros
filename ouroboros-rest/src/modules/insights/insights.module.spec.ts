import { SchedulerRegistry } from "@nestjs/schedule";
import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { FlakeStateService } from "../flakes/flake-state.service";
import { MAILER, type Mailer } from "../mail/mailer";
import { testConfiguration } from "../config/configuration.fixture";
import { CalibrationController } from "./calibration.controller";
import { CALIBRATION_MERGE_OBSERVER } from "./calibration.observer";
import { CalibrationRepository } from "./calibration.repository";
import { CalibrationService } from "./calibration.service";
import { DigestController } from "./digest/digest.controller";
import { DigestRepository } from "./digest/digest.repository";
import { DigestRunner } from "./digest/digest.runner";
import { DigestRouteComposer } from "./digest/digest.route";
import { DIGEST_TIMEOUT, DigestScheduler } from "./digest/digest.scheduler";
import { DigestService } from "./digest/digest.service";
import { DigestUnsubscribeController } from "./digest/digest.unsubscribe.controller";
import { InsightsModule } from "./insights.module";
import { InterventionsController } from "./interventions.controller";
import { InterventionRepository } from "./interventions.repository";
import { InterventionsService } from "./interventions.service";
import { MetricsCache } from "./metrics/metrics.cache";
import { MetricsRepository } from "./metrics/metrics.repository";
import { MetricsService } from "./metrics/metrics.service";
import { InsightsPageController } from "./page/page.controller";
import { InsightsPageRepository } from "./page/page.repository";
import { InsightsPageService } from "./page/page.service";
import { ROLLUP_EXTRACTORS } from "./rollup/rollup.extractors";
import { RollupRepository } from "./rollup/rollup.repository";
import { RollupScheduler } from "./rollup/rollup.scheduler";
import { ROLLUP_FAMILIES, RollupService } from "./rollup/rollup.service";
import { ScoreboardRepository } from "./scoreboard/scoreboard.repository";
import { SCOREBOARD_SUGGESTIONS, ScoreboardService } from "./scoreboard/scoreboard.service";

/** The wiring (BI.4, #435; BI.2, #433; BI.3, #434; BJ.1, #437; BJ.3, #439). Nothing connects: `pg` connects lazily. */

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

  it("resolves the rollup jobs and binds every metric family to them", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), InsightsModule],
    }).compile();

    expect(moduleRef.get(RollupRepository)).toBeInstanceOf(RollupRepository);
    expect(moduleRef.get(RollupService)).toBeInstanceOf(RollupService);
    expect(moduleRef.get(RollupScheduler)).toBeInstanceOf(RollupScheduler);
    expect(moduleRef.get(ROLLUP_FAMILIES)).toBe(ROLLUP_EXTRACTORS);

    await moduleRef.close();
  });

  it("resolves the intervention re-categorization's route, service and statements", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), InsightsModule],
    }).compile();

    expect(moduleRef.get(InterventionsController)).toBeInstanceOf(InterventionsController);
    expect(moduleRef.get(InterventionsService)).toBeInstanceOf(InterventionsService);
    expect(moduleRef.get(InterventionRepository)).toBeInstanceOf(InterventionRepository);

    await moduleRef.close();
  });

  it("resolves the windowed metrics service over the rollup families (BJ.1, #437)", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), InsightsModule],
    }).compile();

    expect(moduleRef.get(MetricsService)).toBeInstanceOf(MetricsService);
    expect(moduleRef.get(MetricsRepository)).toBeInstanceOf(MetricsRepository);
    expect(moduleRef.get(MetricsCache)).toBeInstanceOf(MetricsCache);

    await moduleRef.close();
  });

  it("resolves the model scoreboard with no AB.3 suggestion source bound (BJ.3, #439)", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), InsightsModule],
    }).compile();

    expect(moduleRef.get(ScoreboardService)).toBeInstanceOf(ScoreboardService);
    expect(moduleRef.get(ScoreboardRepository)).toBeInstanceOf(ScoreboardRepository);
    expect(() => {
      moduleRef.get(SCOREBOARD_SUGGESTIONS, { strict: false });
    }).toThrow();

    await moduleRef.close();
  });

  it("exports the merge observer, the metrics, scoreboard and page services, and the routed digest", () => {
    expect(Reflect.getMetadata("exports", InsightsModule)).toEqual([
      CALIBRATION_MERGE_OBSERVER,
      MetricsService,
      ScoreboardService,
      // The email digest (#440) is assembled from the page's own payload.
      InsightsPageService,
      // The weekly digest as the org `weekly_insights` route sends it (#488).
      DigestRouteComposer,
    ]);
  });

  it("resolves the Insights page's route, service and caps read, with the flakes plane behind it", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), InsightsModule],
    }).compile();

    expect(moduleRef.get(InsightsPageController)).toBeInstanceOf(InsightsPageController);
    expect(moduleRef.get(InsightsPageService)).toBeInstanceOf(InsightsPageService);
    expect(moduleRef.get(InsightsPageRepository)).toBeInstanceOf(InsightsPageRepository);
    // Exported from FlakesModule for the flaky card; resolvable here because it is imported.
    expect(moduleRef.get(FlakeStateService, { strict: false })).toBeInstanceOf(FlakeStateService);

    await moduleRef.close();
  });

  it("resolves the weekly digest: routes, service, runner, loop — and the mailer it sends through", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), InsightsModule],
    }).compile();

    expect(moduleRef.get(DigestController)).toBeInstanceOf(DigestController);
    expect(moduleRef.get(DigestUnsubscribeController)).toBeInstanceOf(DigestUnsubscribeController);
    expect(moduleRef.get(DigestService)).toBeInstanceOf(DigestService);
    expect(moduleRef.get(DigestRepository)).toBeInstanceOf(DigestRepository);
    expect(moduleRef.get(DigestRunner)).toBeInstanceOf(DigestRunner);
    expect(moduleRef.get(DigestScheduler)).toBeInstanceOf(DigestScheduler);
    // MailModule's: a test environment configures no mail server, so it reports `none`.
    expect(moduleRef.get<Mailer>(MAILER, { strict: false }).transport).toBe("none");

    await moduleRef.close();
  });

  it("books no digest timer when the deployment sends no mail", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), InsightsModule],
    }).compile();
    await moduleRef.init();

    expect(moduleRef.get(SchedulerRegistry).doesExist("timeout", DIGEST_TIMEOUT)).toBe(false);

    await moduleRef.close();
  });
});
