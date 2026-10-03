import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../../openapi/specification";
import type { AnalysisRunRow } from "../analysis.repository";
import { annotatedRun, HELIOS } from "../duration/duration.fixture";
import { confidenceBasis, MINIMUM_DAYS_WITH_BUILDS } from "./corpus.manifest";
import { corpusStateResource } from "./corpus.resources";

/**
 * `GET /api/v1/analyzer/corpus` answers what `openapi.yaml` documents (BW.6, #521) — a corpus
 * that was analysed, one that was not, and an empty one — held to the `AnalyzerCorpus` schema the
 * UI's client is generated from.
 */

/** A corpus window. */
const WINDOW = { from: "2026-05-10", to: "2026-08-07", days: 90 };

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

/**
 * A run that ended having judged a corpus.
 *
 * @param builds - Builds its window held.
 * @param daysWithBuilds - Days of it with a build.
 * @returns The row.
 */
function judgedRun(builds: number, daysWithBuilds: number): AnalysisRunRow {
  const run = annotatedRun();

  return {
    ...run,
    corpus_manifest: {
      ...(run.corpus_manifest as object),
      confidence: confidenceBasis({ window: WINDOW, builds, daysWithBuilds }),
    },
  };
}

describe("the corpus-state read, against its documented schema", () => {
  const validate = validator("AnalyzerCorpus");

  it("documents an analysed corpus as sent", () => {
    const body = corpusStateResource(
      HELIOS,
      WINDOW,
      { builds: 1284, daysWithBuilds: 89 },
      judgedRun(1284, 89),
    );

    expect(validate(body) ? null : validate.errors).toBeNull();
    expect(body.analyzed).not.toBeNull();
  });

  it("documents a corpus nothing has analysed, and an empty one", () => {
    for (const counts of [
      { builds: 3, daysWithBuilds: 3 },
      { builds: 0, daysWithBuilds: 0 },
    ]) {
      const body = corpusStateResource(HELIOS, WINDOW, counts, undefined);

      expect(validate(body) ? null : validate.errors).toBeNull();
      expect(body).toMatchObject({ sufficient: false, analyzed: null });
    }
  });

  it("documents the floor the service applies", () => {
    const body = corpusStateResource(HELIOS, WINDOW, { builds: 30, daysWithBuilds: 10 }, undefined);

    expect(body.minimumDaysWithBuilds).toBe(MINIMUM_DAYS_WITH_BUILDS);
    expect(body.sufficient).toBe(true);
  });

  it.each([
    ["no floor", { minimumDaysWithBuilds: undefined }],
    ["no verdict", { sufficient: undefined }],
    [
      "an analysed corpus with no run",
      {
        analyzed: {
          analyzedAt: "2026-08-08T10:41:00.000Z",
          builds: 1,
          daysWithBuilds: 1,
          sufficient: false,
        },
      },
    ],
    ["a field the schema does not name", { verdict: "thin" }],
  ])("refuses an answer with %s", (_label, change) => {
    const body = {
      ...corpusStateResource(HELIOS, WINDOW, { builds: 3, daysWithBuilds: 3 }, undefined),
      ...change,
    };

    expect(validate(JSON.parse(JSON.stringify(body)))).toBe(false);
  });
});
