import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { AdmissionRepository } from "./admission.repository";

const WORKSPACE = "acme-robotics-id";
const NOW = new Date("2026-10-15T14:25:00.000Z");
const ITEM = "a1312000-0000-4000-8000-000000000001";

describe("the admission repository", () => {
  let database: RecordingDatabase;
  let admission: AdmissionRepository;

  beforeEach(() => {
    database = recordingDatabase();
    admission = new AdmissionRepository(database.service);
  });

  /** The SQL of the one statement issued. */
  function only(): string {
    expect(database.statements).toHaveLength(1);

    return database.statements[0].sql;
  }

  it("serializes a workspace's claims with a transaction-scoped advisory lock", async () => {
    await admission.lockClaims(database.service.db as never, WORKSPACE);

    expect(only()).toContain("pg_advisory_xact_lock(hashtext($1))");
    expect(database.statements[0].parameters).toEqual([`live-claim:${WORKSPACE}`]);
  });

  it("reads the workspace's ceiling through the effective view, 1 when it has no row", async () => {
    database.answers({ rows: [{ live_run_ceiling: 3 }] });

    await expect(admission.ceiling(database.service.db, WORKSPACE)).resolves.toBe(3);
    expect(only()).toContain('from "ouroboros"."workspace_settings_effective"');
    expect(database.statements[0].parameters).toEqual([WORKSPACE]);

    await expect(admission.ceiling(database.service.db, WORKSPACE)).resolves.toBe(1);
  });

  it("upserts the ceiling on the workspace, naming who changed it", async () => {
    await admission.saveCeiling(WORKSPACE, 2, "user-1");

    const sql = only();
    expect(sql).toContain('insert into "ouroboros"."workspace_settings"');
    expect(sql).toContain('on conflict ("organization_id") do update set');
    expect(database.statements[0].parameters).toEqual(
      expect.arrayContaining([WORKSPACE, 2, "user-1"]),
    );
  });

  it("counts live runs in flight and unexpired leases, both in this workspace", async () => {
    database.answers({ rows: [{ n: "2" }] }, { rows: [{ n: "1" }] });

    await expect(admission.liveSlotsTaken(database.service.db, WORKSPACE, NOW)).resolves.toBe(3);

    const [runs, leases] = database.statements;
    expect(runs.sql).toContain('from "ouroboros"."runs"');
    expect(runs.sql).toContain('"origin" = $');
    expect(runs.sql).toContain('"finished_at" is null');
    expect(runs.sql).toContain('"status" in (');
    expect(runs.parameters).toEqual([WORKSPACE, "live", "coding", "building", "review"]);
    expect(leases.sql).toContain('from "ouroboros"."queue_items"');
    expect(leases.sql).toContain('"claim_expires_at" > $2');
    expect(leases.parameters).toEqual([WORKSPACE, NOW]);
  });

  it("answers repository enablement only for this workspace's repositories", async () => {
    database.answers({ rows: [{ id: "repo-1", enabled: false }] });

    const enabled = await admission.repositoriesEnabled(database.service.db, WORKSPACE, ["repo-1"]);

    expect(enabled.get("repo-1")).toBe(false);
    expect(only()).toContain('"github_orgs"."organization_id" = $1');
    expect(database.statements[0].parameters).toEqual([WORKSPACE, "repo-1"]);
  });

  it("asks nothing for no repositories", async () => {
    await expect(
      admission.repositoriesEnabled(database.service.db, WORKSPACE, []),
    ).resolves.toEqual(new Map());
    expect(database.statements).toHaveLength(0);
  });

  it("reads a pinned definition by slug and version, within the workspace", async () => {
    await admission.pinnedDefinition(database.service.db, WORKSPACE, "standard-fix", 3);

    expect(only()).toContain('"workflows"."organization_id" = $1');
    expect(database.statements[0].parameters).toEqual([WORKSPACE, "standard-fix", 3]);
  });

  it("locks the unheld candidates in queue order, skipping rows another worker holds", async () => {
    await admission.claimableCandidates(database.service.db as never, WORKSPACE, NOW, 50);

    const sql = only();
    expect(sql).toContain('from "ouroboros"."queue_items"');
    expect(sql).toContain('"claim_expires_at" is null or "claim_expires_at" <= $');
    expect(sql).toContain('order by "position"');
    expect(sql).toContain("for update skip locked");
    expect(database.statements[0].parameters).toEqual([WORKSPACE, NOW, 50]);
  });

  describe("confirming", () => {
    it("stamps only an unconfirmed item of this workspace, and says it did", async () => {
      database.answers({ rows: [{ id: ITEM }] });

      await expect(admission.confirm(WORKSPACE, ITEM, "user-1", NOW)).resolves.toEqual({
        item: { id: ITEM },
        changed: true,
      });

      const sql = only();
      expect(sql).toContain('update "ouroboros"."queue_items"');
      expect(sql).toContain('"confirmed_at" is null');
      expect(database.statements[0].parameters).toEqual([NOW, "user-1", WORKSPACE, ITEM]);
    });

    it("answers an item already confirmed as unchanged", async () => {
      database.answers({ rows: [] }, { rows: [{ id: ITEM }] });

      await expect(admission.confirm(WORKSPACE, ITEM, "user-1", NOW)).resolves.toEqual({
        item: { id: ITEM },
        changed: false,
      });
      expect(database.statements[1].parameters).toEqual([WORKSPACE, ITEM]);
    });

    it("answers undefined for no such item in this workspace", async () => {
      await expect(admission.confirm(WORKSPACE, ITEM, "user-1", NOW)).resolves.toBeUndefined();
    });
  });
});
