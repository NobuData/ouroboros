import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { DomainError } from "../errors/error.envelope";
import { LocalArtifactStore } from "../farm/artifacts/local.store";
import { RUNS_ERRORS } from "../runs/runs.errors";
import { TRIAGE_ERRORS } from "../triage/triage.errors";
import { RESULTS_ERRORS } from "./results.errors";
import {
  attemptId,
  FakeResultsRepository,
  mockupUniverse,
  ORG,
  OTHER_ORG,
  RUN,
} from "./results.fixture";
import type { ResultsRepository } from "./results.repository";
import { ResultsService, storedKey } from "./results.service";

/**
 * The Test Results reads (AT.5, #333), over mockup 11's `#482` as `results.fixture.ts` holds it.
 * The first two blocks are the acceptance criterion *seeded payloads reproduce every number on the
 * mockup*: each expectation is a figure the page prints, found in the payload rather than computed
 * by the reader.
 */

let root: string;
/** A fresh directory per case, so no case sees another's bytes. */
let stores = 0;
let store: LocalArtifactStore;
let repository: FakeResultsRepository;
let service: ResultsService;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ouro-results-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  store = new LocalArtifactStore(join(root, String((stores += 1))));
  repository = new FakeResultsRepository(mockupUniverse());
  service = new ResultsService(repository as unknown as ResultsRepository, store);
});

/** The domain error a promise rejects with. */
async function refusal(promise: Promise<unknown>): Promise<DomainError> {
  const error: unknown = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof DomainError))
    throw new Error(`expected a DomainError, got ${String(error)}`);
  return error;
}

/** Read a stream whole. */
async function drain(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe("GET /runs/:id/test-runs — the mockup's strip and timeline", () => {
  it("prints Build 3's five stat cards", async () => {
    const timeline = await service.timeline(ORG, RUN);
    const build3 = timeline.attempts.find((attempt) => attempt.attemptSeq === 3);

    expect(build3?.strip).toMatchObject({
      total: 63, // Total tests 63
      suiteCount: 5, // across 5 suites
      passed: 61, // Passed 61
      passedDelta: { value: 12, versusAttemptSeq: 1, versusTestRunId: attemptId(1) }, // ▲ 12
      failed: 1, // Failed 1
      failedCases: [{ name: "overshoot_under_load", physical: true }], // motor overshoot · HIL
      flaky: 1, // Flaky 1
      flakyCases: [{ passedOnRetry: 2, attempts: 3, flakeState: "watching" }], // retry 2/3 · watching
      wallTime: { wallMs: 372_000, simMs: 240_000, physicalMs: 132_000 }, // 6m 12s · 4m · 2m 12s
    });
  });

  it("draws Build 1 · 2 · 3 with their counts and shas", async () => {
    const { attempts } = await service.timeline(ORG, RUN);

    expect(
      attempts.map((attempt) => [
        attempt.attemptSeq,
        attempt.commitSha,
        attempt.strip.passed,
        attempt.strip.total,
        attempt.strip.failed,
      ]),
    ).toEqual([
      [1, "a3f19c2", 49, 63, 14], // 49/63 · 14 failed ✗
      [2, "c81d4e7", 61, 63, 2], // 61/63 · 2 failed
      [3, "f42b9a0", 61, 63, 1], // running re-run of failed set
      [4, "b7e41d0", 63, 63, 0], // #356's Build 4
    ]);
    expect(attempts[2].status).toBe("running");
    expect(attempts[2].rigs).toEqual(["helios-rig-02"]);
  });

  it("heads the card with the run's branch, loop and start", async () => {
    const { run } = await service.timeline(ORG, RUN);

    expect(run).toMatchObject({
      issueNumber: 482,
      loopSeq: 1847,
      branch: "loop/482-canbus-flake",
      workflowTag: "standard-fix",
      workflowVersionPin: 14,
      startedAt: "2026-09-20T13:48:00.000Z",
    });
  });

  it("projects the dashed Next card from the stored intents, gate armed", async () => {
    const { next, latestTestRunId } = await service.timeline(ORG, RUN);

    expect(latestTestRunId).toBe(attemptId(4));
    expect(next).toEqual({
      action: "publish_to_pr",
      pullRequest: {
        number: 514,
        url: "https://github.com/acme-robotics/helios-firmware/pull/514",
      },
      gatedOn: { passed: 63, total: 63 }, // gated on 63/63
      activation: "gate_armed",
      intents: { blockUntilGreen: true, autoRerunPhysical: true },
      gate: { required: true, source: "standard-fix@v14 pin" },
    });
  });

  it("says intent_stored — not armed — while no PR carries the gate", async () => {
    repository.universe.pullRequests = [];

    const { next } = await service.timeline(ORG, RUN);

    expect(next).toMatchObject({ pullRequest: null, activation: "intent_stored", gate: null });
  });

  it("says none when nobody asked to block and no gate holds", async () => {
    repository.universe.pullRequests = [];
    repository.universe.intents = [];

    const { next } = await service.timeline(ORG, RUN);

    expect(next).toMatchObject({
      activation: "none",
      intents: { blockUntilGreen: false, autoRerunPhysical: false },
    });
  });

  it("answers a run with no attempts yet with an empty timeline", async () => {
    repository.universe.attempts = [];

    const timeline = await service.timeline(ORG, RUN);

    expect(timeline).toMatchObject({ attempts: [], latestTestRunId: null });
    expect(timeline.next.gatedOn).toBeNull();
  });

  it("names a re-run's selection and the build and runner behind an attempt", async () => {
    const row = repository.universe.attempts[2];
    Object.assign(row, {
      build_job_id: "j0b00000-0000-4000-8000-000000000001",
      job_number: 481,
      test_selection: { scope: "failed", test_run_id: attemptId(2), case_keys: ["a".repeat(64)] },
      runner_name: "forge-01",
    });

    const { attempts } = await service.timeline(ORG, RUN);

    expect(attempts[2]).toMatchObject({
      selection: "failed",
      build: { number: 481, runner: "forge-01" },
    });
    expect(attempts[0]).toMatchObject({ selection: null, build: null });
  });

  it("is a 404 run_not_found for a run of another workspace", async () => {
    expect((await refusal(service.timeline(OTHER_ORG, RUN))).code).toBe(RUNS_ERRORS.runNotFound);
  });
});

describe("GET /test-runs/:id — Build 3's page payload", () => {
  it("lists the five suites with platform tags and counts", async () => {
    const page = await service.page(ORG, attemptId(3));

    expect(
      page.suites.map((suite) => [
        suite.name,
        suite.platform,
        suite.counts.passed,
        suite.counts.total,
      ]),
    ).toEqual([
      ["unit · drivers", "native_sim", 24, 24],
      ["telemetry integration", "qemu_cortex_m3", 18, 19],
      ["motor control", "qemu_cortex_m3", 12, 12],
      ["OTA update", "native_sim", 6, 6],
      ["PHYSICAL · HIL rig", "rig:helios-rig-02", 1, 2],
    ]);
    expect(page.suites[4]).toMatchObject({
      kind: "physical",
      rig: "helios-rig-02",
      bench: "CAN bus + motor + power-cycler",
    });
  });

  it("carries each case's retries and flake state", async () => {
    const page = await service.page(ORG, attemptId(3));
    const flaky = page.suites[1].cases.find((each) => each.status === "flaky");

    expect(flaky).toMatchObject({
      retries: 2,
      retryOutcomes: ["failed", "failed", "passed"],
      hasFailure: true,
      flake: { state: "watching", score: 0.5028, windowRuns: 4, formulaVersion: 1 },
    });
    expect(page.suites[0].cases[0]).toMatchObject({ hasFailure: false, flake: null });
  });

  it("prints the rig card's measurements, limits and comparatives", async () => {
    const page = await service.page(ORG, attemptId(3));

    expect(page.physical).toEqual([
      expect.objectContaining({
        name: "frame_order_under_load",
        status: "passed",
        procedure: "traffic generator floods bus at 900 kbit/s for 60s",
        measurements: [
          expect.objectContaining({
            value: 0,
            limit: 0,
            verdict: "pass",
            comparative: "was 37 in build 1",
          }),
        ],
      }),
      expect.objectContaining({
        name: "overshoot_under_load",
        status: "failed",
        measurements: [
          expect.objectContaining({
            metric: "overshoot_pct",
            value: 2.4, // 2.4%
            unit: "%",
            limit: 2.0, // vs limit 2.0%
            limitKind: "max",
            verdict: "fail",
            comparative: null,
            trials: 3,
          }),
        ],
      }),
    ]);
  });

  it("lists the four artifacts, retained 30d, with the coverage row's 87.4% (+0.6%)", async () => {
    const page = await service.page(ORG, attemptId(3));

    expect(page.artifacts.map((each) => [each.name, each.preview, each.retentionDays])).toEqual([
      ["junit-build3.xml", "inline", 30],
      ["rig-capture-estop.csv", "download", 30],
      ["serial-console.log", "inline", 30],
      ["coverage.info", "inline", 30],
    ]);
    expect(page.artifacts[1].sizeBytes).toBe(2_202_010); // 2.1 MB
    expect(page.artifacts[3].coverage).toEqual({
      percent: 87.4,
      linesCovered: 4475,
      linesTotal: 5120,
      delta: 0.6,
      versusAttemptSeq: 2,
    });
    expect(page.coverage).toEqual(page.artifacts[3].coverage);
    expect(page.artifacts[0].coverage).toBeNull();
  });

  it("never lets a storage reference, key or driver reach the client", async () => {
    const text = JSON.stringify(await service.page(ORG, attemptId(3)));

    expect(text).not.toContain("storage_ref");
    expect(text).not.toContain("storageRef");
    expect(text).not.toContain(`${ORG}/482/`);
    expect(text).not.toContain('"local"');
  });

  it("links each live artifact to its download route", async () => {
    const page = await service.page(ORG, attemptId(3));

    expect(page.artifacts[0]).toMatchObject({
      state: "available",
      href: `/api/v1/artifacts/${page.artifacts[0].id}`,
      expiredAt: null,
    });
  });

  it("renders an expired artifact as a tombstone rather than dropping it", async () => {
    const expiredAt = new Date("2026-10-21T00:00:00Z");
    const row = repository.universe.artifacts.find((each) => each.name === "serial-console.log");
    Object.assign(row ?? {}, { expired_at: expiredAt });

    const page = await service.page(ORG, attemptId(3));

    expect(page.artifacts).toHaveLength(4);
    expect(page.artifacts[2]).toMatchObject({
      name: "serial-console.log",
      kind: "log",
      state: "expired",
      expiredAt: expiredAt.toISOString(),
      href: null,
    });
  });

  it("leaves the coverage delta absent, not zero, when there is no prior attempt", async () => {
    const page = await service.page(ORG, attemptId(2));

    expect(page.coverage).toEqual({ percent: 86.8, linesCovered: 4444, linesTotal: 5120 });
    expect(page.coverage).not.toHaveProperty("delta");
    expect(page.coverage).not.toHaveProperty("versusAttemptSeq");
  });

  it("answers null coverage for an attempt that uploaded no report", async () => {
    expect((await service.page(ORG, attemptId(1))).coverage).toBeNull();
  });

  it("carries the current classifications with their receipts", async () => {
    const page = await service.page(ORG, attemptId(3));

    expect(page.classifications).toEqual([
      expect.objectContaining({
        class: "product_bug",
        actor: "heuristic",
        ruleId: "hil.limit_exceeded",
        confidence: null,
        routed: null,
      }),
    ]);
  });

  it("exposes the parser's warnings for the banner, and nothing that is not one", async () => {
    const warning = {
      code: "junit_platform_missing",
      file: "junit-build3.xml",
      message: "A suite named no platform.",
    };
    Object.assign(repository.universe.attempts[2], {
      parse_warnings: [warning, { ...warning, at: "line 212", extra: true }, "junk", null, {}],
    });

    const page = await service.page(ORG, attemptId(3));

    expect(page.parseWarnings).toEqual([warning, { ...warning, at: "line 212" }]);
  });

  it("carries the same strip the timeline does", async () => {
    const page = await service.page(ORG, attemptId(3));
    const timeline = await service.timeline(ORG, RUN);

    expect(page.testRun).toEqual(timeline.attempts[2]);
    expect(page.runId).toBe(RUN);
  });

  it("is a 404 test_run_not_found for an attempt of another workspace", async () => {
    expect((await refusal(service.page(OTHER_ORG, attemptId(3)))).code).toBe(
      TRIAGE_ERRORS.testRunNotFound,
    );
  });
});

describe("GET /test-runs/:id/cases/:caseId/failure", () => {
  /** Build 3's overshoot case. */
  const overshoot = (): string =>
    repository.universe.cases.find(
      (each) => each.test_run_id === attemptId(3) && each.name === "overshoot_under_load",
    )?.id ?? "";

  it("answers the failure detail card: message, log excerpt, path", async () => {
    const failure = await service.failure(ORG, attemptId(3), overshoot());

    expect(failure).toMatchObject({
      testRunId: attemptId(3),
      name: "overshoot_under_load",
      suite: "PHYSICAL · HIL rig",
      platform: "rig:helios-rig-02",
      status: "failed",
      message: "AssertionError: max overshoot 2.4% > limit 2.0%",
      path: "tests/hil/test_estop_release.py",
    });
    expect(failure.logExcerpt).toContain("overshoot 2.4%");
  });

  it("is a 404 test_case_failure_not_found for a case that passed", async () => {
    const passed = repository.universe.cases.find(
      (each) => each.test_run_id === attemptId(3) && each.status === "passed",
    );

    const error = await refusal(service.failure(ORG, attemptId(3), passed?.id ?? ""));

    expect([error.code, error.getStatus()]).toEqual([RESULTS_ERRORS.testCaseFailureNotFound, 404]);
  });

  it("is a 404 test_case_not_found for a case of another attempt", async () => {
    expect((await refusal(service.failure(ORG, attemptId(2), overshoot()))).code).toBe(
      TRIAGE_ERRORS.testCaseNotFound,
    );
  });

  it("is a 404 test_run_not_found across workspaces", async () => {
    expect((await refusal(service.failure(OTHER_ORG, attemptId(3), overshoot()))).code).toBe(
      TRIAGE_ERRORS.testRunNotFound,
    );
  });
});

describe("GET /artifacts/:id — streamed through the store", () => {
  /** The seeded artifact named `name` in Build 3, with bytes written under its key. */
  async function stored(name: string, bytes: Buffer): Promise<string> {
    const row = repository.universe.artifacts.find(
      (each) => each.test_run_id === attemptId(3) && each.name === name,
    );
    if (row === undefined) throw new Error(`no ${name}`);

    const key = storedKey(row.storage_ref, store.driver) ?? "";
    await store.put(key, Readable.from([bytes]), bytes.length);
    Object.assign(row, { size_bytes: String(bytes.length) });
    return row.id;
  }

  it("streams a text artifact inline, with its type and exact length", async () => {
    const bytes = Buffer.from('<testsuites name="twister"/>\n');
    const id = await stored("junit-build3.xml", bytes);

    const download = await service.download(ORG, id);

    expect(download.presentation).toMatchObject({
      contentType: "application/xml",
      disposition: "inline",
    });
    expect(download.sizeBytes).toBe(bytes.length);
    expect(await drain(download.body)).toEqual(bytes);
  });

  it("sends a rig capture as an attachment", async () => {
    const id = await stored("rig-capture-estop.csv", Buffer.from("t_ms,rpm\n0,1200\n"));

    const download = await service.download(ORG, id);
    download.body.destroy();

    expect(download.presentation.disposition).toBe("attachment");
    expect(download.presentation.contentDisposition).toContain('filename="rig-capture-estop.csv"');
  });

  it("is a 410 artifact_expired for a tombstone", async () => {
    const row = repository.universe.artifacts[1];
    Object.assign(row, { expired_at: new Date("2026-10-21T00:00:00Z") });

    const error = await refusal(service.download(ORG, row.id));

    expect([error.code, error.getStatus()]).toEqual([RESULTS_ERRORS.artifactExpired, 410]);
  });

  it("is a 404 artifact_not_found across workspaces", async () => {
    const id = await stored("serial-console.log", Buffer.from("boot ok\n"));

    const error = await refusal(service.download(OTHER_ORG, id));

    expect([error.code, error.getStatus()]).toEqual([RESULTS_ERRORS.artifactNotFound, 404]);
  });

  it("is a 404 artifact_content_unavailable when the store holds no bytes, naming no path", async () => {
    const row = repository.universe.artifacts[1];

    const error = await refusal(service.download(ORG, row.id));

    expect(error.code).toBe(RESULTS_ERRORS.artifactContentUnavailable);
    expect(JSON.stringify(error.envelope())).not.toContain("/482/");
  });

  it("is a 404 artifact_content_unavailable for a row stored through another driver", async () => {
    const row = repository.universe.artifacts[1];
    Object.assign(row, { storage_ref: { driver: "s3", key: "somewhere" } });

    expect((await refusal(service.download(ORG, row.id))).code).toBe(
      RESULTS_ERRORS.artifactContentUnavailable,
    );
  });
});

describe("storedKey", () => {
  it("reads the key of a row stored through this driver", () => {
    expect(storedKey({ driver: "local", key: "a/b" }, "local")).toBe("a/b");
  });

  it.each([
    [{ driver: "s3", key: "a/b" }],
    [{ driver: "local" }],
    [{ driver: "local", key: 7 }],
    [null],
    ["local:a/b"],
  ])("is null for %j", (ref) => {
    expect(storedKey(ref, "local")).toBeNull();
  });
});
