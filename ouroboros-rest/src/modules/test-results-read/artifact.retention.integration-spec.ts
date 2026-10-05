import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { workspaceWithRepo, type SeededWorkspace } from "../../testing/dashboard.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { ArtifactNotFoundError, type ArtifactStore } from "../farm/artifacts/artifact.store";
import { ARTIFACT_STORE } from "../farm/artifacts/artifact.store.factory";
import { startMinio, type StartedMinio } from "../farm/artifacts/minio.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { ArtifactRetentionSweeper } from "./artifact.retention";
import type { TestRunPageResource } from "./results.resources";

/**
 * The retention sweep against a migrated database and a real store (AT.5's sweep, certified by
 * AT.6, [#334](https://github.com/NobuData/ouroboros/issues/334)):
 *
 *   * the bytes are gone from the store, and the row stays as a tombstone the page renders;
 *   * each workspace's tier is honoured — the sweep compares `created_at` with the workspace's
 *     `artifacts` cutoff from the retention policy service (#482), so a seven-day workspace's file
 *     goes while a thirty-day workspace's file of the same age stays;
 *   * a row stored through another driver waits for that driver's process;
 *   * a second sweep finds nothing, and bytes already missing still leave a tombstone.
 *
 * **Declared twice, unchanged**: on the local volume and on a real MinIO, the only difference
 * being the `OURO_ARTIFACT_*` variables — as the upload suite is.
 *
 * ```bash
 * yarn test:integration src/modules/test-results-read
 * ```
 */

/** Milliseconds in a day. */
const DAY_MS = 86_400_000;

let minio: StartedMinio;
let volume: string;

beforeAll(async () => {
  volume = await mkdtemp(join(tmpdir(), "ouro-retention-volume-"));
  minio = await startMinio("ouroboros-retention");
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
])("the artifact retention sweep, on %s", (_where, driver, environment) => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_ARTIFACT_STORE: driver, ...environment() });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** A workspace with one attempt that ran eight days ago. */
  interface Shelf {
    readonly owner: Person;
    readonly workspace: SeededWorkspace;
    readonly testRunId: string;
  }

  /** The store the application writes through. */
  function store(): ArtifactStore {
    return api.nest.get<ArtifactStore>(ARTIFACT_STORE);
  }

  /**
   * A workspace, a run and an attempt eight days old.
   *
   * @returns The shelf.
   */
  async function shelf(): Promise<Shelf> {
    const owner = await api.signIn();
    const workspace = await workspaceWithRepo(api, owner);
    const { rows: runs } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.runs (organization_id, github_repo_id, issue_number, issue_title,
                                   workflow_tag, model, status, stage_label, stage_index,
                                   stage_total, started_at)
       values ($1, $2, 482, 'Fix flaky CAN-bus telemetry test', 'standard-fix',
               'claude-fable-5', 'building', 'Build farm', 5, 6, now() - interval '8 days')
       returning id`,
      [workspace.id, workspace.repoId],
    );
    const { rows: attempts } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.test_runs (organization_id, run_id, attempt_seq, started_at, created_at)
       values ($1, $2, 1, now() - interval '8 days', now() - interval '8 days') returning id`,
      [workspace.id, runs[0].id],
    );

    return { owner, workspace, testRunId: attempts[0].id };
  }

  /**
   * An artifact uploaded eight days ago into a workspace whose `artifacts` tier is `days`: the tier
   * stored, its bytes in the store (or not), and its row as the upload writes it.
   *
   * @param at - The shelf.
   * @param name - Its name.
   * @param days - The workspace's `artifacts` tier.
   * @param options - `through` another driver's name; `stored: false` to leave the bytes out.
   * @returns Its id and storage key.
   */
  async function artifact(
    at: Shelf,
    name: string,
    days: number,
    options: { through?: string; stored?: boolean } = {},
  ): Promise<{ id: string; key: string; bytes: Buffer }> {
    const bytes = Buffer.from(`*** Booting Zephyr OS ***\n${name}\n`);
    const key = `${at.workspace.id}/retention/${name}`;
    const uploadedAt = new Date(Date.now() - 8 * DAY_MS);

    if (options.stored !== false && options.through === undefined) {
      await store().put(key, Readable.from([bytes]), bytes.length);
    }

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.retention_policies (organization_id, data_class, days)
       values ($1, 'artifacts', $2)
       on conflict (organization_id, data_class) do update set days = excluded.days`,
      [at.workspace.id, days],
    );

    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.test_artifacts
         (organization_id, test_run_id, name, kind, size_bytes, storage_ref, checksum,
          retained_until, created_at)
       values ($1, $2, $3, 'log', $4, $5::jsonb, $6, $7, $8) returning id`,
      [
        at.workspace.id,
        at.testRunId,
        name,
        bytes.length,
        JSON.stringify({ driver: options.through ?? driver, key }),
        `sha256:${"0".repeat(64)}`,
        new Date(uploadedAt.getTime() + days * DAY_MS),
        uploadedAt,
      ],
    );

    return { id: rows[0].id, key, bytes };
  }

  /** A row's tombstone columns. */
  async function row(id: string) {
    const { rows } = await api.sql.query<{
      name: string;
      kind: string;
      size_bytes: string;
      expired_at: Date | null;
    }>(
      `select name, kind, size_bytes, expired_at from ${SCHEMA_NAME}.test_artifacts where id = $1`,
      [id],
    );

    return rows[0];
  }

  /** A GET as a shelf's owner. */
  function read(at: Shelf, path: string) {
    return api.as(at.owner)("get", path).set(TENANT_HEADER, at.workspace.slug);
  }

  it("removes the bytes, keeps a tombstone, and honours each workspace's policy", async () => {
    const weekly = await shelf();
    const monthly = await shelf();
    const gone = await artifact(weekly, "serial-console.log", 7);
    const kept = await artifact(monthly, "serial-console.log", 30);

    const report = await api.nest.get(ArtifactRetentionSweeper).sweep();

    expect(report).toEqual({ expired: 1, bytes: gone.bytes.length, failed: 0 });

    // The seven-day workspace's file: bytes gone, row kept with its name, kind and size.
    await expect(store().get(gone.key)).rejects.toBeInstanceOf(ArtifactNotFoundError);
    expect(await row(gone.id)).toEqual({
      name: "serial-console.log",
      kind: "log",
      size_bytes: String(gone.bytes.length),
      expired_at: expect.any(Date) as unknown,
    });
    const expired = await read(weekly, `/api/v1/artifacts/${gone.id}`).expect(410);
    expect(expired.body).toMatchObject({ code: "artifact_expired" });
    const page = bodyOf<TestRunPageResource>(
      await read(weekly, `/api/v1/test-runs/${weekly.testRunId}`).expect(200),
    );
    expect(page.artifacts).toEqual([
      expect.objectContaining({
        id: gone.id,
        state: "expired",
        href: null,
        sizeBytes: gone.bytes.length,
        retentionDays: 7,
      }),
    ]);

    // The thirty-day workspace's file of the same age: untouched, and still served.
    expect((await store().get(kept.key)).equals(kept.bytes)).toBe(true);
    expect((await row(kept.id)).expired_at).toBeNull();
    const served = await read(monthly, `/api/v1/artifacts/${kept.id}`).expect(200);
    expect(Buffer.from(served.text).equals(kept.bytes)).toBe(true);
  });

  it("leaves another driver's row for that driver's process", async () => {
    const at = await shelf();
    const elsewhere = await artifact(at, "rig-capture-estop.csv", 7, { through: "archive" });

    expect(await api.nest.get(ArtifactRetentionSweeper).sweep()).toEqual({
      expired: 0,
      bytes: 0,
      failed: 0,
    });
    expect((await row(elsewhere.id)).expired_at).toBeNull();
  });

  it("tombstones bytes that were already missing, and a second sweep finds nothing", async () => {
    const at = await shelf();
    const missing = await artifact(at, "junit-build1.xml", 7, { stored: false });
    const sweeper = api.nest.get(ArtifactRetentionSweeper);

    expect(await sweeper.sweep()).toMatchObject({ expired: 1, failed: 0 });
    expect((await row(missing.id)).expired_at).not.toBeNull();
    expect(await sweeper.sweep()).toEqual({ expired: 0, bytes: 0, failed: 0 });
  });
});
