import { HttpStatus } from "@nestjs/common";

import type { DomainError } from "../errors/error.envelope";
import { REPLAY_ERRORS } from "./replay.errors";
import type {
  BuildSampleRow,
  ReplayContext,
  ReplayEstimateRepository,
  TestSampleRow,
} from "./replay.repository";
import { ReplayEstimateService } from "./replay.service";

/**
 * The estimators over a stubbed repository (#561): what is asked of history for each kind, what
 * an answer carries, and what is refused. The statements are `replay.repository.spec.ts`'s and
 * the arithmetic `ouroboros-db/tests/constraints.sql`'s.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const DRY_RUN = "5eed008b-0000-4000-8000-000000000001";
const REPOSITORY = { id: "5eed0006-0000-4000-8000-000000000001", name: "helios-firmware" };
const CLASS =
  "pool-a · helios-firmware · container · ghcr.io/acme-robotics/zephyr-sdk · west build -b helios_mainboard app";
const POLICY = { windowDays: 30, sampleFloor: 20 };

/** The mockup's build: 214 similar builds, median 4m 02s, ±20s. */
const BUILD: BuildSampleRow = {
  command: "west build -b helios_mainboard app",
  similarityClass: CLASS,
  policy: POLICY,
  sample: { sampleCount: 214, medianMs: 242_000, spreadMs: 20_000 },
  cache: {
    measured: 200,
    warmCount: 180,
    warmMedianMs: 230_000,
    coldCount: 20,
    coldMedianMs: 400_000,
  },
};

/** A full test sweep with enough history. */
const TESTS: TestSampleRow = {
  suites: ["hil", "unit"],
  similarityClass: "helios-firmware · tests · hil + unit",
  policy: POLICY,
  sample: { sampleCount: 40, medianMs: 625_000, spreadMs: 15_000 },
};

/**
 * A service over canned answers.
 *
 * @param answers - What each statement returns; defaults to a resolvable dry run, the mockup's
 *   build and a full test history.
 * @returns The service and the stubs.
 */
function harness(
  answers: {
    context?: ReplayContext | undefined;
    build?: BuildSampleRow | undefined;
    test?: TestSampleRow;
  } = {},
) {
  const context = jest.fn(() =>
    Promise.resolve(
      "context" in answers
        ? answers.context
        : { organizationId: WORKSPACE, repository: REPOSITORY },
    ),
  );
  const buildSample = jest.fn(() => Promise.resolve("build" in answers ? answers.build : BUILD));
  const testSample = jest.fn(() => Promise.resolve(answers.test ?? TESTS));
  const service = new ReplayEstimateService({
    context,
    buildSample,
    testSample,
  } as unknown as ReplayEstimateRepository);

  return { service, context, buildSample, testSample };
}

/**
 * The refusal a call ends in.
 *
 * @param call - The call.
 * @returns The domain error it rejected with.
 */
async function refusal(call: Promise<unknown>): Promise<DomainError> {
  try {
    await call;
  } catch (error) {
    return error as DomainError;
  }

  throw new Error("the call was not refused");
}

describe("estimating a build stage", () => {
  it("reproduces the mockup's row from the mockup's sample: 4m 02s, n = 214, ±20s", async () => {
    const { service } = harness();

    const { estimate, stage } = await service.estimate(DRY_RUN, {
      kind: "build",
      runnerPool: "pool-a",
    });

    expect(estimate).toMatchObject({
      status: "estimate",
      kind: "build",
      estimateMs: 242_000,
      spreadMs: 20_000,
      sampleCount: 214,
      windowDays: 30,
      similarityClass: CLASS,
      note: "est. 4m 02s (214 similar builds, ±20s)",
    });
    expect(stage).toEqual({
      how: "replayed",
      note: "est. 4m 02s (214 similar builds, ±20s)",
      metrics: {
        estimate_ms: 242_000,
        spread_ms: 20_000,
        sample_count: 214,
        similarity_class: CLASS,
        window_days: 30,
      },
    });
  });

  it("samples the dry run's own workspace and repository — neither is the caller's to name", async () => {
    const { service, context, buildSample } = harness();

    await service.estimate(DRY_RUN, {
      kind: "build",
      runnerPool: "pool-a",
      command: "west build -b board app",
    });

    expect(context).toHaveBeenCalledTimes(1);

    expect(context).toHaveBeenCalledWith(DRY_RUN);
    expect(buildSample).toHaveBeenCalledTimes(1);
    expect(buildSample).toHaveBeenCalledWith(
      WORKSPACE,
      REPOSITORY,
      "pool-a",
      "west build -b board app",
    );
  });

  it("asks for the pool's default command when the stage names none", async () => {
    const { service, buildSample } = harness();

    await service.estimate(DRY_RUN, { kind: "build", runnerPool: "pool-a" });

    expect(buildSample).toHaveBeenCalledWith(WORKSPACE, REPOSITORY, "pool-a", null);
  });

  it("presents cache context beside the estimate, and off the stage row", async () => {
    const { service } = harness();

    const { estimate, stage } = await service.estimate(DRY_RUN, {
      kind: "build",
      runnerPool: "pool-a",
    });

    expect(estimate).toMatchObject({
      // The median is the sample's, not either half's.
      estimateMs: 242_000,
      cache: {
        measured: 200,
        warm: { count: 180, medianMs: 230_000 },
        cold: { count: 20, medianMs: 400_000 },
        note: "warm cache ≈ 3m 50s (180 builds) · cold cache ≈ 6m 40s (20 builds)",
      },
    });
    expect(stage.metrics).not.toHaveProperty("cache");
    expect(stage.note).not.toMatch(/cache/);
  });

  it("carries the registered formula with the real inputs", async () => {
    const { service } = harness();

    const { estimate } = await service.estimate(DRY_RUN, { kind: "build", runnerPool: "pool-a" });

    expect(estimate.formula).toMatchObject({
      id: "build_duration_replay",
      inputs: { similarityClass: CLASS, windowDays: 30, sampleFloor: 20, sampleCount: 214 },
    });
  });

  it("answers insufficient history, with the count found and no number, below the floor", async () => {
    const { service } = harness({
      build: { ...BUILD, sample: { sampleCount: 7, medianMs: 250_000, spreadMs: 30_000 } },
    });

    const { estimate, stage } = await service.estimate(DRY_RUN, {
      kind: "build",
      runnerPool: "pool-a",
    });

    expect(estimate).toMatchObject({
      status: "insufficient_history",
      sampleCount: 7,
      sampleFloor: 20,
    });
    expect(estimate).not.toHaveProperty("estimateMs");
    expect(estimate).not.toHaveProperty("spreadMs");
    expect(stage).toEqual({
      how: "replayed",
      note: "insufficient history — the first real build will measure this (7 similar builds found)",
      metrics: {
        insufficient_history: true,
        sample_count: 7,
        similarity_class: CLASS,
        window_days: 30,
      },
    });
  });

  it("answers insufficient history for a class nobody has built", async () => {
    const { service } = harness({
      build: {
        ...BUILD,
        sample: { sampleCount: 0, medianMs: null, spreadMs: null },
        cache: { measured: 0, warmCount: 0, warmMedianMs: null, coldCount: 0, coldMedianMs: null },
      },
    });

    const { estimate } = await service.estimate(DRY_RUN, { kind: "build", runnerPool: "pool-a" });

    expect(estimate).toMatchObject({ status: "insufficient_history", sampleCount: 0 });
  });

  it("never reads test history for a build", async () => {
    const { service, testSample } = harness();

    await service.estimate(DRY_RUN, { kind: "build", runnerPool: "pool-a" });

    expect(testSample).not.toHaveBeenCalled();
  });
});

describe("estimating a test stage", () => {
  it("derives from test history, and never from build history", async () => {
    const { service, testSample, buildSample } = harness();

    const { estimate, stage } = await service.estimate(DRY_RUN, {
      kind: "test",
      suites: ["unit", "hil"],
    });

    expect(testSample).toHaveBeenCalledTimes(1);

    expect(testSample).toHaveBeenCalledWith(WORKSPACE, REPOSITORY, ["unit", "hil"]);
    expect(buildSample).not.toHaveBeenCalled();
    expect(estimate).toMatchObject({
      status: "estimate",
      kind: "test",
      estimateMs: 625_000,
      spreadMs: 15_000,
      sampleCount: 40,
      windowDays: 30,
      similarityClass: "helios-firmware · tests · hil + unit",
      note: "est. 10m 25s (40 similar test runs, ±15s)",
      cache: null,
    });
    expect(estimate.formula.id).toBe("test_duration_replay");
    expect(stage.metrics).toMatchObject({ estimate_ms: 625_000, sample_count: 40 });
  });

  it("asks for the repository's last measured suite set when the stage names none", async () => {
    const { service, testSample } = harness();

    await service.estimate(DRY_RUN, { kind: "test" });

    expect(testSample).toHaveBeenCalledWith(WORKSPACE, REPOSITORY, null);
  });

  it("ignores a pool and a command on a test stage — a suite set is its whole key", async () => {
    const { service, testSample, buildSample } = harness();

    await service.estimate(DRY_RUN, {
      kind: "test",
      runnerPool: "pool-a",
      command: "west twister --all",
    });

    expect(testSample).toHaveBeenCalledWith(WORKSPACE, REPOSITORY, null);
    expect(buildSample).not.toHaveBeenCalled();
  });

  it("answers insufficient history — the seeded stack's answer — for a repository with no measured test run", async () => {
    const { service } = harness({
      test: {
        suites: null,
        similarityClass: null,
        policy: POLICY,
        sample: { sampleCount: 0, medianMs: null, spreadMs: null },
      },
    });

    const { estimate, stage } = await service.estimate(DRY_RUN, { kind: "test" });

    expect(estimate).toMatchObject({
      status: "insufficient_history",
      sampleCount: 0,
      similarityClass: "helios-firmware · tests · no measured test run",
      note: "insufficient history — the first real test run will measure this (0 similar test runs found)",
    });
    expect(stage.metrics).toEqual({
      insufficient_history: true,
      sample_count: 0,
      similarity_class: "helios-firmware · tests · no measured test run",
      window_days: 30,
    });
  });
});

describe("what is refused", () => {
  it("answers 404 for a dry run that does not exist, and samples nothing", async () => {
    const { service, buildSample, testSample } = harness({ context: undefined });

    const error = await refusal(service.estimate(DRY_RUN, { kind: "build", runnerPool: "pool-a" }));

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.code).toBe(REPLAY_ERRORS.dryRunNotFound);
    expect(buildSample).not.toHaveBeenCalled();
    expect(testSample).not.toHaveBeenCalled();
  });

  it("answers 422 when the dry run's ticket names no repository of the workspace", async () => {
    const { service, buildSample } = harness({
      context: { organizationId: WORKSPACE, repository: null },
    });

    const error = await refusal(service.estimate(DRY_RUN, { kind: "build", runnerPool: "pool-a" }));

    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(error.code).toBe(REPLAY_ERRORS.repositoryUnresolved);
    expect(buildSample).not.toHaveBeenCalled();
  });

  it("answers 422 for a build with no pool — builds are comparable within one", async () => {
    const { service, buildSample } = harness();

    const error = await refusal(service.estimate(DRY_RUN, { kind: "build" }));

    expect(error.code).toBe(REPLAY_ERRORS.poolRequired);
    expect(buildSample).not.toHaveBeenCalled();
  });

  it("answers 422 for a pool the workspace does not have", async () => {
    const { service } = harness({ build: undefined });

    const error = await refusal(service.estimate(DRY_RUN, { kind: "build", runnerPool: "pool-z" }));

    expect(error.code).toBe(REPLAY_ERRORS.poolNotFound);
    expect(error.details).toEqual({ runnerPool: "pool-z" });
  });

  it("answers 422 when neither the stage nor its pool names a command — not a class of everything", async () => {
    const { service } = harness({
      build: {
        ...BUILD,
        command: null,
        similarityClass: null,
        sample: { sampleCount: 0, medianMs: null, spreadMs: null },
      },
    });

    const error = await refusal(service.estimate(DRY_RUN, { kind: "build", runnerPool: "pool-b" }));

    expect(error.code).toBe(REPLAY_ERRORS.commandRequired);
  });

  it("lets no incomplete estimate out: a sample the database half-answered fails the probe", async () => {
    // A fractional median is not something V121 returns; if it ever did, this is where it stops.
    const { service } = harness({
      build: { ...BUILD, sample: { sampleCount: 214, medianMs: 242_000.5, spreadMs: 20_000 } },
    });

    await expect(
      service.estimate(DRY_RUN, { kind: "build", runnerPool: "pool-a" }),
    ).rejects.toThrow(/must carry its whole basis.*estimateMs/);
  });
});
