import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ROLLUP_EXTRACTORS } from "./rollup.extractors";
import { registryMismatches, type RegisteredMetric } from "./rollup.registry";
import type { FamilyExtractor } from "./rollup.types";

/**
 * Extractors are versioned with their registry entries (BI.2, #433): the check refuses a missing
 * metric, a family mismatch and a version mismatch; and every shipped extractor's declaration
 * matches the registry rows the migrations ship.
 */

const EXTRACTOR: FamilyExtractor = {
  family: "throughput",
  metrics: { merged_prs: 1, merge_rate: 2 },
  extract: () => Promise.resolve([]),
};

/**
 * A registry entry.
 *
 * @param metricId - The id.
 * @param family - The family.
 * @param version - The version.
 * @returns The entry.
 */
function entry(metricId: string, family: string, version: number): [string, RegisteredMetric] {
  return [metricId, { metricId, family, version, isRate: false, aggregation: "sum" }];
}

describe("the registry check", () => {
  it("passes an extractor whose every metric matches family and version", () => {
    const registry = new Map([
      entry("merged_prs", "throughput", 1),
      entry("merge_rate", "throughput", 2),
    ]);

    expect(registryMismatches(EXTRACTOR, registry)).toEqual([]);
  });

  it("names a metric the registry does not have", () => {
    expect(registryMismatches(EXTRACTOR, new Map([entry("merged_prs", "throughput", 1)]))).toEqual([
      "merge_rate is not in the metric registry",
    ]);
  });

  it("names a metric registered to another family", () => {
    const registry = new Map([
      entry("merged_prs", "dora", 1),
      entry("merge_rate", "throughput", 2),
    ]);

    expect(registryMismatches(EXTRACTOR, registry)).toEqual([
      "merged_prs is registered to family dora, not throughput",
    ]);
  });

  it("names a formula that moved on one side only", () => {
    const registry = new Map([
      entry("merged_prs", "throughput", 2),
      entry("merge_rate", "throughput", 2),
    ]);

    expect(registryMismatches(EXTRACTOR, registry)).toEqual([
      "merged_prs is at registry version 2 but the throughput extractor implements version 1",
    ]);
  });
});

describe("the shipped extractors", () => {
  /**
   * Every registry row the migrations insert, as `metric_id → family` — read from the SQL itself,
   * so this spec fails when a migration and an extractor disagree without needing a database.
   */
  const shipped = new Map<string, string>();
  const migrations = join(__dirname, "../../../../../ouroboros-db/migrations");

  for (const file of readdirSync(migrations).filter((name) => /^V\d+__.*\.sql$/.test(name))) {
    const text = readFileSync(join(migrations, file), "utf8");

    for (const match of text.matchAll(/^\s+\('([a-z][a-z0-9_]*)', '([a-z][a-z0-9_]*)',/gm)) {
      if (text.includes("insert into ouroboros.metric_definitions")) {
        shipped.set(match[1], match[2]);
      }
    }
  }

  it("fill distinct families, each metric once", () => {
    const families = ROLLUP_EXTRACTORS.map((extractor) => extractor.family);
    const metrics = ROLLUP_EXTRACTORS.flatMap((extractor) => Object.keys(extractor.metrics));

    expect(new Set(families).size).toBe(families.length);
    expect(new Set(metrics).size).toBe(metrics.length);
  });

  it("declare only metrics the migrations register, under the family they register", () => {
    for (const extractor of ROLLUP_EXTRACTORS) {
      for (const metricId of Object.keys(extractor.metrics)) {
        expect({ metricId, family: shipped.get(metricId) }).toEqual({
          metricId,
          family: extractor.family,
        });
      }
    }
  });

  it("declare the versions the migrations ship — 1, but human_interventions' cause bump to 2", () => {
    // V079 (#434) gave human_interventions the cause dimension, a formula change with its bump.
    const bumped: Record<string, number> = { human_interventions: 2 };

    for (const extractor of ROLLUP_EXTRACTORS) {
      for (const [metricId, version] of Object.entries(extractor.metrics)) {
        expect({ metricId, version }).toEqual({ metricId, version: bumped[metricId] ?? 1 });
      }
    }
  });

  it("cover every rolled-up registry family except calibration, whose report reads its own table", () => {
    const families = new Set(shipped.values());

    families.delete("calibration");
    expect([...families].sort()).toEqual(
      ROLLUP_EXTRACTORS.map((extractor) => extractor.family).sort(),
    );
  });
});
