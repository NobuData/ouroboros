import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { internalDocument } from "../../openapi/specification";
import { composeEstimate, replayStageRecord } from "./replay.estimate";
import type { ReplayEstimateRepository } from "./replay.repository";
import { ReplayEstimateService } from "./replay.service";

/**
 * The estimators on the wire (#561): what the service answers is what `openapi.internal.yaml`
 * says it answers — in particular that an estimate cannot be documented, or sent, without its
 * median, spread, sample count and window, and that insufficient history has nowhere to put a
 * number.
 */

/**
 * A validator for one of the internal document's schemas.
 *
 * @param name - The schema's name under `components.schemas`.
 * @returns A function answering `undefined` for a valid value, otherwise what is wrong with it.
 */
function validatorFor(name: string): (value: unknown) => string | undefined {
  const id = "https://ouroboros.invalid/openapi.internal.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: internalDocument().components });

  const validate = ajv.compile({ $ref: `${id}#/components/schemas/${name}` });

  return (value) => (validate(value) ? undefined : ajv.errorsText(validate.errors));
}

/**
 * A value as it crosses the wire.
 *
 * @param value - Anything serialisable.
 * @returns Its JSON round trip.
 */
function wire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const POLICY = { windowDays: 30, sampleFloor: 20 };
const CLASS =
  "pool-a · helios-firmware · container · ghcr.io/acme-robotics/zephyr-sdk · west build -b helios_mainboard app";
const CACHE = {
  measured: 212,
  warmCount: 186,
  warmMedianMs: 236_000,
  coldCount: 26,
  coldMedianMs: 410_000,
};
const BUILD = { sampleCount: 214, medianMs: 242_000, spreadMs: 20_000 };

/**
 * The service over one canned build sample.
 *
 * @param sample - The statistics the database would return.
 * @returns The service.
 */
function serviceOver(sample: {
  sampleCount: number;
  medianMs: number | null;
  spreadMs: number | null;
}) {
  return new ReplayEstimateService({
    context: () =>
      Promise.resolve({
        organizationId: "org",
        repository: { id: "repo", name: "helios-firmware" },
      }),
    buildSample: () =>
      Promise.resolve({
        command: "west build -b helios_mainboard app",
        similarityClass: CLASS,
        policy: POLICY,
        sample,
        cache:
          sample.sampleCount === 0 ? { ...CACHE, measured: 0, warmCount: 0, coldCount: 0 } : CACHE,
      }),
    testSample: () =>
      Promise.resolve({
        suites: ["hil", "unit"],
        similarityClass: "helios-firmware · tests · hil + unit",
        policy: POLICY,
        sample,
      }),
  } as unknown as ReplayEstimateRepository);
}

describe("the replay estimate on the wire", () => {
  const response = validatorFor("ReplayEstimateResponse");
  const estimate = validatorFor("ReplayEstimate");
  const request = validatorFor("ReplayEstimateRequest");
  const DRY_RUN = "5eed008b-0000-4000-8000-000000000001";

  it.each([
    ["a build estimate with cache context", "build", BUILD],
    ["a build at exactly the floor", "build", { ...BUILD, sampleCount: 20 }],
    ["a build below the floor", "build", { sampleCount: 7, medianMs: 250_000, spreadMs: 30_000 }],
    ["a build nobody has run", "build", { sampleCount: 0, medianMs: null, spreadMs: null }],
    ["a test estimate", "test", { sampleCount: 40, medianMs: 625_000, spreadMs: 15_000 }],
    ["a test with no history", "test", { sampleCount: 0, medianMs: null, spreadMs: null }],
  ] as const)("matches ReplayEstimateResponse for %s", async (_what, kind, sample) => {
    const answer = await serviceOver(sample).estimate(DRY_RUN, { kind, runnerPool: "pool-a" });

    expect(response(wire(answer))).toBeUndefined();
  });

  it.each(["estimateMs", "spreadMs", "sampleCount", "windowDays"])(
    "documents no estimate without %s — the probe, at the contract",
    (field) => {
      const partial = wire(composeEstimate("build", CLASS, BUILD, POLICY)) as unknown as Record<
        string,
        unknown
      >;
      delete partial[field];

      expect(estimate(partial)).toBeDefined();
    },
  );

  it.each(["estimateMs", "spreadMs", "cache"])(
    "documents no %s on insufficient history",
    (field) => {
      const insufficient = wire(
        composeEstimate("build", CLASS, { sampleCount: 7, medianMs: null, spreadMs: null }, POLICY),
      );

      expect(estimate(insufficient)).toBeUndefined();
      expect(estimate({ ...insufficient, [field]: 242_000 })).toBeDefined();
    },
  );

  it("documents the stage row in the two shapes the database accepts", () => {
    const record = validatorFor("ReplayStageRecord");
    const numeric = wire(replayStageRecord(composeEstimate("build", CLASS, BUILD, POLICY)));
    const honest = wire(
      replayStageRecord(
        composeEstimate("build", CLASS, { sampleCount: 7, medianMs: null, spreadMs: null }, POLICY),
      ),
    );

    expect(record(numeric)).toBeUndefined();
    expect(record(honest)).toBeUndefined();
    // Neither a number beside the marker, nor a row that says nothing.
    expect(record({ ...honest, metrics: { ...honest.metrics, estimate_ms: 1 } })).toBeDefined();
    expect(
      record({
        ...numeric,
        metrics: { sample_count: 214, similarity_class: CLASS, window_days: 30 },
      }),
    ).toBeDefined();
  });

  it("documents the bodies the harness sends, and refuses a workspace in one", () => {
    expect(request({ kind: "build", runnerPool: "pool-a" })).toBeUndefined();
    expect(
      request({ kind: "build", runnerPool: "pool-a", command: "west build -b board app" }),
    ).toBeUndefined();
    expect(request({ kind: "test" })).toBeUndefined();
    expect(request({ kind: "test", suites: ["unit", "hil"] })).toBeUndefined();
    expect(request({ kind: "deploy" })).toBeDefined();
    expect(request({ kind: "test", suites: [] })).toBeDefined();
    expect(request({ kind: "build", runnerPool: "pool-a", organizationId: "org" })).toBeDefined();
  });
});
