import { ConflictError, NotFoundError, UpstreamError } from "../errors/error.envelope";
import type { EngineClient } from "../engine/engine.client";
import {
  ANALYZER_SET,
  completeScript,
  FakeEngine,
  FakeRunStore,
  finding,
} from "./analysis.fixture";
import { AnalysisOrchestrator, DISPATCH_MARGIN_MS, RUN_REASONS } from "./analysis.orchestrator";
import type { RunProgress } from "./analysis.progress";
import type { AnalysisRepository } from "./analysis.repository";
import { CorpusAssembler } from "./corpus/corpus.assembler";
import { FakeCorpusRepository, mockupCorpus, ORG, REPO } from "./corpus/corpus.fixture";
import type { CorpusManifest } from "./corpus/corpus.manifest";
import type { CorpusRepository } from "./corpus/corpus.repository";
import { engineUnavailable } from "../engine/engine.errors";

/** The clock, in milliseconds, which a case may move. */
let now = 0;

function harness() {
  const store = new FakeRunStore();
  const corpus = new FakeCorpusRepository(mockupCorpus());
  const engine = new FakeEngine();
  const orchestrator = new AnalysisOrchestrator(
    store as unknown as AnalysisRepository,
    corpus as unknown as CorpusRepository,
    new CorpusAssembler(corpus as unknown as CorpusRepository),
    engine as unknown as EngineClient,
    () => now,
  );

  return { store, corpus, engine, orchestrator };
}

/**
 * Start a manual run and wait for it to end.
 *
 * @param orchestrator - The orchestrator.
 * @returns The run's id.
 */
async function runToEnd(orchestrator: AnalysisOrchestrator): Promise<string> {
  const run = await orchestrator.start({ organizationId: ORG, repoRef: REPO, trigger: "manual" });
  await orchestrator.idle();
  return run.id;
}

beforeEach(() => {
  now = Date.UTC(2026, 7, 8, 13, 0, 0);
});

describe("starting a run", () => {
  it("answers with the run, running in assembling, with every analyzer pending", async () => {
    const { orchestrator, engine } = harness();
    engine.script = completeScript();

    const run = await orchestrator.start({ organizationId: ORG, repoRef: REPO, trigger: "manual" });

    expect(run.status).toBe("running");
    expect(run.phase).toBe("assembling");
    expect(run.analyzer_set).toEqual(ANALYZER_SET);
    expect((run.progress as RunProgress).analyzers.map((entry) => entry.status)).toEqual([
      "pending",
      "pending",
      "pending",
    ]);
    await orchestrator.idle();
  });

  it("refuses a second run while one is going, naming the one that is", async () => {
    const { orchestrator, engine } = harness();
    engine.script = completeScript();
    const first = await orchestrator.start({
      organizationId: ORG,
      repoRef: REPO,
      trigger: "weekly",
    });

    const second = await orchestrator
      .start({ organizationId: ORG, repoRef: REPO, trigger: "manual" })
      .catch((error: unknown) => error);

    expect(second).toBeInstanceOf(ConflictError);
    expect((second as ConflictError).getResponse()).toMatchObject({
      code: "analysis_already_running",
      details: { repo: REPO, runId: first.id, trigger: "weekly", phase: "assembling" },
    });
    await orchestrator.idle();
  });

  it("starts again once the run before has ended", async () => {
    const { orchestrator, engine } = harness();
    engine.script = completeScript();
    await runToEnd(orchestrator);

    await expect(
      orchestrator.start({ organizationId: ORG, repoRef: REPO, trigger: "manual" }),
    ).resolves.toMatchObject({ status: "running" });
    await orchestrator.idle();
  });

  it("refuses a repository the workspace does not have", async () => {
    const { orchestrator } = harness();

    await expect(
      orchestrator.start({ organizationId: ORG, repoRef: "acme-robotics/nope", trigger: "manual" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("starts nothing when the engine cannot say which analyzers it has", async () => {
    const { orchestrator, engine, store } = harness();
    engine.setFailure = engineUnavailable();

    await expect(
      orchestrator.start({ organizationId: ORG, repoRef: REPO, trigger: "manual" }),
    ).rejects.toBeInstanceOf(UpstreamError);
    expect(store.rows.size).toBe(0);
  });

  it("holds the run to its schedule's budget", async () => {
    const { orchestrator, engine, store } = harness();
    engine.script = completeScript();
    store.schedules = [
      {
        id: "5eed0064-0000-4000-8000-000000000001",
        organization_id: ORG,
        repo_ref: REPO,
        enabled: true,
        weekly_enabled: true,
        weekly_day: 1,
        weekly_time: "06:00:00",
        every_n_builds: 50,
        build_counter: 0,
        max_builds: 2000,
        max_log_lines: "1230000",
        compute_ceiling_seconds: 3600,
        updated_by: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const id = await runToEnd(orchestrator);

    const row = store.rows.get(id);
    // A manual run borrows the schedule's budget; it was not triggered by it.
    expect(row?.schedule_id).toBeNull();
    expect((row?.corpus_manifest as CorpusManifest).budget).toEqual({
      max_builds: 2000,
      max_log_lines: 1_230_000,
      compute_ceiling_seconds: 3600,
    });
  });
});

describe("a scheduled run", () => {
  it("records the schedule that triggered it", async () => {
    const { orchestrator, engine, store } = harness();
    engine.script = completeScript();

    const run = await orchestrator.start({
      organizationId: ORG,
      repoRef: REPO,
      trigger: "weekly",
      scheduleId: "5eed0064-0000-4000-8000-000000000001",
    });
    await orchestrator.idle();

    expect(store.rows.get(run.id)?.schedule_id).toBe("5eed0064-0000-4000-8000-000000000001");
  });
});

describe("a run that completes", () => {
  it("moves assembling → analyzing → composing → complete, in that order", async () => {
    const { orchestrator, engine, store } = harness();
    engine.script = completeScript();

    const id = await runToEnd(orchestrator);

    const phases = store.writes.flatMap((write) => {
      if (write.kind === "insert") return ["assembling"];
      if (write.kind === "analyzing") return ["analyzing"];
      if (write.kind === "progress" && write.phase !== undefined) return [write.phase];
      if (write.kind === "finish") return [write.ending.status];
      return [];
    });
    expect(phases).toEqual(["assembling", "analyzing", "composing", "complete"]);
    expect(store.rows.get(id)?.status).toBe("complete");
  });

  it("ticks each analyzer as the engine reports it — running, then completed — while analyzing", async () => {
    const { orchestrator, engine, store } = harness();
    engine.script = completeScript();

    await runToEnd(orchestrator);

    const ticks = store.writes
      .filter((write) => write.kind === "progress" && write.phase === undefined)
      .map((write) =>
        write.kind === "progress"
          ? write.progress.analyzers.map((entry) => entry.status[0]).join("")
          : "",
      );
    // r = running, c = completed, p = pending.
    expect(ticks).toEqual(["rpp", "cpp", "crp", "ccp", "ccr", "ccc"]);
  });

  it("writes each analyzer's findings as it completes, and counts them in its progress", async () => {
    const { orchestrator, engine, store } = harness();
    engine.script = completeScript({
      change_point: [finding("change_point", "2026-05-18"), finding("change_point", "2026-06-22")],
      log_signature: [finding("log_signature", "abc123")],
    });

    const id = await runToEnd(orchestrator);

    expect(store.findings.map((row) => row.subject_key)).toEqual([
      "2026-05-18",
      "2026-06-22",
      "abc123",
    ]);
    const progress = store.rows.get(id)?.progress as RunProgress;
    expect(progress.analyzers.map((entry) => [entry.id, entry.findings])).toEqual([
      ["cache_window", 0],
      ["change_point", 2],
      ["log_signature", 1],
    ]);
  });

  it("stores the manifest the strip renders, the analyzers' outcome and a computed confidence note", async () => {
    const { orchestrator, engine, store } = harness();
    engine.script = completeScript();
    engine.between = () => {
      now += 41 * 6_000;
    };

    const id = await runToEnd(orchestrator);

    const row = store.rows.get(id);
    const manifest = row?.corpus_manifest as CorpusManifest;
    expect(manifest.counts).toEqual({
      builds: 1284,
      loops: 312,
      log_lines: 4_100_000,
      hil_sessions: 62,
    });
    expect(manifest.analyzers).toEqual({
      completed: ["cache_window", "change_point", "log_signature"],
      skipped: [],
      failed: [],
      not_run: [],
    });
    expect(row?.confidence_note).toBe("high — 90d of stable telemetry");
    // The note's basis is stored beside it, so the strip's popover can show what produced it.
    expect(manifest.confidence).toMatchObject({
      level: "high",
      window_days: 90,
      builds: 1284,
      days_with_builds: 90,
      coverage: 1,
      rule: { high: { coverage: 0.9, per_day: 5 }, medium: { coverage: 0.6, per_day: 1 } },
    });
    // Seven events, 41 × 6 s each: the strip's `41 min`.
    expect(row?.compute_seconds).toBe(Math.round((7 * 41 * 6_000) / 1000));
    expect(row?.failure_reason).toBeNull();
  });

  it("dispatches to the engine only, with the run, the corpus and what is left of the ceiling", async () => {
    const { orchestrator, engine } = harness();
    engine.script = completeScript();

    const id = await runToEnd(orchestrator);

    expect(engine.requests).toHaveLength(1);
    const [{ request, deadlineMs }] = engine.requests;
    expect(request.run_id).toBe(id);
    expect(request.corpus.repo_ref).toBe(REPO);
    expect(request.compute_ceiling_seconds).toBe(3600);
    expect(deadlineMs).toBe(3600 * 1000 + DISPATCH_MARGIN_MS);
  });

  it("names an analyzer the engine never reported as not run, without blaming the ceiling", async () => {
    const { orchestrator, engine, store } = harness();
    // log_signature is in the set but the engine's report closes without it.
    engine.script = completeScript().filter(
      (event) =>
        !(event.event === "started" && event.analyzer === "log_signature") &&
        !(event.event === "outcome" && event.outcome.analyzer === "log_signature"),
    );

    const id = await runToEnd(orchestrator);

    const row = store.rows.get(id);
    expect(row?.status).toBe("complete");
    expect((row?.progress as RunProgress).analyzers[2]).toEqual({
      id: "log_signature",
      version: 1,
      status: "not_run",
      reason: RUN_REASONS.unreported,
    });
  });

  it("keeps going when one analyzer's findings are refused by the database, recording that analyzer failed", async () => {
    const { orchestrator, engine, store } = harness();
    store.refuse.add("change_point");
    engine.script = completeScript({
      change_point: [finding("change_point", "bad")],
      log_signature: [finding("log_signature", "ok")],
    });

    const id = await runToEnd(orchestrator);

    const row = store.rows.get(id);
    expect(row?.status).toBe("complete");
    const progress = row?.progress as RunProgress;
    expect(progress.analyzers[1]).toMatchObject({
      id: "change_point",
      status: "failed",
      reason: "its findings were refused by analysis_findings_evidence_resolves",
    });
    expect(store.findings.map((row) => row.subject_key)).toEqual(["ok"]);
  });
});

describe("a run that exceeds its compute ceiling", () => {
  it("keeps the completed analyzers' findings, ends budget_exceeded and names the ones that did not run", async () => {
    const { orchestrator, engine, store } = harness();
    engine.script = [
      { event: "started", analyzer: "cache_window", version: 1 },
      {
        event: "outcome",
        outcome: {
          analyzer: "cache_window",
          version: 1,
          status: "completed",
          findings: [finding("cache_window", "deps-refresh")],
          reason: null,
          elapsedSeconds: 3500,
        },
      },
      { event: "started", analyzer: "change_point", version: 1 },
      {
        event: "outcome",
        outcome: {
          analyzer: "change_point",
          version: 1,
          status: "timed_out",
          findings: [],
          reason: "stopped at the run's compute ceiling",
          elapsedSeconds: 100,
        },
      },
      {
        event: "outcome",
        outcome: {
          analyzer: "log_signature",
          version: 1,
          status: "not_run",
          findings: [],
          reason: "the run's compute ceiling was reached",
          elapsedSeconds: 0,
        },
      },
      { event: "report", budgetExceeded: true, failed: ["change_point"] },
    ];

    const id = await runToEnd(orchestrator);

    const row = store.rows.get(id);
    expect(row?.status).toBe("budget_exceeded");
    expect(store.findings.map((row) => row.subject_key)).toEqual(["deps-refresh"]);
    expect((row?.corpus_manifest as CorpusManifest).analyzers).toEqual({
      completed: ["cache_window"],
      skipped: [],
      failed: ["change_point"],
      not_run: ["log_signature"],
    });
    expect(row?.failure_reason).toBe(
      "The compute ceiling of 3600 s was reached. Kept the findings of 1 analyzer(s); " +
        "did not finish: log_signature, change_point.",
    );
  });

  it("ends budget_exceeded without dispatching when assembly itself spends the ceiling", async () => {
    const { orchestrator, engine, store, corpus } = harness();
    // Every build page costs an hour.
    const page = corpus.buildPage.bind(corpus);
    corpus.buildPage = (...args) => {
      now += 3_600_000;
      return page(...args);
    };

    const id = await runToEnd(orchestrator);

    const row = store.rows.get(id);
    expect(engine.requests).toHaveLength(0);
    expect(row?.status).toBe("budget_exceeded");
    expect(row?.failure_reason).toBe(RUN_REASONS.assemblyOverrun);
    const manifest = row?.corpus_manifest as CorpusManifest;
    expect(manifest.sources.builds.cap).toBe("compute_ceiling_seconds");
    expect(manifest.analyzers?.not_run).toEqual(["cache_window", "change_point", "log_signature"]);
  });
});

describe("a run that fails", () => {
  it("fails with the reason when the engine's stream breaks off, keeping what had been written", async () => {
    const { orchestrator, engine, store } = harness();
    engine.script = completeScript({ cache_window: [finding("cache_window", "kept")] }).slice(0, 2);
    engine.breakWith = engineUnavailable();

    const id = await runToEnd(orchestrator);

    const row = store.rows.get(id);
    expect(row?.status).toBe("failed");
    expect(row?.failure_reason).toBe(RUN_REASONS.engineUnavailable);
    expect(store.findings).toHaveLength(1);
    expect((row?.corpus_manifest as CorpusManifest).analyzers?.not_run).toEqual([
      "change_point",
      "log_signature",
    ]);
  });

  it("fails when the stream ends without its report", async () => {
    const { orchestrator, engine, store } = harness();
    engine.script = completeScript().slice(0, -1);

    const id = await runToEnd(orchestrator);

    expect(store.rows.get(id)).toMatchObject({
      status: "failed",
      failure_reason: RUN_REASONS.noReport,
    });
  });

  it("fails, rather than hanging the guard, when assembly throws", async () => {
    const { orchestrator, store, corpus } = harness();
    corpus.counts = () => Promise.reject(new Error("connection terminated"));

    const id = await runToEnd(orchestrator);

    expect(store.rows.get(id)).toMatchObject({
      status: "failed",
      failure_reason: RUN_REASONS.internalError,
    });
  });
});

describe("shutting down", () => {
  it("fails the runs still in flight, so none holds the guard shut", async () => {
    const { orchestrator, store, corpus } = harness();
    let release: () => void = () => undefined;
    corpus.counts = () =>
      new Promise((resolve) => {
        release = () => {
          resolve({ builds: 0, hilSessions: 0, logLines: 0, loops: 0, daysWithBuilds: 0 });
        };
      });
    const run = await orchestrator.start({ organizationId: ORG, repoRef: REPO, trigger: "manual" });

    await orchestrator.onApplicationShutdown();

    expect(store.rows.get(run.id)).toMatchObject({
      status: "failed",
      failure_reason: RUN_REASONS.serviceStopped,
    });
    release();
    await orchestrator.idle();
    // The run's own ending found it already ended and wrote nothing.
    expect(store.writes.filter((write) => write.kind === "finish")).toHaveLength(1);
  });
});
