import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { FarmJobsService } from "../dispatch/jobs.service";
import { certificationRequest } from "../farm.fixture";
import type { EnrollmentResource, MintedTokenResource } from "../farm.resources";
import { FakeAgent, isRefused } from "../gateway/fake.agent.fixture";
import { fixtureFrame } from "../gateway/gateway.fixture";
import type { Envelope } from "../protocol/protocol";
import type { ArtifactStore } from "./artifact.store";
import { ARTIFACT_STORE } from "./artifact.store.factory";
import { startMinio, type StartedMinio } from "./minio.fixture";
import {
  checksumOf,
  manifestOf,
  mockupFiles,
  uploadBody,
  type FixtureFile,
  type MultipartBody,
} from "./upload.fixture";
import { BUILT_IN_ARTIFACT_GLOBS } from "./upload.policy";
import type { UploadReceipt } from "./upload.service";
import { hashUploadToken } from "./upload.token";

/**
 * The job-scoped artifact upload, end to end ([#330](https://github.com/NobuData/ouroboros/issues/330)):
 * a run's build job dispatched to a runner over the real gateway, its offer carrying the
 * single-use upload token, and the runner's upload over HTTPS — never the socket — into the
 * artifact store, the parsed attempt and the receipt, against a migrated database.
 *
 * **Declared twice, unchanged**: once with the local volume and once with a real MinIO, the only
 * difference being the `OURO_ARTIFACT_*` variables the application is started with — the
 * criterion that the driver swap is configuration only, asked of the whole path rather than of the
 * store alone (`artifact.store.integration-spec.ts` asks it of the store).
 *
 * The acceptance criteria, as a reader of the page would ask them:
 *
 *   * A farm job uploads the fixture set, and it becomes the attempt the page renders.
 *   * An oversize file is a truncation manifest, never a silent drop.
 *   * The token is single use and job-scoped: a replay fails, and so does another job's token.
 *   * A quota breach is a designed warning and does not fail the build job.
 *   * Checksums are verified here; a corrupted upload is a typed refusal that keeps nothing.
 *   * Nothing about the transfer touches the agent's control WebSocket.
 *
 * ```bash
 * yarn test:integration src/modules/farm/artifacts/upload.integration-spec.ts
 * ```
 */

/** The header this suite's application trusts a proxy to forward a certificate in. */
const HEADER = "x-ouro-client-cert";

/** The commit every build here is of. */
const COMMIT = "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80";

/** A workspace with a rig pool, a repository and a loop run, and an owner in it. */
interface Farm {
  readonly owner: Person;
  readonly workspace: Workspace;
  readonly runId: string;
}

/** A dispatched job, as its runner saw it. */
interface Offered {
  readonly jobId: string;
  readonly offer: Envelope<"job.offer">;
  readonly token: string;
  readonly path: string;
}

let minio: StartedMinio;
let volume: string;

beforeAll(async () => {
  volume = await mkdtemp(join(tmpdir(), "ouro-upload-volume-"));
  minio = await startMinio();
}, 180_000);

afterAll(async () => {
  await rm(volume, { recursive: true, force: true });
  // Undefined when the start failed — the failure the suite already reports.
  await (minio as StartedMinio | undefined)?.stop();
});

describe.each([
  ["the local volume", "local", (): NodeJS.ProcessEnv => ({ OURO_ARTIFACT_DIR: volume })],
  [
    "MinIO",
    "s3",
    (): NodeJS.ProcessEnv => ({
      OURO_ARTIFACT_S3_ENDPOINT: minio.endpoint,
      OURO_ARTIFACT_S3_BUCKET: minio.bucket,
      OURO_ARTIFACT_S3_ACCESS_KEY_ID: minio.accessKeyId,
      OURO_ARTIFACT_S3_SECRET_ACCESS_KEY: minio.secretAccessKey,
    }),
  ],
])("the artifact upload, stored on %s", (_where, driver, environment) => {
  let api: ApiHarness;
  const agents: FakeAgent[] = [];

  beforeAll(async () => {
    api = await ApiHarness.start({
      OURO_FARM_CLIENT_CERT_HEADER: HEADER,
      OURO_ARTIFACT_STORE: driver,
      ...environment(),
    });
  });

  afterAll(() => api.close());

  afterEach(async () => {
    for (const agent of agents.splice(0)) agent.drop();
    await api.truncate();
  });

  /** The store the application writes through. */
  function store(): ArtifactStore {
    return api.nest.get<ArtifactStore>(ARTIFACT_STORE);
  }

  /** A workspace with a rig pool that collects captures, a repository and a loop run. */
  async function farm(): Promise<Farm> {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);

    await api.sql.query(
      `insert into ouroboros.runner_pools
         (organization_id, name, executor, default_command, artifact_globs, max_concurrency)
       values ($1, 'pool-a', 'shell', 'west twister', '["captures/*.csv"]', 2)`,
      [workspace.id],
    );
    const { rows: orgs } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_orgs (organization_id, login, enabled)
       values ($1, 'acme-robotics', true) returning id`,
      [workspace.id],
    );
    const { rows: repos } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_repos (org_id, name, enabled)
       values ($1, 'helios-firmware', true) returning id`,
      [orgs[0].id],
    );
    const { rows: runs } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title,
                                   workflow_tag, model, status, stage_label, stage_index,
                                   stage_total, started_at)
       values ($1, $2, 482, 'Fix flaky CAN-bus telemetry test', 'standard-fix',
               'claude-fable-5', 'building', 'Build farm', 5, 6, now() - interval '20 minutes')
       returning id`,
      [workspace.id, repos[0].id],
    );

    return { owner, workspace, runId: runs[0].id };
  }

  /** Enrol a machine into pool-a through the real routes, connect it, and say hello. */
  async function runner(context: Farm, name = "hil-rig-02"): Promise<FakeAgent> {
    const minted = bodyOf<MintedTokenResource>(
      await api
        .as(context.owner)("post", "/api/v1/farm/enrollment-tokens")
        .set(TENANT_HEADER, context.workspace.id)
        .send({ pool: "pool-a" })
        .expect(201),
    );
    const enrollment = bodyOf<EnrollmentResource>(
      await api
        .anonymous("post", "/api/v1/farm/registrations")
        .send({ token: minted.token, name, arch: "linux/x86_64", csr: certificationRequest() })
        .expect(201),
    );

    const agent = await FakeAgent.connect(api.baseUrl, {
      certificate: enrollment.certificate as string,
      header: HEADER,
    });
    if (isRefused(agent)) throw new Error(`refused: ${String(agent.status)} ${agent.code}`);
    agents.push(agent);
    const hello = fixtureFrame("valid/hello.json");
    Object.assign(hello.payload.capabilities as object, { docker: false, shell: true });
    agent.send(hello);
    await agent.next("ack");

    return agent;
  }

  /** Submit a build of the loop run, as its build stage will (AJ.3), and take its offer. */
  async function dispatched(
    context: Farm,
    agent: FakeAgent,
    artifacts?: string[],
  ): Promise<Offered> {
    const job = await api.nest
      .get(FarmJobsService)
      .submitForRun(context.workspace.id, context.runId, {
        pool: "pool-a",
        repository: "acme-robotics/helios-firmware",
        ref: "refs/heads/fix/482",
        commit: COMMIT,
        ...(artifacts ? { artifacts } : {}),
      });
    const offer = await agent.next("job.offer");
    agent.accept(offer);
    await accepted(job.id);

    const upload = offer.payload.upload;
    if (!upload) throw new Error("the offer carried no upload");

    return { jobId: job.id, offer, token: upload.token, path: upload.path };
  }

  /**
   * Wait until the gateway has recorded a job's accept, so what a case reads next is settled.
   *
   * @param jobId - The job.
   */
  async function accepted(jobId: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { rows } = await api.sql.query<{ status: string }>(
        `select status from ouroboros.build_jobs where id = $1`,
        [jobId],
      );
      if (rows[0]?.status !== "offered") return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`job ${jobId} was never accepted`);
  }

  /**
   * Upload as the runner would.
   *
   * @param path - The offer's `upload.path`.
   * @param token - The bearer token.
   * @param body - The multipart.
   * @returns The Supertest response.
   */
  function upload(path: string, token: string, body: MultipartBody) {
    return api
      .anonymous("post", path)
      .set("authorization", `Bearer ${token}`)
      .set("content-type", body.contentType)
      .send(body.body);
  }

  /** The job's upload ledger. */
  async function ledger(jobId: string) {
    const { rows } = await api.sql.query<{
      token_hash: string;
      closed_at: Date | null;
      test_run_id: string | null;
      manifest: { name: string; status: string; reason?: string; note?: string }[] | null;
      warnings: { code: string; file: string }[];
      stored_bytes: string;
    }>(`select * from ouroboros.build_job_artifact_uploads where build_job_id = $1`, [jobId]);
    return rows[0];
  }

  /** The job's registered artifacts, by name. */
  async function artifacts(jobId: string) {
    const { rows } = await api.sql.query<{
      id: string;
      name: string;
      kind: string;
      size_bytes: string;
      checksum: string;
      storage_ref: { driver: string; key: string };
      truncated: boolean;
      truncation_note: string | null;
      lines_covered: string | null;
      lines_total: string | null;
      retention_days: number;
    }>(
      `select a.*, round(extract(epoch from a.retained_until - a.created_at) / 86400)::int as retention_days
         from ouroboros.test_artifacts a
         join ouroboros.test_runs t on t.id = a.test_run_id
        where t.build_job_id = $1
        order by a.name`,
      [jobId],
    );
    return rows;
  }

  it("offers a run's build with a single-use upload token, and keeps only its hash", async () => {
    const context = await farm();
    const agent = await runner(context);

    const { jobId, offer, token, path } = await dispatched(context, agent, [
      "logs/serial-console.log",
    ]);

    expect(offer.payload.upload).toMatchObject({
      path: `/api/v1/farm/jobs/${jobId}/artifacts`,
      globs: [...BUILT_IN_ARTIFACT_GLOBS, "captures/*.csv", "logs/serial-console.log"],
      max_files: 256,
    });
    expect(token).toMatch(/^ouro_upl_/);
    expect(path).toBe(offer.payload.upload?.path);

    const row = await ledger(jobId);
    expect(row.token_hash).toBe(hashUploadToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.closed_at).toBeNull();
  });

  it("offers a build no run is attributed to with nowhere to upload", async () => {
    const context = await farm();
    const agent = await runner(context);

    await api
      .as(context.owner)("post", "/api/v1/farm/jobs")
      .set(TENANT_HEADER, context.workspace.id)
      .send({
        pool: "pool-a",
        repository: "acme-robotics/helios-firmware",
        ref: "refs/heads/main",
        commit: COMMIT,
      })
      .expect(201);
    const offer = await agent.next("job.offer");

    expect(offer.payload).not.toHaveProperty("upload");
  });

  it("uploads the fixture set, and the attempt the page renders is parsed from it — over HTTPS, not the socket", async () => {
    const context = await farm();
    const agent = await runner(context);
    const { jobId, token, path } = await dispatched(context, agent);
    const files = mockupFiles();
    await agent.quiet(200);

    const receipt = bodyOf<UploadReceipt>(await upload(path, token, uploadBody(files)).expect(201));

    // The control socket carried nothing for the transfer, in either direction.
    expect(await agent.quiet(300)).toEqual([]);

    expect(receipt.files.map((file) => [file.name, file.status, file.kind])).toEqual([
      ["junit-build3.xml", "stored", "junit"],
      ["coverage/lcov.info", "stored", "coverage"],
      ["rig-capture-estop.csv", "stored", "capture"],
      ["serial-console.log", "stored", "log"],
    ]);
    expect(receipt.warnings).toEqual([]);
    expect(receipt.results?.total).toBeGreaterThan(0);

    const { rows: attempts } = await api.sql.query<{
      id: string;
      status: string;
      attempt_seq: number;
      total: number;
      commit_sha: string;
    }>(`select * from ouroboros.test_runs where build_job_id = $1`, [jobId]);
    expect(attempts).toEqual([
      expect.objectContaining({
        id: receipt.testRun,
        status: "complete",
        attempt_seq: 1,
        total: receipt.results?.total,
        commit_sha: COMMIT,
      }),
    ]);
    const { rows: suites } = await api.sql.query(
      `select 1 from ouroboros.test_suites where test_run_id = $1`,
      [receipt.testRun],
    );
    expect(suites.length).toBeGreaterThan(0);

    const rows = await artifacts(jobId);
    expect(
      rows.map((row) => [row.name, row.kind, row.storage_ref.driver, row.retention_days]),
    ).toEqual([
      ["coverage/lcov.info", "coverage", driver, 30],
      ["junit-build3.xml", "junit", driver, 30],
      ["rig-capture-estop.csv", "capture", driver, 30],
      ["serial-console.log", "log", driver, 30],
    ]);
    const coverage = rows[0];
    expect(Number(coverage.lines_total)).toBeGreaterThan(0);
    for (const row of rows) {
      const original = files.find((file) => file.name === row.name) as FixtureFile;
      expect(row.checksum).toBe(checksumOf(original.bytes));
      expect((await store().get(row.storage_ref.key)).equals(original.bytes)).toBe(true);
    }

    const closed = await ledger(jobId);
    expect(closed.closed_at).not.toBeNull();
    expect(closed.test_run_id).toBe(receipt.testRun);
    expect(closed.manifest?.map((entry) => entry.status)).toEqual([
      "stored",
      "stored",
      "stored",
      "stored",
    ]);
    expect(Number(closed.stored_bytes)).toBe(
      files.reduce((sum, file) => sum + file.bytes.length, 0),
    );
  });

  it("is single use: a replay of the same upload is refused and writes nothing", async () => {
    const context = await farm();
    const agent = await runner(context);
    const { jobId, token, path } = await dispatched(context, agent);
    const body = uploadBody(mockupFiles());
    await upload(path, token, body).expect(201);

    const replay = await upload(path, token, body).expect(409);

    expect(replay.body).toMatchObject({ code: "farm_artifact_upload_closed" });
    expect(await artifacts(jobId)).toHaveLength(4);
  });

  it("is job-scoped: one job's token is refused on another job, and the other's on it", async () => {
    const context = await farm();
    const agent = await runner(context);
    const first = await dispatched(context, agent);
    const second = await dispatched(context, agent);
    const body = uploadBody(mockupFiles());

    const crossed = await upload(first.path, second.token, body).expect(401);
    await upload(second.path, first.token, body).expect(401);
    await upload(first.path, "ouro_upl_not-a-token-anybody-was-given", body).expect(401);
    await api
      .anonymous("post", first.path)
      .set("content-type", body.contentType)
      .send(body.body)
      .expect(401);

    expect(crossed.body).toEqual({
      code: "farm_artifact_upload_refused",
      message: "This upload token is not valid for this job.",
      details: {},
    });
    expect(await artifacts(first.jobId)).toEqual([]);
    expect(await artifacts(second.jobId)).toEqual([]);
    // Each job's own token still works: a refusal spent nothing.
    await upload(first.path, first.token, body).expect(201);
  });

  it("refuses a corrupted upload with a typed error, keeps nothing, and accepts the retry", async () => {
    const context = await farm();
    const agent = await runner(context);
    const { jobId, token, path } = await dispatched(context, agent);
    const files = mockupFiles();
    const corrupted = files.map((file, index) =>
      index === 0
        ? { ...file, bytes: Buffer.concat([file.bytes.subarray(0, -1), Buffer.from("!")]) }
        : file,
    );

    const refused = await upload(path, token, uploadBody(corrupted, [], manifestOf(files))).expect(
      422,
    );

    expect(refused.body).toMatchObject({
      code: "farm_artifact_checksum_mismatch",
      details: { file: "junit-build3.xml", declared: checksumOf(files[0].bytes) },
    });
    expect(await artifacts(jobId)).toEqual([]);
    expect((await ledger(jobId)).closed_at).toBeNull();

    await upload(path, token, uploadBody(files)).expect(201);
    expect(await artifacts(jobId)).toHaveLength(4);
  });

  it("turns an oversize file into a truncation manifest the page can render — never a silent drop", async () => {
    const context = await farm();
    const agent = await runner(context);
    const { jobId, token, path } = await dispatched(context, agent);
    const note = "cut at 64 MiB of 94 MiB (per-file cap)";
    const files: FixtureFile[] = [
      mockupFiles()[0],
      {
        name: "rig-capture-estop.csv",
        bytes: Buffer.from("t_ms,torque_nm\n0,2.0\n"),
        truncated: { original_bytes: 98_566_144, note },
      },
    ];

    const receipt = bodyOf<UploadReceipt>(
      await upload(
        path,
        token,
        uploadBody(files, [
          {
            name: "captures/rig-capture-raw.csv",
            size_bytes: 300_000_000,
            reason: "job_cap",
            detail: "the job's 256 MiB upload cap was reached",
          },
        ]),
      ).expect(201),
    );

    expect(receipt.warnings.map((warning) => [warning.code, warning.file])).toEqual([
      ["artifact_truncated", "rig-capture-estop.csv"],
      ["artifact_skipped", "captures/rig-capture-raw.csv"],
    ]);
    const capture = (await artifacts(jobId)).find((row) => row.name === "rig-capture-estop.csv");
    expect(capture).toMatchObject({ truncated: true, truncation_note: note });
    const closed = await ledger(jobId);
    expect(closed.manifest?.map((entry) => [entry.name, entry.status])).toEqual([
      ["junit-build3.xml", "stored"],
      ["rig-capture-estop.csv", "truncated"],
      ["captures/rig-capture-raw.csv", "skipped"],
    ]);
    expect(closed.warnings).toHaveLength(2);
  });

  it("warns about a quota breach and does not fail the build job", async () => {
    const context = await farm();
    const agent = await runner(context);
    // Another attempt of the run already holds the workspace's whole 10 GiB quota.
    const { rows: earlier } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.test_runs (organization_id, run_id, attempt_seq)
       values ($1, $2, 9) returning id`,
      [context.workspace.id, context.runId],
    );
    await api.sql.query(
      `insert into ouroboros.test_artifacts (organization_id, test_run_id, name, kind, size_bytes,
                                             storage_ref, checksum, retained_until)
       values ($1, $2, 'huge.bin', 'other', 10737418240, '{"driver": "local", "key": "k"}',
               'sha256:' || repeat('a', 64), now() + interval '30 days')`,
      [context.workspace.id, earlier[0].id],
    );
    const { jobId, token, path } = await dispatched(context, agent);
    const { rows: before } = await api.sql.query<{ status: string }>(
      `select status, finished_at, exit_code from ouroboros.build_jobs where id = $1`,
      [jobId],
    );

    const receipt = bodyOf<UploadReceipt>(
      await upload(path, token, uploadBody(mockupFiles())).expect(201),
    );

    expect(
      receipt.files.every((file) => file.status === "skipped" && file.reason === "quota"),
    ).toBe(true);
    expect(receipt.warnings.map((warning) => warning.code)).toEqual([
      "artifact_quota_exceeded",
      "artifact_quota_exceeded",
      "artifact_quota_exceeded",
      "artifact_quota_exceeded",
    ]);
    expect((await ledger(jobId)).warnings).toHaveLength(4);
    const { rows: after } = await api.sql.query<{ status: string }>(
      `select status, finished_at, exit_code from ouroboros.build_jobs where id = $1`,
      [jobId],
    );
    expect(after[0]).toEqual(before[0]);
    expect(after[0]).toMatchObject({ status: "queued", finished_at: null, exit_code: null });
    expect(await artifacts(jobId)).toEqual([]);
  });
});
