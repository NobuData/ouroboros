import {
  OVERSHOOT_CASE,
  TELEMETRY_ORG,
  seededTelemetry,
} from "../../../telemetry/telemetry.store.fixture";
import {
  conformanceContext,
  describeToolConformance,
  type ToolConformance,
} from "../../conformance.fixture";
import { TelemetryResearchTool } from "./telemetry.tool";

/**
 * The telemetry tool against the SPI's conformance kit (#614, #619): the same rules every
 * research tool is held to — display, counts, schema, health, citations on every operation, and
 * the error taxonomy.
 */

const NOW = new Date("2026-10-10T02:47:47Z");
const OVERSHOOT = `${OVERSHOOT_CASE}:overshoot_pct`;

/**
 * A tool whose every read of the test planes fails.
 *
 * @param failure - What the read rejects with.
 * @returns The tool.
 */
const failing = (failure: Error) =>
  new TelemetryResearchTool(
    {
      measurements: () => Promise.reject(failure),
      baseline: () => Promise.reject(failure),
      caseHistory: () => Promise.reject(failure),
      flakeContext: () => Promise.reject(failure),
      runDays: () => Promise.reject(failure),
      tokenDays: () => Promise.reject(failure),
      summary: () => Promise.reject(failure),
    },
    seededTelemetry().metrics,
    () => NOW,
  );

describeToolConformance("telemetry", (): ToolConformance => {
  const context = {
    ...conformanceContext({ config: {}, secret: null }),
    organizationId: TELEMETRY_ORG,
  };
  const { store, metrics } = seededTelemetry();
  const tool = new TelemetryResearchTool(store, metrics, () => NOW);

  return {
    adapter: tool,
    config: {},
    secret: null,
    operations: {
      query: () => tool.query(context, { op: "metric_window", metric: OVERSHOOT, window: "7d" }),
      fetch: () =>
        tool.fetch(
          context,
          `telemetry://case/${OVERSHOOT_CASE}/overshoot_pct/2026-10-03T02:47:47Z..2026-10-10T02:47:47Z`,
        ),
    },
    failures: {
      network: () =>
        failing(Object.assign(new Error("connect"), { code: "ECONNREFUSED" })).query(context, {
          op: "metric_window",
          metric: OVERSHOOT,
          window: "7d",
        }),
      upstream: () =>
        failing(new Error("canceling statement")).query(context, {
          op: "case_history",
          case: OVERSHOOT_CASE,
          window: "7d",
        }),
      unsupported: () => tool.query(context, { op: "forecast", metric: OVERSHOOT }),
    },
    health: {
      healthy: () => tool.healthCheck({}, null, TELEMETRY_ORG),
      degraded: () => tool.healthCheck({}, null),
      down: () => failing(new Error("gone")).healthCheck({}, null, TELEMETRY_ORG),
    },
  };
});
