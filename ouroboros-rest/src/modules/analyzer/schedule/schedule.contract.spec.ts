import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../../openapi/specification";
import { analysisRunResource } from "../analysis.resources";
import type { AnalysisRunRow } from "../analysis.repository";
import { ANALYZER_SET } from "../analysis.fixture";
import { confidenceBasis } from "../corpus/corpus.manifest";
import { scheduleResource, unsavedSchedule } from "./schedule.resources";

/**
 * The schedule routes and the run's confidence basis answer what `openapi.yaml` documents (BW.1,
 * #516) — held to the `AnalysisSchedule` and `AnalysisRun` schemas the UI's client is generated
 * from.
 */

/**
 * A validator for one documented schema.
 *
 * @param name - The schema's name under `components/schemas`.
 * @returns The compiled validator.
 */
function validator(name: string) {
  const id = "https://ouroboros.build/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });
  return ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
}

const REPO = "acme-robotics/helios-firmware";

describe("the schedule contract", () => {
  const valid = validator("AnalysisSchedule");

  it("documents an unsaved schedule's defaults", () => {
    expect(valid(unsavedSchedule(REPO))).toBe(true);
  });

  it("documents a saved schedule as the database reads it", () => {
    const resource = scheduleResource({
      id: "5eed0064-0000-4000-8000-000000000001",
      organization_id: "5eed0001-0000-4000-8000-000000000001",
      repo_ref: REPO,
      enabled: true,
      weekly_enabled: true,
      weekly_day: 1,
      weekly_time: "06:00:00",
      every_n_builds: 50,
      build_counter: 12,
      max_builds: 2000,
      max_log_lines: "1230000",
      compute_ceiling_seconds: 3600,
      updated_by: null,
      created_at: new Date("2026-08-01T00:00:00Z"),
      updated_at: new Date("2026-08-01T00:00:00Z"),
    });

    expect(valid(resource)).toBe(true);
    expect(resource).toMatchObject({ weeklyTime: "06:00", maxLogLines: 1_230_000 });
  });
});

describe("the run's confidence basis contract", () => {
  const valid = validator("AnalysisRun");
  const window = { from: "2026-05-10", to: "2026-08-07", days: 90 };

  /** A finished run whose manifest carries (or lacks) a basis. */
  function run(withBasis: boolean): AnalysisRunRow {
    return {
      id: "5eed0065-0000-4000-8000-000000000002",
      organization_id: "5eed0001-0000-4000-8000-000000000001",
      repo_ref: REPO,
      trigger: "every_n_builds",
      schedule_id: null,
      status: "complete",
      corpus_manifest: {
        window,
        counts: { builds: 1284, loops: 312, log_lines: 4100000, hil_sessions: 62 },
        sources: {
          builds: { sampled: false, rate: 1, cap: null },
          loops: { sampled: false, rate: 1, cap: null },
          log_lines: { sampled: true, rate: 0.3, cap: "max_log_lines" },
          hil_sessions: { sampled: false, rate: 1, cap: null },
        },
        budget: { max_builds: 2000, max_log_lines: 1230000, compute_ceiling_seconds: 3600 },
        ...(withBasis
          ? { confidence: confidenceBasis({ window, builds: 1284, daysWithBuilds: 89 }) }
          : {}),
      },
      analyzer_set: ANALYZER_SET,
      started_at: new Date("2026-08-08T13:00:00Z"),
      finished_at: new Date("2026-08-08T13:41:00Z"),
      compute_seconds: 2460,
      llm_cost_cents: null,
      confidence_note: "high — 90d of stable telemetry",
      failure_reason: null,
      created_at: new Date("2026-08-08T13:00:00Z"),
      phase: "composing",
      progress: { analyzers: [] },
    };
  }

  it("documents a run that stored its basis", () => {
    const resource = analysisRunResource(run(true));

    expect(valid(resource)).toBe(true);
    expect(resource.manifest?.confidence).toMatchObject({
      level: "high",
      daysWithBuilds: 89,
      coverage: 0.9889,
    });
  });

  it("documents a run from before the basis was stored, with null", () => {
    const resource = analysisRunResource(run(false));

    expect(valid(resource)).toBe(true);
    expect(resource.manifest?.confidence).toBeNull();
  });
});
