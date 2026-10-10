/**
 * Building the telemetry tool from the application's providers (CL.6,
 * [#619](https://github.com/NobuData/ouroboros/issues/619)).
 */

import type { MetricsService } from "../../../../insights/metrics/metrics.service";
import type { TelemetryRepository } from "../../../telemetry/telemetry.repository";
import { TelemetryResearchTool } from "./telemetry.tool";

/**
 * The telemetry tool over the live planes.
 *
 * @param repository - The test, run and baseline reads.
 * @param metrics - The insights plane's service.
 * @returns The adapter.
 */
export function buildTelemetryTool(
  repository: TelemetryRepository,
  metrics: MetricsService,
): TelemetryResearchTool {
  return new TelemetryResearchTool(repository, metrics);
}
