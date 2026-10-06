/**
 * The detection statements and routes against a real PostgreSQL
 * ([#384](https://github.com/NobuData/ouroboros/issues/384)) — V067's tables, grants and triggers
 * holding what the in-memory store only imitates: `scan_seq` versioning, an edited protected path
 * surviving a re-scan's suggestions, the one granted relabel, and the test-plane join — and, since
 * #391, a saved protected-path list (V105) that scans stop suggesting over and the guardrails read.
 */

import { ApiHarness, type Person } from "../../testing/harness.fixture";
import {
  PRIMARY_REPO,
  workspaceWithRepo,
  type SeededWorkspace,
} from "../../testing/dashboard.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { DETECTION_ERRORS } from "./detection.errors";
import { EMPTY, ZEPHYR, fixtureProber } from "./detection.fixture";
import { measuredTestsRow } from "./detection.reconcile";
import { GuardrailsRepository } from "../guardrails/guardrails.repository";
import { DatabaseService } from "../db/db.service";
import { DetectionRepository } from "./detection.repository";
import type { DetectionResource } from "./detection.resources";
import { runScan, type ScanOutcome } from "./detection.scan";
import { CORE_PACKS } from "./packs/core.packs";

describe("repository detection", () => {
  let api: ApiHarness;
  let repository: DetectionRepository;

  beforeAll(async () => {
    api = await ApiHarness.start();
    repository = api.nest.get(DetectionRepository);
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** A workspace with a mirrored repository, and its `repo_ref`. */
  async function bench(): Promise<{ owner: Person; workspace: SeededWorkspace; repo: string }> {
    const owner = await api.signIn();
    const workspace = await workspaceWithRepo(api, owner);

    return { owner, workspace, repo: `${workspace.slug}/${PRIMARY_REPO}`.toLowerCase() };
  }

  /** A scan of a fixture, ready to store. */
  async function scanned(fixture = ZEPHYR): Promise<ScanOutcome> {
    return runScan(CORE_PACKS, fixtureProber(fixture).prober);
  }

  /**
   * Store an outcome.
   *
   * @param organizationId - The workspace.
   * @param repo - The repository.
   * @param outcome - The scan.
   * @returns The scan_seq.
   */
  function record(organizationId: string, repo: string, outcome: ScanOutcome): Promise<number> {
    return repository.recordScan({
      organizationId,
      repo,
      durationMs: outcome.durationMs,
      packVersions: outcome.packVersions,
      probesUsed: outcome.probesUsed,
      rows: outcome.rows,
      protectedPaths: outcome.protectedPaths,
    });
  }

  it("versions scans by scan_seq, keeping the earlier one readable", async () => {
    const { workspace, repo } = await bench();

    expect(await record(workspace.id, repo, await scanned())).toBe(1);
    expect(await record(workspace.id, repo, await scanned(EMPTY))).toBe(2);

    const latest = await repository.scan(workspace.id, repo);
    const first = await repository.scan(workspace.id, repo, 1);

    expect(latest?.scan.scan_seq).toBe(2);
    expect(latest?.rows.map((row) => row.verdict)).toEqual(Array(6).fill("missing"));
    expect(first?.scan).toMatchObject({ scan_seq: 1, probe_budget_used: 9 });
    expect(first?.scan.pack_versions).toMatchObject({ language: "1.0.0" });
    expect(first?.rows.map((row) => [row.row_key, row.value])).toContainEqual([
      "build",
      "west + twister (found west.yml)",
    ]);
    expect(await repository.scan("org-elsewhere", repo)).toBeUndefined();
  });

  it("writes suggestions as editable policy, and never overwrites an edited one", async () => {
    const { workspace, repo } = await bench();

    await api.sql.query(
      `insert into ouroboros.protected_path_policies (organization_id, repo_ref, path_glob, source)
       values ($1, $2, 'boot/**', 'edited')`,
      [workspace.id, repo],
    );
    await record(workspace.id, repo, await scanned());
    await record(workspace.id, repo, await scanned());

    expect(await repository.policies(workspace.id, repo)).toEqual([
      { path_glob: "boot/**", source: "edited" },
      { path_glob: "keys/**", source: "suggested" },
    ]);
  });

  it("reads the newest completed test run of the repository, and relabels the tests row", async () => {
    const { workspace, repo } = await bench();

    expect(await repository.measuredTests(workspace.id, repo)).toBeUndefined();

    const { rows: runs } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title,
                                   workflow_tag, model, status, stage_label, stage_index,
                                   stage_total, started_at)
       values ($1, $2, 482, 'Fix flaky CAN-bus telemetry test', 'standard-fix',
               'claude-fable-5', 'building', 'Build farm', 5, 6, now() - interval '1 day')
       returning id`,
      [workspace.id, workspace.repoId],
    );
    const { rows: attempts } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.test_runs (organization_id, run_id, attempt_seq, total, passed, status)
       values ($1, $2, 1, 71, 71, 'complete') returning id`,
      [workspace.id, runs[0].id],
    );

    for (const [name, platform] of [
      ["kernel.timer", "native_sim"],
      ["kernel.timer", "qemu_x86"],
      ["drivers.i2c", "native_sim"],
    ]) {
      await api.sql.query(
        `insert into ouroboros.test_suites (organization_id, test_run_id, name, platform, kind)
         values ($1, $2, $3, $4, 'sim')`,
        [workspace.id, attempts[0].id, name, platform],
      );
    }

    const measured = await repository.measuredTests(workspace.id, repo);

    expect(measured).toMatchObject({
      testRunId: attempts[0].id,
      runId: runs[0].id,
      suites: 2,
      tests: 71,
    });
    expect(await repository.measuredTests("org-elsewhere", repo)).toBeUndefined();

    await record(workspace.id, repo, await scanned());
    await repository.relabelTests(workspace.id, repo, 1, measuredTestsRow(measured!));

    const tests = (await repository.scan(workspace.id, repo))?.rows.find(
      (row) => row.row_key === "tests",
    );

    expect(tests).toMatchObject({ label: "measured", value: "2 suites, 71 tests (measured)" });
  });

  it("serves the card through the API, and refuses a scan nothing can probe", async () => {
    const { owner, workspace, repo } = await bench();
    const call = api.as(owner);

    await record(workspace.id, repo, await scanned());

    const read = await call(
      "get",
      `/api/v1/onboarding/detection?repo=${encodeURIComponent(repo)}`,
    ).set(TENANT_HEADER, workspace.slug);

    expect(read.status).toBe(200);
    expect(bodyOf<DetectionResource>(read).rows.map((row) => row.value)).toContain(
      "5 suites, 63 tests (detected)",
    );

    const prior = await call(
      "get",
      `/api/v1/onboarding/detection/scans/9?repo=${encodeURIComponent(repo)}`,
    ).set(TENANT_HEADER, workspace.slug);

    expect(prior.status).toBe(404);
    expect(bodyOf<ErrorEnvelope>(prior).code).toBe(DETECTION_ERRORS.scanNotFound);

    const scan = await call(
      "post",
      `/api/v1/onboarding/detection/scan?repo=${encodeURIComponent(repo)}`,
    ).set(TENANT_HEADER, workspace.slug);

    expect(scan.status).toBe(409);
    expect(bodyOf<ErrorEnvelope>(scan).code).toBe(DETECTION_ERRORS.sourceMissing);
  });

  it("replaces the list with a person's, and no later scan suggests over it — an emptied list too (#391)", async () => {
    const { workspace, repo } = await bench();

    await record(workspace.id, repo, await scanned());
    expect(
      await repository.replacePolicies(workspace.id, repo, ["firmware/keys/**", "boot/**"]),
    ).toEqual([
      { path_glob: "boot/**", source: "edited" },
      { path_glob: "firmware/keys/**", source: "edited" },
    ]);

    await record(workspace.id, repo, await scanned());
    expect(await repository.policies(workspace.id, repo)).toEqual([
      { path_glob: "boot/**", source: "edited" },
      { path_glob: "firmware/keys/**", source: "edited" },
    ]);

    await repository.replacePolicies(workspace.id, repo, []);
    await record(workspace.id, repo, await scanned());
    expect(await repository.policies(workspace.id, repo)).toEqual([]);

    const state = await api.sql.query<{ protected_paths_edited_at: Date | null }>(
      `select protected_paths_edited_at from ouroboros.onboarding_state
        where organization_id = $1 and repo_ref = $2`,
      [workspace.id, repo],
    );
    expect(state.rows[0]?.protected_paths_edited_at).toBeInstanceOf(Date);
  });

  it("saves through the API for an owner, refuses a member and a bad glob, and the guardrails read it (#391)", async () => {
    const { owner, workspace, repo } = await bench();
    const member = await api.signIn();
    await api.join(workspace.id, member, "member");
    await record(workspace.id, repo, await scanned());
    const path = `/api/v1/onboarding/detection/protected-paths?repo=${encodeURIComponent(repo)}`;

    const refused = await api
      .as(member)("put", path)
      .set(TENANT_HEADER, workspace.slug)
      .send({ globs: ["boot/**"] });
    expect(refused.status).toBe(403);

    const invalid = await api
      .as(owner)("put", path)
      .set(TENANT_HEADER, workspace.slug)
      .send({ globs: ["keys/**", "/etc/**"] });
    expect(invalid.status).toBe(422);
    expect(bodyOf<ErrorEnvelope>(invalid)).toMatchObject({
      code: DETECTION_ERRORS.globInvalid,
      details: { invalid: ["/etc/**"] },
    });
    expect((await repository.policies(workspace.id, repo)).map((row) => row.source)).toEqual([
      "suggested",
      "suggested",
    ]);

    const saved = await api
      .as(owner)("put", path)
      .set(TENANT_HEADER, workspace.slug)
      .send({ globs: ["boot/**", "firmware/keys/**"] });
    expect(saved.status).toBe(200);
    expect(bodyOf<DetectionResource>(saved).protectedPaths).toEqual([
      { glob: "boot/**", source: "edited" },
      { glob: "firmware/keys/**", source: "edited" },
    ]);

    const guardrails = api.nest.get(GuardrailsRepository);
    const run = {
      organizationId: workspace.id,
      githubRepoId: workspace.repoId,
      issueNumber: 1,
      workflowTag: "quick-fixes",
      workflowVersionPin: null,
    };
    expect(await guardrails.protectedPaths(api.nest.get(DatabaseService).db, run)).toEqual([
      "boot/**",
      "firmware/keys/**",
    ]);
  });
});
