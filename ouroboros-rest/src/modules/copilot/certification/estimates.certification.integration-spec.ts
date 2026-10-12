/**
 * Copilot certification — the replay estimators' arithmetic (CD.6,
 * [#564](https://github.com/NobuData/ouroboros/issues/564)).
 *
 * A dry run builds nothing and runs no test: its build and test rows say `est. 1m 20s (21 similar
 * builds, ±18s)`, and the claim is only as good as the arithmetic behind it. This suite puts a
 * history whose answer is known by hand beside the seeded farm and asks the estimator the way
 * the harness does — `POST /internal/dry-runs/{id}/replay-estimates`, for a dry run the
 * workspace really ran:
 *
 *   * **The median, the spread and the count** are the ones this file computes from the same
 *     list — a list with an outlier, so a mean or a standard deviation would answer otherwise.
 *   * **What must not count does not**: failed, retried and cancelled builds, builds outside the window,
 *     another image, another command, another pool — each planted with a duration that would
 *     move the answer.
 *   * **The floor.** Nineteen similar builds answer `insufficient_history` with no duration
 *     anywhere; twenty answer a number.
 *   * **The similarity class is a function of the configuration**, not of its spelling: an image
 *     tag or digest and the whitespace of a command do not change the class or the answer.
 *   * **The formula is the registered one**, and its inputs are the ones the answer came from.
 *
 * The test estimator is held to the same list over test history, keyed by suite set.
 */

import request from "supertest";

import { SCHEMA_NAME } from "../../db/schema";
import type { ReplayEstimate, ReplayResult } from "../../replay-estimates/replay.estimate";
import { REPLAY_FORMULAS } from "../../replay-estimates/replay.formulas";
import type { ReplayEstimateResource } from "../../replay-estimates/replay.service";
import { IMPLEMENT_NODE, startCopilotStage, type CopilotStage } from "./certification.fixture";
import { chain, drafted, internalPost, ran } from "./dry-run-plane.fixture";
import { runOf, stage as row } from "./scripted-engine.fixture";

/** The window and the floor the issue names: thirty days, twenty samples. */
const WINDOW_DAYS = 30;
const SAMPLE_FLOOR = 20;

/**
 * Twenty-one durations, in seconds, with their answer known by inspection: the eleventh is 80,
 * and the distances from 80 — 0, 2, 4, … 20, 20, 30, … 90, 320 — have 18 as their eleventh.
 * The outlier makes the mean 111: a mean, or a standard deviation, would answer otherwise.
 */
const HISTORY = [
  60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 400,
] as const;

/** A duration no similar build has — what every build that must not count is given. */
const MUST_NOT_COUNT = 1;

/** The pool the fixture history is dispatched to; the seeded farm has no such pool. */
const POOL = "cert-replay-pool";

/** A second pool with the same configuration, whose builds are another class. */
const OTHER_POOL = "cert-replay-pool-b";

/** The image the pool runs, tagged. */
const IMAGE = "registry.cert.example/acme/replay-sdk";

/**
 * The median of a list, interpolated between the middle two when the count is even — as
 * `percentile_cont(0.5)` has it.
 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;

  return sorted.length % 2 === 1
    ? sorted[Math.floor(middle)]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The median absolute deviation of a list: the median distance from its median. */
function spread(values: readonly number[]): number {
  const centre = median(values);

  return median(values.map((value) => Math.abs(value - centre)));
}

/** Seconds as the card prints a duration under an hour. */
function label(seconds: number): string {
  return seconds < 60
    ? `${String(seconds)}s`
    : `${String(Math.floor(seconds / 60))}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Every number a JSON value holds, at any depth. */
function numbersOf(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (value === null || typeof value !== "object") return [];

  return Object.values(value).flatMap(numbersOf);
}

describe("copilot certification — the replay estimators' arithmetic (#564)", () => {
  let stage: CopilotStage;
  let dryRun: string;
  let repository: { id: string; name: string };
  const pools = new Map<string, { pool: string; runner: string }>();
  let numbered = 9_000_000;
  /** Every stray engine call of the suite; the engine forgets its own before each test. */
  const strays: string[] = [];

  /** Ask for an estimate the way the harness does. */
  function estimate(body: object): request.Test {
    return internalPost(stage, `/internal/dry-runs/${dryRun}/replay-estimates`, body);
  }

  /** A `200`'s body. */
  async function answered(body: object): Promise<ReplayEstimateResource> {
    return (await estimate(body).expect(200)).body as ReplayEstimateResource;
  }

  /**
   * Record finished build jobs of the dry run's repository.
   *
   * @param build - Their durations in seconds, their command, and what to vary: the image, the
   *   pool, how they ended, and how long ago the newest finished (each a minute before the last).
   */
  async function builds(build: {
    seconds: readonly number[];
    command: string;
    image?: string;
    pool?: string;
    status?: "succeeded" | "failed" | "retried" | "canceled";
    finished?: string;
  }): Promise<void> {
    const farm = pools.get(build.pool ?? POOL);
    if (farm === undefined) throw new Error("The fixture pool was not created.");
    const status = build.status ?? "succeeded";

    await stage.api.sql.query(
      `insert into ${SCHEMA_NAME}.build_jobs
         (organization_id, number, pool_id, runner_id, github_repo_id, git_ref, label, title,
          executor, image, command, status, queued_at, started_at, finished_at, exit_code)
       select $1, $2 + d.n, $3, $4, $5, 'refs/heads/main', 'cert build', 'Cert build ' || d.n,
              'container', $6, $7, $8,
              finished.at - make_interval(secs => d.seconds + 1),
              finished.at - make_interval(secs => d.seconds),
              finished.at,
              case $8 when 'succeeded' then 0 when 'failed' then 2 end
         from unnest($9::int[]) with ordinality as d (seconds, n)
         cross join lateral (
           select now() - $10::interval - make_interval(mins => d.n::int) as at) finished`,
      [
        stage.workspace.id,
        numbered,
        farm.pool,
        farm.runner,
        repository.id,
        build.image ?? `${IMAGE}:1.4`,
        build.command,
        status,
        [...build.seconds],
        build.finished ?? "1 hour",
      ],
    );
    numbered += build.seconds.length;
  }

  /** Builds of a command that must not count, one of each kind, each a second long. */
  async function decoys(command: string): Promise<void> {
    const five = Array.from({ length: 5 }, () => MUST_NOT_COUNT);

    await builds({ seconds: five, command, status: "failed" });
    await builds({ seconds: five, command, status: "retried" });
    await builds({ seconds: five, command, status: "canceled" });
    await builds({ seconds: five, command, finished: `${String(WINDOW_DAYS)} days 2 hours` });
    await builds({ seconds: five, command, image: "registry.cert.example/acme/other-sdk:1.4" });
    await builds({ seconds: five, command: `${command} --verbose` });
    await builds({ seconds: five, command, pool: OTHER_POOL });
  }

  beforeAll(async () => {
    stage = await startCopilotStage();

    // A dry run the workspace really ran: the estimator is asked about a dry run, not a ticket.
    const workflow = await drafted(stage, "Cert estimates", chain(IMPLEMENT_NODE));
    stage.engine.scriptRun((asked) => runOf(asked, [row(1, "implement")]));
    const run = await ran(stage, workflow.id);
    dryRun = run.id;

    const repo = await stage.one<{ id: string; name: string }>(
      `select repo.id, repo.name
         from ${SCHEMA_NAME}.tickets t
         join ${SCHEMA_NAME}.github_orgs gh
           on gh.organization_id = t.organization_id
          and lower(gh.login) = lower(t.meta #>> '{github,owner}')
         join ${SCHEMA_NAME}.github_repos repo
           on repo.org_id = gh.id and lower(repo.name) = lower(t.meta #>> '{github,repo}')
        where t.id = $1`,
      [run.ticket.id],
    );
    if (repo === undefined) throw new Error("The dry run's ticket names no mirrored repository.");
    repository = repo;

    for (const [index, name] of [POOL, OTHER_POOL].entries()) {
      const pool = await stage.one<{ id: string }>(
        `insert into ${SCHEMA_NAME}.runner_pools (organization_id, name, executor, image, default_command)
         values ($1, $2, 'container', $3, 'make healthy') returning id`,
        [stage.workspace.id, name, `${IMAGE}:1.4`],
      );
      const runner = await stage.one<{ id: string }>(
        `insert into ${SCHEMA_NAME}.runners (organization_id, pool_id, name, arch, security_mode, cert_serial)
         values ($1, $2, $3, 'linux/arm64', 'mtls', $4) returning id`,
        [stage.workspace.id, pool?.id, `cert-forge-${String(index)}`, `ce5640${String(index)}`],
      );
      if (pool === undefined || runner === undefined)
        throw new Error("The fixture farm was not created.");
      pools.set(name, { pool: pool.id, runner: runner.id });
    }
  });

  afterAll(async () => {
    await stage.close();
  });

  beforeEach(() => {
    stage.engine.reset();
  });

  afterEach(() => {
    strays.push(...stage.engine.strays);
  });

  describe("a build estimate", () => {
    const similarityClass = `${POOL} · helios-firmware · container · ${IMAGE} · make healthy`;

    it("knows its own fixture: the list's median and spread are 80 s and 18 s, and nothing else's", () => {
      const mean = HISTORY.reduce((sum, value) => sum + value, 0) / HISTORY.length;

      expect(HISTORY).toHaveLength(SAMPLE_FLOOR + 1);
      expect(median(HISTORY)).toBe(80);
      expect(spread(HISTORY)).toBe(18);
      // A mean, or a median over everything planted, would answer something else.
      expect(Math.round(mean)).toBe(111);
      expect(median([...HISTORY, ...Array.from({ length: 35 }, () => MUST_NOT_COUNT)])).toBe(1);
    });

    it("answers the median, the median absolute deviation and the count of the similar builds — and of no other", async () => {
      // One class, spelled four ways: two tags, a digest, and a command with stray whitespace.
      await builds({ seconds: HISTORY.slice(0, 6), command: "make healthy" });
      await builds({
        seconds: HISTORY.slice(6, 12),
        command: "make healthy",
        image: `${IMAGE}:2.0-rc1`,
      });
      await builds({
        seconds: HISTORY.slice(12, 17),
        command: "make healthy",
        image: `${IMAGE}@sha256:${"ab".repeat(32)}`,
      });
      await builds({ seconds: HISTORY.slice(17), command: "  make \t healthy  " });
      await decoys("make healthy");

      const { estimate: result, stage: recorded } = await answered({
        kind: "build",
        runnerPool: POOL,
      });
      const expected = { estimateMs: median(HISTORY) * 1000, spreadMs: spread(HISTORY) * 1000 };

      expect(expected).toEqual({ estimateMs: 80_000, spreadMs: 18_000 });
      expect(result).toMatchObject({
        status: "estimate",
        kind: "build",
        ...expected,
        sampleCount: HISTORY.length,
        windowDays: WINDOW_DAYS,
        similarityClass,
        note: `est. ${label(80)} (${String(HISTORY.length)} similar builds, ±${label(18)})`,
      });
      // The row a dry run stores is the same answer, not a second computation.
      expect(recorded).toEqual({
        how: "replayed",
        note: result.note,
        metrics: {
          estimate_ms: expected.estimateMs,
          spread_ms: expected.spreadMs,
          sample_count: HISTORY.length,
          similarity_class: similarityClass,
          window_days: WINDOW_DAYS,
        },
      });
    });

    it("carries the registered formula, with the inputs the answer came from", async () => {
      const { estimate: result } = await answered({ kind: "build", runnerPool: POOL });
      const registered = Object.values(REPLAY_FORMULAS).map((formula) => [
        formula.id,
        formula.version,
      ]);

      expect(registered).toContainEqual([result.formula.id, result.formula.version]);
      expect(result.formula).toEqual({
        ...REPLAY_FORMULAS.build,
        inputs: {
          similarityClass,
          windowDays: WINDOW_DAYS,
          sampleFloor: SAMPLE_FLOOR,
          sampleCount: HISTORY.length,
        },
      });
      expect(result.formula.dispersion).toBe("median_absolute_deviation");

      // Recomputed from the inputs alone: the class and the window select the list, the floor
      // decides whether a number may be said, and the formula's two statistics are the answer.
      const { inputs } = result.formula;
      const selected = HISTORY.slice(0, inputs.sampleCount);
      expect(inputs.sampleCount >= inputs.sampleFloor).toBe(result.status === "estimate");
      expect({
        estimateMs: median(selected) * 1000,
        spreadMs: spread(selected) * 1000,
        sampleCount: selected.length,
      }).toEqual({
        estimateMs: (result as ReplayEstimate).estimateMs,
        spreadMs: (result as ReplayEstimate).spreadMs,
        sampleCount: result.sampleCount,
      });
    });

    it("lands the same configuration in the same class however it is spelled, and answers it identically every time", async () => {
      const plain = await answered({ kind: "build", runnerPool: POOL });
      const again = await answered({ kind: "build", runnerPool: POOL });
      const named = await answered({ kind: "build", runnerPool: POOL, command: "make healthy" });
      const spaced = await answered({
        kind: "build",
        runnerPool: POOL,
        command: "  make \t  healthy ",
      });

      expect(again).toEqual(plain);
      expect(named).toEqual(plain);
      expect(spaced).toEqual(plain);

      // And a different configuration is a different class, with its own (empty) history.
      const other = await answered({
        kind: "build",
        runnerPool: POOL,
        command: "make healthy --release",
      });
      expect(other.estimate.similarityClass).toBe(`${similarityClass} --release`);
      expect(other.estimate).toMatchObject({ status: "insufficient_history", sampleCount: 0 });
      // The second pool holds only the five planted builds: another class again.
      const elsewhere = await answered({ kind: "build", runnerPool: OTHER_POOL });
      expect(elsewhere.estimate).toMatchObject({
        status: "insufficient_history",
        sampleCount: 5,
        similarityClass: similarityClass.replace(POOL, OTHER_POOL),
      });
    });

    it("answers insufficient history, with the count found and no duration anywhere, one build below the floor", async () => {
      const below = HISTORY.slice(0, SAMPLE_FLOOR - 1);
      await builds({ seconds: below, command: "make short" });
      await decoys("make short");

      const body = await answered({ kind: "build", runnerPool: POOL, command: "make short" });
      const result: ReplayResult = body.estimate;

      expect(below).toHaveLength(19);
      expect(result).toMatchObject({
        status: "insufficient_history",
        kind: "build",
        sampleCount: 19,
        sampleFloor: SAMPLE_FLOOR,
        windowDays: WINDOW_DAYS,
        note: "insufficient history — the first real build will measure this (19 similar builds found)",
      });
      for (const field of ["estimateMs", "spreadMs", "cache"])
        expect(result).not.toHaveProperty(field);
      expect(body.stage).toEqual({
        how: "replayed",
        note: result.note,
        metrics: {
          insufficient_history: true,
          sample_count: 19,
          similarity_class: result.similarityClass,
          window_days: WINDOW_DAYS,
        },
      });
      // No number in the whole answer but the count, the floor, the window and the formula's
      // version — and so no duration: not the nineteen builds' median, nor anything like it.
      expect([...new Set(numbersOf(body))].sort((a, b) => a - b)).toEqual(
        [REPLAY_FORMULAS.build.version, 19, SAMPLE_FLOOR, WINDOW_DAYS].sort((a, b) => a - b),
      );
      expect(JSON.stringify([result.note, body.stage])).not.toMatch(/est\.|±|\d+m \d\ds|\d+s\b/);
    });

    it("answers a number exactly at the floor, counting a build up to the window's edge and none past it", async () => {
      const atFloor = HISTORY.slice(0, SAMPLE_FLOOR);
      // Nineteen recent builds; the twentieth finished an hour inside the window's far edge.
      await builds({ seconds: atFloor.slice(0, 19), command: "make floor" });
      await builds({
        seconds: atFloor.slice(19),
        command: "make floor",
        finished: `${String(WINDOW_DAYS)} days -1 hours`,
      });
      await decoys("make floor");

      const { estimate: result } = await answered({
        kind: "build",
        runnerPool: POOL,
        command: "make floor",
      });

      // An even count: the median lies between the tenth and the eleventh.
      expect({ median: median(atFloor), spread: spread(atFloor) }).toEqual({
        median: 79,
        spread: 16,
      });
      expect(result).toMatchObject({
        status: "estimate",
        estimateMs: 79_000,
        spreadMs: 16_000,
        sampleCount: SAMPLE_FLOOR,
        note: `est. ${label(79)} (20 similar builds, ±${label(16)})`,
        formula: { inputs: { sampleFloor: SAMPLE_FLOOR, sampleCount: SAMPLE_FLOOR } },
      });
    });

    it("is closed to a caller without the internal key", async () => {
      await request(stage.api.baseUrl)
        .post(`/internal/dry-runs/${dryRun}/replay-estimates`)
        .send({ kind: "build", runnerPool: POOL })
        .expect(401);
    });
  });

  describe("a test estimate", () => {
    /**
     * Record complete test runs of the dry run's repository, each reporting a suite set.
     *
     * @param test - Their wall times in seconds, their suites, and what to vary.
     */
    async function testRuns(test: {
      seconds: readonly number[];
      suites: readonly string[];
      simulated?: boolean;
      started?: string;
    }): Promise<void> {
      numbered += 1;
      const run = await stage.one<{ id: string }>(
        `insert into ${SCHEMA_NAME}.runs
           (organization_id, github_repo_id, issue_number, issue_title, workflow_tag, model, status,
            stage_label, stage_index, stage_total, started_at, simulated)
         values ($1, $2, $3, 'Cert replay history', 'standard-fix', 'claude-fable-5', 'building',
                 'Test', 6, 8, now() - interval '40 days', $4)
         returning id`,
        [stage.workspace.id, repository.id, numbered, test.simulated ?? false],
      );
      if (run === undefined) throw new Error("The fixture run was not created.");

      await stage.api.sql.query(
        `insert into ${SCHEMA_NAME}.test_runs
           (organization_id, run_id, attempt_seq, status, wall_ms, sim_ms, physical_ms, started_at)
         select $1, $2, d.n, 'complete', d.seconds * 1000, d.seconds * 1000, 0,
                now() - $4::interval - make_interval(mins => d.n::int)
           from unnest($3::int[]) with ordinality as d (seconds, n)`,
        [stage.workspace.id, run.id, [...test.seconds], test.started ?? "1 hour"],
      );
      await stage.api.sql.query(
        `insert into ${SCHEMA_NAME}.test_suites (organization_id, test_run_id, name, platform, kind)
         select t.organization_id, t.id, s.name, 'native_sim', 'sim'
           from ${SCHEMA_NAME}.test_runs t cross join unnest($2::text[]) as s (name)
          where t.run_id = $1`,
        [run.id, [...test.suites]],
      );
    }

    it("has too little history on the seeded stack to say a number, and says so", async () => {
      const { estimate: result } = await answered({ kind: "test" });

      expect(result.status).toBe("insufficient_history");
      expect(result.sampleCount).toBeLessThan(SAMPLE_FLOOR);
      expect(result).not.toHaveProperty("estimateMs");
      expect(result).not.toHaveProperty("spreadMs");
      expect(result.formula).toMatchObject({ ...REPLAY_FORMULAS.test });
    });

    it("answers the same arithmetic over test history, keyed by suite set and never by build history", async () => {
      const five = Array.from({ length: 5 }, () => MUST_NOT_COUNT);
      await testRuns({ seconds: HISTORY, suites: ["cert-unit", "cert-hil"] });
      // What must not count: a wider suite set, a simulated run's tests, tests outside the window.
      await testRuns({ seconds: five, suites: ["cert-unit", "cert-hil", "cert-soak"] });
      await testRuns({ seconds: five, suites: ["cert-unit", "cert-hil"], simulated: true });
      await testRuns({
        seconds: five,
        suites: ["cert-unit", "cert-hil"],
        started: `${String(WINDOW_DAYS)} days 2 hours`,
      });
      // One suite set short of the floor.
      await testRuns({ seconds: HISTORY.slice(0, SAMPLE_FLOOR - 1), suites: ["cert-smoke"] });

      const similarityClass = "helios-firmware · tests · cert-hil + cert-unit";
      const full = await answered({ kind: "test", suites: ["cert-unit", "cert-hil"] });
      const reordered = await answered({
        kind: "test",
        suites: ["cert-hil", "cert-unit", "cert-hil"],
      });

      expect(full.estimate).toMatchObject({
        status: "estimate",
        kind: "test",
        estimateMs: median(HISTORY) * 1000,
        spreadMs: spread(HISTORY) * 1000,
        sampleCount: HISTORY.length,
        windowDays: WINDOW_DAYS,
        similarityClass,
        cache: null,
        note: `est. ${label(80)} (21 similar test runs, ±${label(18)})`,
      });
      expect(full.estimate.formula).toEqual({
        ...REPLAY_FORMULAS.test,
        inputs: {
          similarityClass,
          windowDays: WINDOW_DAYS,
          sampleFloor: SAMPLE_FLOOR,
          sampleCount: HISTORY.length,
        },
      });
      // The suite set is a set: order and repetition are spelling.
      expect(reordered).toEqual(full);

      const smoke = await answered({ kind: "test", suites: ["cert-smoke"] });
      expect(smoke.estimate).toMatchObject({
        status: "insufficient_history",
        sampleCount: SAMPLE_FLOOR - 1,
        sampleFloor: SAMPLE_FLOOR,
        similarityClass: "helios-firmware · tests · cert-smoke",
      });
      expect(smoke.estimate).not.toHaveProperty("estimateMs");
      expect(JSON.stringify([smoke.estimate.note, smoke.stage])).not.toMatch(
        /est\.|±|\d+m \d\ds|\d+s\b/,
      );
    });
  });

  it("called no engine route but the dry run's own", () => {
    expect(strays).toEqual([]);
  });
});
