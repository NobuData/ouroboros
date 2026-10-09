/* eslint-disable @typescript-eslint/require-await -- fakes answer at once; async keeps the real signatures */
/**
 * The bisect primitive on the real schema (V118) and the real farm (AH.4) — #617.
 *
 * The engine is the one stand-in: the candidate line comes from a recorded reader. Everything else
 * is the deployment's own — `code_bisects` and its checkpoint, `code_bisect_steps` and V118's
 * guard, `build_jobs` submitted through `FarmJobsService` — and a job is "built" by finishing its
 * row the way the gateway would. A second service over the same rows is a restart.
 */

import { ApiHarness } from "../../../testing/harness.fixture";
import {
  PRIMARY_REPO,
  workspaceWithRepo,
  type SeededWorkspace,
} from "../../../testing/dashboard.fixture";
import { bisectCommitsSchema } from "../../engine/engine.code.contract";
import { FarmJobsService } from "../../farm/dispatch/jobs.service";
import { CodeBisectRepository } from "./code-bisect.repository";
import { CodeBisectService, type StartBisect } from "./code-bisect.service";
import type { CodeReader } from "./code.reader";
import { CodeWorkspace } from "./code.workspace";

/** Twelve candidates: ⌊log₂ 12⌋ + 1 = 4 farm jobs at most. The culprit is the eighth. */
const COMMITS = Array.from({ length: 12 }, (_, index) =>
  (index + 1).toString(16).padStart(40, "c"),
);
const CULPRIT = 7;

describe("the bisect primitive, on the database and the farm", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  async function bench(): Promise<{
    workspace: SeededWorkspace;
    request: StartBisect;
    service: () => CodeBisectService;
  }> {
    const owner = await api.signIn();
    const workspace = await workspaceWithRepo(api, owner);
    await api.sql.query(
      `insert into ouroboros.runner_pools (organization_id, name, executor, image, tags)
       values ($1, 'hil-rig', 'shell', null, '[]')`,
      [workspace.id],
    );
    const slug = `${workspace.slug}/${PRIMARY_REPO}`.toLowerCase();
    const line = bisectCommitsSchema.parse({
      clone: { repository: slug, fetched_at: "2026-10-09T06:00:00Z", stale: false },
      good: "v2.0.4",
      bad: "nightly",
      good_sha: "0".repeat(40),
      bad_sha: COMMITS[11],
      bad_ref_name: "refs/heads/nightly",
      commits: COMMITS,
      max_steps: 4,
    });
    const reader: Pick<CodeReader, "repository" | "read"> = {
      repository: async (org, name) => {
        const found = await api.nest.get(CodeWorkspace).resolve(org, name);
        if (!("id" in found)) throw new Error(`unresolved ${name}`);
        return found;
      },
      read: async () => line as never,
    };
    const service = () =>
      new CodeBisectService(
        api.nest.get(CodeBisectRepository),
        reader as CodeReader,
        api.nest.get(FarmJobsService),
      );
    return {
      workspace,
      service,
      request: {
        organizationId: workspace.id,
        repository: PRIMARY_REPO,
        good: "v2.0.4",
        bad: "nightly",
        testRef: "hil:hover_drift",
        pool: "hil-rig",
        command: ["west", "twister", "-T", "tests/hil"],
      },
    };
  }

  /** Finish a job the way the gateway's `job.finish` does — on a runner of its pool. */
  async function finish(jobId: string, status: "succeeded" | "failed"): Promise<void> {
    await api.sql.query(
      `insert into ouroboros.runners
         (organization_id, pool_id, name, arch, status, last_seen_at, security_mode,
          cert_serial, enrolled_at, telemetry)
       select j.organization_id, j.pool_id, 'rig-01', 'linux/arm64', 'online', now(), 'mtls',
              '4a110e97', now(), '{}'::jsonb
         from ouroboros.build_jobs j
        where j.id = $1
       on conflict do nothing`,
      [jobId],
    );
    await api.sql.query(
      `update ouroboros.build_jobs j
          set runner_id = (select r.id from ouroboros.runners r
                            where r.organization_id = j.organization_id and r.name = 'rig-01'),
              status = $2, offered_at = now(), started_at = now(), finished_at = now(),
              exit_code = $3
        where j.id = $1`,
      [jobId, status, status === "succeeded" ? 0 : 1],
    );
  }

  async function openStep(service: CodeBisectService, org: string, id: string) {
    return (await service.get(org, id))?.steps.find((step) => step.verdict === null);
  }

  it("isolates the planted culprit in at most ⌊log₂ n⌋ + 1 farm jobs, each a build_jobs row", async () => {
    const { workspace, request, service } = await bench();
    const subject = service();
    const started = await subject.start(request);

    for (let guard = 0; guard < 8; guard += 1) {
      const open = await openStep(subject, workspace.id, started.bisect.id);
      if (open === undefined) break;
      await finish(open.buildJobId, open.candidate >= CULPRIT ? "failed" : "succeeded");
      await subject.onCompletion({
        organizationId: workspace.id,
        jobId: open.buildJobId,
        status: "failed",
      });
    }

    const done = await subject.get(workspace.id, started.bisect.id);
    expect(done?.bisect).toMatchObject({ status: "converged", culpritSha: COMMITS[CULPRIT] });
    expect(done?.steps.length).toBeLessThanOrEqual(4);
    const { rows } = await api.sql.query<{ n: number; titles: string[] }>(
      `select count(*)::int as n, array_agg(title order by number) as titles
         from ouroboros.build_jobs where organization_id = $1`,
      [workspace.id],
    );
    expect(rows[0]?.n).toBe(done?.steps.length);
    expect(rows[0]?.titles[0]).toMatch(/^bisect hil:hover_drift · step 1\/4 · /);
  });

  it("resumes from its stored checkpoint after a restart", async () => {
    const { workspace, request, service } = await bench();
    const before = service();
    const started = await before.start(request);
    const first = await openStep(before, workspace.id, started.bisect.id);
    await finish(first?.buildJobId ?? "", "failed"); // nobody hears it: the process is gone

    const after = service();
    await after.resume();

    const resumed = await after.get(workspace.id, started.bisect.id);
    expect(resumed?.steps[0]?.verdict).toBe("bad");
    expect(resumed?.bisect.hi).toBe(first?.candidate);
    expect(resumed?.steps).toHaveLength(2);
    expect(resumed?.steps[1]?.verdict).toBeNull();
  });

  it("answers the same question with the same bisect, matching the command as jsonb", async () => {
    const { workspace, request, service } = await bench();
    const first = await service().start(request);

    expect((await service().start(request)).bisect.id).toBe(first.bisect.id);
    expect((await service().start({ ...request, command: null })).bisect.id).not.toBe(
      first.bisect.id,
    );
    const { rows } = await api.sql.query<{ n: number }>(
      `select count(*)::int as n from ouroboros.code_bisects where organization_id = $1`,
      [workspace.id],
    );
    expect(rows[0]?.n).toBe(2);
  });

  it("is cancelled with its open job", async () => {
    const { workspace, request, service } = await bench();
    const started = await service().start(request);

    const canceled = await service().cancel(workspace.id, started.bisect.id);

    expect(canceled?.bisect.status).toBe("canceled");
    const { rows } = await api.sql.query<{ status: string }>(
      `select status from ouroboros.build_jobs where id = $1`,
      [started.steps[0]?.buildJobId],
    );
    expect(rows[0]?.status).toBe("canceled");
  });

  it("reads the workspace's enabled repositories and the stack detection recorded", async () => {
    const { workspace } = await bench();
    const code = api.nest.get(CodeWorkspace);
    const slug = `${workspace.slug}/${PRIMARY_REPO}`.toLowerCase();

    expect((await code.enabled(workspace.id)).map((repository) => repository.slug)).toEqual([slug]);
    expect(await code.stack(workspace.id, slug)).toEqual({ stack: null, language: null });

    await api.sql.query(
      `insert into ouroboros.repo_detection_scans (organization_id, repo_ref, scan_seq, duration_ms, pack_versions)
       values ($1, $2, 1, 10, '{}')`,
      [workspace.id, slug],
    );
    await api.sql.query(
      `insert into ouroboros.repo_detections (organization_id, repo_ref, scan_seq, row_key, verdict, value, evidence, label)
       values ($1, $2, 1, 'language', 'ok', 'C 81%', '{"top": {"language": "C", "percent": 81}}', 'detected')`,
      [workspace.id, slug],
    );
    expect(await code.stack(workspace.id, slug)).toEqual({ stack: "c", language: "C" });
    expect(await code.enabled("org-elsewhere")).toEqual([]);
  });
});
