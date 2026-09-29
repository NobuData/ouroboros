import { ApiHarness } from "../../testing/harness.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { FIRST_PUSH, SECOND_PUSH } from "../ticket-sources/conformance.pr.fixture";
import {
  IN_MEMORY_DEFAULT_BRANCH,
  InMemoryPrHost,
  InMemoryPrTicketSourceProvider,
} from "../ticket-sources/providers/in-memory.pr.fixture";
import {
  IN_MEMORY_PROJECT,
  IN_MEMORY_TOKEN,
  InMemoryTracker,
} from "../ticket-sources/providers/in-memory.provider.fixture";
import { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import { insertSource } from "../ticket-sources/ticket-sync.integration.fixture";
import { TicketSourcesService } from "../ticket-sources/ticket-sources.service";
import { PrMirrorRepository } from "./pr-sync.repository";
import { PrSyncService } from "./pr-sync.service";

/**
 * The PR sync against a migrated database (AX.1, [#357](https://github.com/NobuData/ouroboros/issues/357)),
 * on the in-memory git host.
 *
 * The criterion *"revision sync writes AW.1 rows with the file snapshot the changed-files card
 * needs"* is only true if V052 accepts the rows: `pr_revision_files_valid`, the head-sha shape, the
 * frozen history, the state graph and the merged-at rule are all CHECKs and triggers no unit suite
 * crosses. So is *"a re-sync changes nothing but the sync stamp"*, which is a claim about
 * `updated_at` and V066's `synced_at` ([#370](https://github.com/NobuData/ouroboros/issues/370)) —
 * and about V066's touch trigger, which is what lets the stamp move alone.
 *
 * Every case runs on the fake, and nothing here imports Octokit — the GitHub round trip is
 * `ticket-sources/providers/github.pr.integration-spec.ts`.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

describe("the PR sync, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());

  afterEach(() => api.truncate());

  /** One PR row, as V052 holds it. */
  interface PrRow {
    id: string;
    state: string;
    title: string;
    additions: number;
    deletions: number;
    changed_files: number;
    merged_at: Date | null;
    merged_by: string | null;
    updated_at: Date;
    synced_at: Date | null;
    /** Whether the stamp is later than the PR's mirroring — compared in the database, to the microsecond. */
    synced_after_created: boolean | null;
  }

  /** One revision row. */
  interface RevisionRow {
    revision_seq: number;
    head_sha: string;
    files: { path: string; additions: number; deletions: number }[];
    diff_excerpt: string | null;
  }

  /**
   * A workspace with a custom (git host) source, a host with one open PR, and a sync service over
   * the real repository and the real credential opener.
   *
   * @returns Everything a case needs.
   */
  async function sandbox() {
    const { organizationId, sourceId } = await insertSource(api, {
      kind: "custom",
      config: { project: IN_MEMORY_PROJECT },
      credential: IN_MEMORY_TOKEN,
    });
    const host = new InMemoryPrHost();

    host.push("loop/482-canbus-flake", FIRST_PUSH);

    const prNumber = host.open(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, {
      branch: "loop/482-canbus-flake",
      base: IN_MEMORY_DEFAULT_BRANCH,
      title: "can: fix flaky telemetry frame order under ISR load",
      body: null,
    }).number;
    const service = new PrSyncService(
      api.nest.get(PrMirrorRepository),
      new TicketSourceRegistry([new InMemoryPrTicketSourceProvider(new InMemoryTracker(), host)]),
      api.nest.get(TicketSourcesService),
    );

    return { organizationId, sourceId, host, prNumber, service };
  }

  /**
   * The PR row for a source.
   *
   * @param sourceId - The source.
   * @returns The row.
   */
  async function prRow(sourceId: string): Promise<PrRow> {
    const { rows } = await api.sql.query<PrRow>(
      `select id, state, title, additions, deletions, changed_files, merged_at, merged_by, updated_at,
              synced_at, synced_at > created_at as synced_after_created
         from ${SCHEMA_NAME}.pull_requests where source_id = $1`,
      [sourceId],
    );

    expect(rows).toHaveLength(1);

    return rows[0];
  }

  /**
   * A PR's revisions, in order.
   *
   * @param prId - The PR.
   * @returns The rows.
   */
  async function revisions(prId: string): Promise<RevisionRow[]> {
    const { rows } = await api.sql.query<RevisionRow>(
      `select revision_seq, head_sha, files, diff_excerpt
         from ${SCHEMA_NAME}.pr_revisions where pr_id = $1 order by revision_seq`,
      [prId],
    );

    return rows;
  }

  it("writes revision 1, then revision 2 after a second push, with the file snapshot V052 accepts", async () => {
    const { organizationId, sourceId, host, prNumber, service } = await sandbox();
    const first = await service.sync(organizationId, sourceId, prNumber);

    host.push("loop/482-canbus-flake", SECOND_PUSH);

    const second = await service.sync(organizationId, sourceId, prNumber);
    const pr = await prRow(sourceId);
    const rows = await revisions(pr.id);

    expect(first).toMatchObject({
      revisionSeq: 1,
      newRevision: true,
      created: true,
      state: "open",
    });
    expect(second).toMatchObject({ revisionSeq: 2, newRevision: true, created: false });
    expect(pr).toMatchObject({ state: "open", additions: 68, deletions: 15, changed_files: 3 });
    expect(rows.map((row) => row.revision_seq)).toEqual([1, 2]);
    expect(rows[1].files).toHaveLength(3);
    expect(rows[1].files).toContainEqual({
      path: "src/can/telemetry.c",
      additions: 53,
      deletions: 13,
    });
    expect(rows[0].head_sha).not.toBe(rows[1].head_sha);
  });

  it("changes nothing but the sync stamp on a re-sync with nothing new", async () => {
    const { organizationId, sourceId, prNumber, service } = await sandbox();

    await service.sync(organizationId, sourceId, prNumber);

    const before = await prRow(sourceId);
    const again = await service.sync(organizationId, sourceId, prNumber);
    const after = await prRow(sourceId);

    expect(again).toMatchObject({ revisionSeq: 1, newRevision: false });
    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());
    expect(await revisions(after.id)).toHaveLength(1);

    // The first sync mirrored the PR and stamped it in one transaction, so the two instants are
    // the same; the second asked again, found nothing, and moved the stamp alone.
    expect(before.synced_at).toBeInstanceOf(Date);
    expect(before.synced_after_created).toBe(false);
    expect(after.synced_after_created).toBe(true);
    expect(after).toMatchObject({
      title: before.title,
      state: before.state,
      additions: before.additions,
      deletions: before.deletions,
      changed_files: before.changed_files,
    });
  });

  it("stamps a sync that changed the PR, and moves updated_at with it", async () => {
    const { organizationId, sourceId, host, prNumber, service } = await sandbox();

    await service.sync(organizationId, sourceId, prNumber);

    const before = await prRow(sourceId);

    host.push("loop/482-canbus-flake", SECOND_PUSH);
    await service.sync(organizationId, sourceId, prNumber);

    const after = await prRow(sourceId);

    expect(after.synced_after_created).toBe(true);
    expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());
    expect(after.updated_at.getTime()).toBe(after.synced_at?.getTime());
  });

  it("keeps the verification plane's refinement, and lands the host's merge with who and when", async () => {
    const { organizationId, sourceId, host, prNumber, service } = await sandbox();

    await service.sync(organizationId, sourceId, prNumber);
    await api.sql.query(
      `update ${SCHEMA_NAME}.pull_requests set state = 'verifying' where source_id = $1`,
      [sourceId],
    );
    await service.sync(organizationId, sourceId, prNumber);

    expect((await prRow(sourceId)).state).toBe("verifying");

    host.merge(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, prNumber, "squash", "fix(can): order frames");

    const merged = await service.sync(organizationId, sourceId, prNumber);
    const row = await prRow(sourceId);

    expect(merged.state).toBe("merged");
    expect(row).toMatchObject({ state: "merged", merged_by: "ouroboros-bot" });
    expect(row.merged_at).toBeInstanceOf(Date);
  });

  it("writes the host's content back over a local edit — the host owns it (AX.6)", async () => {
    const { organizationId, sourceId, prNumber, service } = await sandbox();

    await service.sync(organizationId, sourceId, prNumber);

    const mirrored = await prRow(sourceId);

    await api.sql.query(
      `update ${SCHEMA_NAME}.pull_requests set title = 'edited here', additions = 0
        where source_id = $1`,
      [sourceId],
    );
    await service.sync(organizationId, sourceId, prNumber);

    expect(await prRow(sourceId)).toMatchObject({
      title: mirrored.title,
      additions: mirrored.additions,
      deletions: mirrored.deletions,
    });
  });

  it("mirrors a PR once: concurrent syncs leave one row and one revision, and V052 refuses a second mirror (AX.6)", async () => {
    const { organizationId, sourceId, prNumber, service } = await sandbox();
    const outcomes = await Promise.allSettled([
      service.sync(organizationId, sourceId, prNumber),
      service.sync(organizationId, sourceId, prNumber),
    ]);
    const pr = await prRow(sourceId);

    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    expect(await revisions(pr.id)).toHaveLength(1);
    await expect(
      api.sql.query(
        `insert into ${SCHEMA_NAME}.pull_requests
                (organization_id, source_id, external_number, external_url, title, head_branch,
                 base_branch, state)
         values ($1, $2, $3, 'https://example.test/pull/1', 'a second mirror', 'b', 'main', 'open')`,
        [organizationId, sourceId, prNumber],
      ),
    ).rejects.toMatchObject({ constraint: "pull_requests_source_number_key" });
  });

  it("walks a PR reopened and merged between syncs through V052's graph", async () => {
    const { organizationId, sourceId, host, prNumber, service } = await sandbox();

    await service.sync(organizationId, sourceId, prNumber);
    await api.sql.query(
      `update ${SCHEMA_NAME}.pull_requests set state = 'closed' where source_id = $1`,
      [sourceId],
    );
    host.merge(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, prNumber, "merge", "fix: x");

    await expect(service.sync(organizationId, sourceId, prNumber)).resolves.toMatchObject({
      state: "merged",
    });
  });

  it("writes nothing when the host refuses", async () => {
    const { organizationId, sourceId, host, prNumber, service } = await sandbox();

    host.refuse("upstream");

    await expect(service.sync(organizationId, sourceId, prNumber)).rejects.toMatchObject({
      errorClass: "upstream",
    });

    const { rows } = await api.sql.query(
      `select 1 from ${SCHEMA_NAME}.pull_requests where source_id = $1`,
      [sourceId],
    );

    expect(rows).toEqual([]);
  });

  it("refuses another workspace's source", async () => {
    const { sourceId, prNumber, service } = await sandbox();
    const other = await insertSource(api, {
      kind: "custom",
      config: { project: IN_MEMORY_PROJECT },
    });

    await expect(service.sync(other.organizationId, sourceId, prNumber)).rejects.toMatchObject({
      code: "pr_source_not_found",
    });
  });
});
