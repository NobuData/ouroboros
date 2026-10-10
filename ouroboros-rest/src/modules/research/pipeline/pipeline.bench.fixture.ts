/**
 * The roadmap pipeline, assembled over the suites' stand-ins (CM.5, #624): every service is the
 * real one; the store, the repository, the skill runner, Planning, the brief and the audit log
 * are fakes a test can read and steer.
 */

import type { AuditRecord } from "../../audit/audit.events";
import { RoadmapDriftService } from "./roadmap.drift.service";
import { RoadmapIssuesService } from "./roadmap.issues.service";
import { RoadmapProjector } from "./roadmap.projector";
import { RoadmapService } from "./roadmap.service";
import { FakePlanning, FakeRepo, MemoryPipelineStore, ScriptedSkills } from "./pipeline.fixture";

/** The brief's Markdown export the fakes answer. */
export const BRIEF_MARKDOWN =
  "# RS-124 — Q4 product improvements\n\nDocking aborts in gusts [07].\n";

/** Everything a pipeline test touches. */
export interface PipelineBench {
  readonly store: MemoryPipelineStore;
  readonly repo: FakeRepo;
  readonly skills: ScriptedSkills;
  readonly planning: FakePlanning;
  readonly audits: AuditRecord[];
  /** The workspace's dry-run switch; a test flips it. */
  readonly policy: { dryRun: boolean };
  readonly projector: RoadmapProjector;
  readonly roadmap: RoadmapService;
  readonly issues: RoadmapIssuesService;
  readonly drift: RoadmapDriftService;
}

/**
 * Assemble the pipeline over fresh stand-ins.
 *
 * @returns The bench.
 */
export function pipelineBench(): PipelineBench {
  const store = new MemoryPipelineStore();
  const repo = new FakeRepo();
  const skills = new ScriptedSkills();
  const planning = new FakePlanning(store);
  const audits: AuditRecord[] = [];
  const policy = { dryRun: false };
  const briefs = {
    export: () => Promise.resolve({ filename: "RS-124-brief.md", markdown: BRIEF_MARKDOWN }),
  };
  const audit = {
    record: (event: AuditRecord) => {
      audits.push(event);

      return Promise.resolve("audit-1");
    },
  };
  const projector = new RoadmapProjector(
    store as never,
    repo as never,
    { dryRunNow: () => Promise.resolve(policy.dryRun) } as never,
  );
  const roadmap = new RoadmapService(
    store as never,
    briefs as never,
    skills as never,
    projector,
    audit as never,
  );

  roadmap.clock = () => new Date("2026-10-01T12:00:00.000Z");

  const issues = new RoadmapIssuesService(
    store as never,
    roadmap,
    briefs as never,
    skills as never,
    planning as never,
  );
  const drift = new RoadmapDriftService(store as never, roadmap, projector);

  return { store, repo, skills, planning, audits, policy, projector, roadmap, issues, drift };
}
