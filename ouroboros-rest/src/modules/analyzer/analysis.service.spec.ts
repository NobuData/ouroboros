import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { HttpStatus } from "@nestjs/common";

import type { AuditService } from "../audit/audit.service";
import { NotFoundError } from "../errors/error.envelope";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { AnalysisController } from "./analysis.controller";
import { ANALYZER_SET, completeScript, FakeEngine, FakeRunStore } from "./analysis.fixture";
import { AnalysisOrchestrator } from "./analysis.orchestrator";
import type { AnalysisRepository } from "./analysis.repository";
import { analysisRunResource } from "./analysis.resources";
import { AnalysisService } from "./analysis.service";
import { CorpusAssembler } from "./corpus/corpus.assembler";
import { FakeCorpusRepository, mockupCorpus, ORG, REPO } from "./corpus/corpus.fixture";
import type { CorpusRepository } from "./corpus/corpus.repository";
import type { EngineClient } from "../engine/engine.client";

const ACTOR = "5eed0002-0000-4000-8000-000000000001";

function harness() {
  const store = new FakeRunStore();
  const corpus = new FakeCorpusRepository(mockupCorpus());
  const engine = new FakeEngine();
  engine.script = completeScript();
  const orchestrator = new AnalysisOrchestrator(
    store as unknown as AnalysisRepository,
    corpus as unknown as CorpusRepository,
    new CorpusAssembler(corpus as unknown as CorpusRepository),
    engine as unknown as EngineClient,
    () => Date.UTC(2026, 7, 8, 13),
  );
  const audit = { record: jest.fn().mockResolvedValue("audit-1") };
  const service = new AnalysisService(
    orchestrator,
    store as unknown as AnalysisRepository,
    audit as unknown as AuditService,
  );

  return { store, orchestrator, audit, service };
}

describe("Run analysis now", () => {
  it("starts a manual run and audits who asked, naming the run", async () => {
    const { audit, service, orchestrator } = harness();

    const run = await service.runNow(ORG, ACTOR, REPO);
    await orchestrator.idle();

    expect(run).toMatchObject({
      repo: REPO,
      trigger: "manual",
      status: "running",
      phase: "assembling",
    });
    expect(audit.record).toHaveBeenCalledWith({
      organizationId: ORG,
      actorId: ACTOR,
      action: "analyzer.run_requested",
      subjectType: "analysis_run",
      subjectId: run.id,
      at: new Date(run.startedAt),
      detail: { repo: REPO, trigger: "manual" },
    });
  });

  it("audits nothing when the run is refused", async () => {
    const { audit, service, orchestrator } = harness();
    await service.runNow(ORG, ACTOR, REPO);

    await expect(service.runNow(ORG, ACTOR, REPO)).rejects.toMatchObject({
      response: { code: "analysis_already_running" },
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
    await orchestrator.idle();
  });
});

describe("reading runs", () => {
  it("answers one run with its progress and manifest, in the API's names", async () => {
    const { service, orchestrator } = harness();
    const started = await service.runNow(ORG, ACTOR, REPO);
    await orchestrator.idle();

    const run = await service.run(ORG, started.id);

    expect(run.status).toBe("complete");
    expect(run.manifest?.counts).toEqual({
      builds: 1284,
      loops: 312,
      logLines: 4_100_000,
      hilSessions: 62,
    });
    // No schedule: V080's default 5,000,000-line cap holds all 4.1M, so the logs are read in full.
    expect(run.manifest?.sources.logLines).toEqual({ sampled: false, rate: 1, cap: null });
    expect(run.manifest?.budget.maxLogLines).toBe(5_000_000);
    expect(run.manifest?.confidence).toEqual({
      level: "high",
      windowDays: 90,
      builds: 1284,
      daysWithBuilds: 90,
      coverage: 1,
      perDay: 14.2667,
      rule: { high: { coverage: 0.9, perDay: 5 }, medium: { coverage: 0.6, perDay: 1 } },
    });
    expect(run.progress.analyzers.map((entry) => entry.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
  });

  it("refuses another workspace's run", async () => {
    const { service, orchestrator } = harness();
    const started = await service.runNow(ORG, ACTOR, REPO);
    await orchestrator.idle();

    await expect(service.run("another-org", started.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("answers the newest run, or none before the first analysis", async () => {
    const { service, orchestrator } = harness();

    await expect(service.latest(ORG, REPO)).resolves.toEqual({ run: null });

    const started = await service.runNow(ORG, ACTOR, REPO);
    await orchestrator.idle();

    await expect(service.latest(ORG, REPO)).resolves.toMatchObject({ run: { id: started.id } });
  });
});

describe("the run resource", () => {
  it("renders a seeded manifest written before #510, which carries no label, absences or outcome", () => {
    const resource = analysisRunResource({
      id: "5eed0065-0000-4000-8000-000000000002",
      organization_id: ORG,
      repo_ref: REPO,
      trigger: "every_n_builds",
      schedule_id: null,
      status: "complete",
      corpus_manifest: {
        window: { from: "2026-05-10", to: "2026-08-07", days: 90 },
        counts: { builds: 1284, loops: 312, log_lines: 4100000, hil_sessions: 62 },
        sources: {
          builds: { sampled: false, rate: 1, cap: null },
          loops: { sampled: false, rate: 1, cap: null },
          log_lines: { sampled: true, rate: 0.3, cap: "max_log_lines" },
          hil_sessions: { sampled: false, rate: 1, cap: null },
        },
        budget: { max_builds: 2000, max_log_lines: 1230000, compute_ceiling_seconds: 3600 },
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
      progress: {
        analyzers: [{ id: "change_point", version: 1, status: "completed", findings: 3 }],
      },
    });

    expect(resource).toMatchObject({
      trigger: "every_n_builds",
      computeSeconds: 2460,
      llmCostCents: null,
      manifest: {
        budget: { maxBuilds: 2000, maxLogLines: 1230000, computeCeilingSeconds: 3600 },
        durationLabel: null,
        absent: [],
        analyzers: null,
        confidence: null,
      },
      progress: {
        analyzers: [
          {
            id: "change_point",
            version: 1,
            status: "completed",
            findings: 3,
            elapsedSeconds: null,
            reason: null,
          },
        ],
      },
    });
  });
});

describe("the routes", () => {
  it("lets only administrators start a run, and answers 202", () => {
    expect(Reflect.getMetadata(REQUIRED_ROLES, AnalysisController.prototype.start)).toEqual([
      "owner",
      "admin",
    ]);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, AnalysisController.prototype.start)).toBe(
      HttpStatus.ACCEPTED,
    );
  });

  it("lets every member read a run", () => {
    expect(Reflect.getMetadata(REQUIRED_ROLES, AnalysisController.prototype.read)).toBeUndefined();
    expect(
      Reflect.getMetadata(REQUIRED_ROLES, AnalysisController.prototype.latest),
    ).toBeUndefined();
  });
});
