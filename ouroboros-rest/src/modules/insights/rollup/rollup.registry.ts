/**
 * Extractors are versioned with their registry entries (BI.2,
 * [#433](https://github.com/NobuData/ouroboros/issues/433)) — the check.
 *
 * Every extractor declares, per metric, the `metric_definitions.version` its code implements. Before
 * a family fills, the declaration is compared with the registry the database actually holds:
 *
 *   * a metric missing from the registry, or registered under another family, is a deployment whose
 *     code and migrations disagree about what exists;
 *   * a version mismatch is a formula changed on one side only — a migration bumped a definition
 *     the extractor does not yet implement, or an extractor changed a computation without the
 *     migration that says so.
 *
 * Either way the family refuses to fill, and says why in `metric_rollup_state.last_error`. Writing
 * numbers the methodology popover no longer describes is the failure this whole plane exists to
 * prevent, and a stale chart is the honest alternative.
 */

import type { MetricAggregation } from "../../db/schema";
import type { FamilyExtractor } from "./rollup.types";

/** What the fill needs to know about one registry entry. */
export interface RegisteredMetric {
  readonly metricId: string;
  readonly family: string;
  readonly version: number;
  readonly isRate: boolean;
  readonly aggregation: MetricAggregation;
}

/**
 * Why an extractor may not fill against this registry.
 *
 * @param extractor - The family's extractor.
 * @param registry - The registry, by metric id.
 * @returns One sentence per disagreement; empty when the extractor and registry agree.
 */
export function registryMismatches(
  extractor: FamilyExtractor,
  registry: ReadonlyMap<string, RegisteredMetric>,
): string[] {
  return Object.entries(extractor.metrics).flatMap(([metricId, version]) => {
    const registered = registry.get(metricId);

    if (registered === undefined) {
      return [`${metricId} is not in the metric registry`];
    }

    if (registered.family !== extractor.family) {
      return [`${metricId} is registered to family ${registered.family}, not ${extractor.family}`];
    }

    if (registered.version !== version) {
      return [
        `${metricId} is at registry version ${String(registered.version)} but the ` +
          `${extractor.family} extractor implements version ${String(version)}`,
      ];
    }

    return [];
  });
}
