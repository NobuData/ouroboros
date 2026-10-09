import { recordingDatabase, type RecordingDatabase } from "../../db/database.fixture";
import { CompetitorsRepository } from "./competitors.repository";

/**
 * The registry's statements, against a real Kysely over a recording driver — the SQL asserted is
 * the SQL PostgreSQL would receive.
 */

const ORG = "org-acme";
const RIVAL = "5eed0094-0000-4000-8000-000000000001";
const WATCH = "5eed0094-0000-4000-8000-000000000011";
const AT = new Date("2026-09-01T06:00:00Z");

const watchRow = {
  id: WATCH,
  competitor_id: RIVAL,
  source_kind: "release_notes",
  url: "https://skylink.example.com/releases",
  selector: "main .release-list",
  cadence: "daily",
  enabled: true,
  render_required: false,
  last_snapshot_at: null,
  next_check_at: null,
  last_checked_at: null,
  last_success_at: null,
  last_outcome: null,
  last_note: null,
  created_at: AT,
};

describe("the competitor repository", () => {
  let database: RecordingDatabase;
  let repository: CompetitorsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new CompetitorsRepository(database.service);
  });

  it("scopes a watch to the workspace through its rival", async () => {
    database.answers({ rows: [watchRow] });

    const found = await repository.findWatch(ORG, RIVAL, WATCH);

    expect(found).toMatchObject({
      id: WATCH,
      sourceKind: "release_notes",
      selector: "main .release-list",
    });
    expect(database.statements[0].sql).toContain('inner join "ouroboros"."competitors" as "c"');
    expect(database.statements[0].sql).toContain('"c"."organization_id" = $1');
    expect(database.statements[0].parameters).toEqual([ORG, RIVAL, WATCH]);
  });

  it("claims due watches in one statement: skip locked, never-checked first, bounded, leased", async () => {
    database.answers({ rows: [{ ...watchRow, organization_id: ORG, competitor_name: "Skylink" }] });
    const lease = new Date(AT.getTime() + 900_000);

    const claimed = await repository.claimDue(AT, 10, lease);

    expect(claimed).toEqual([
      expect.objectContaining({ id: WATCH, organizationId: ORG, competitorName: "Skylink" }),
    ]);
    const [{ sql, parameters }] = database.statements;
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("order by w.next_check_at nulls first");
    expect(sql).toContain("where w.enabled and not w.render_required");
    expect(sql).toContain("set next_check_at = $3");
    expect(parameters).toEqual([AT, 10, lease]);
  });

  it("writes a snapshot and its archive in one transaction", async () => {
    await repository.insertSnapshot({
      id: "5a000000-0000-4000-8000-000000000001",
      watchId: WATCH,
      previousId: null,
      contentHash: `sha256:${"a".repeat(64)}`,
      contentRef: "archive://competitor-snapshot/5a000000-0000-4000-8000-000000000001",
      diff: null,
      takenAt: AT,
      content: "6.1 — Beacon",
    });

    const sql = database.sql();
    expect(sql[0]).toBe("begin");
    expect(sql[1]).toContain('insert into "ouroboros"."competitor_snapshots"');
    expect(sql[2]).toContain('insert into "ouroboros"."competitor_snapshot_contents"');
    expect(sql[3]).toBe("commit");
  });

  it("records a check — moving last_success_at only for a read, and marking render_required", async () => {
    await repository.recordCheck(WATCH, {
      checkedAt: AT,
      outcome: "render_required",
      note: "needs the render tier",
      succeeded: false,
      nextCheckAt: AT,
      renderRequired: true,
    });
    await repository.recordCheck(WATCH, {
      checkedAt: AT,
      outcome: "unchanged",
      note: null,
      succeeded: true,
      nextCheckAt: AT,
      renderRequired: false,
    });

    expect(database.statements[0].sql).toContain('"render_required" = $');
    expect(database.statements[0].sql).not.toContain("last_success_at");
    expect(database.statements[1].sql).toContain('"last_success_at" = $');
    expect(database.statements[1].sql).not.toContain("render_required");
  });

  it("makes a watch due again when an administrator clears render_required", async () => {
    database.answers({ rows: [watchRow] });

    await repository.updateWatch(WATCH, { renderRequired: false });

    expect(database.statements[0].sql).toContain('"render_required" = $1, "next_check_at" = $2');
    expect(database.statements[0].parameters.slice(0, 2)).toEqual([false, null]);
  });

  it("reads changes — diffs only, in the workspace, newest first, narrowed and bounded", async () => {
    database.answers({
      rows: [
        {
          snapshot_id: "s2",
          previous_id: "s1",
          watch_id: WATCH,
          competitor_id: RIVAL,
          competitor_name: "Skylink",
          source_kind: "release_notes",
          url: watchRow.url,
          selector: watchRow.selector,
          content_hash: `sha256:${"b".repeat(64)}`,
          diff: "+ 6.2",
          taken_at: AT,
        },
      ],
    });

    const rows = await repository.changes(ORG, {
      competitorId: RIVAL,
      sourceKind: "release_notes",
      since: new Date("2026-06-01T00:00:00Z"),
      limit: 25,
    });

    expect(rows[0]).toMatchObject({ snapshotId: "s2", diff: "+ 6.2", competitorName: "Skylink" });
    const [{ sql, parameters }] = database.statements;
    expect(sql).toContain('"s"."diff" is not null');
    expect(sql).toContain('order by "s"."taken_at" desc');
    expect(parameters).toEqual([ORG, RIVAL, "release_notes", new Date("2026-06-01T00:00:00Z"), 25]);
  });

  it("reads the sub-line from the summary view, and zeros when nothing is watched", async () => {
    database.answers(
      {
        rows: [
          {
            rivals_watched: 4,
            watches_enabled: 5,
            source_kinds: ["release_notes", "changelog", "filings"],
            sub_line: "4 rivals watched · release notes, changelogs, filings",
          },
        ],
      },
      { rows: [] },
    );

    expect(await repository.summary(ORG)).toEqual({
      rivalsWatched: 4,
      watchesEnabled: 5,
      sourceKinds: ["release_notes", "changelog", "filings"],
      subLine: "4 rivals watched · release notes, changelogs, filings",
    });
    expect(await repository.summary("org-empty")).toMatchObject({
      rivalsWatched: 0,
      subLine: "0 rivals watched",
    });
    expect(database.statements[0].sql).toContain("from ouroboros.competitor_tracker_summary");
  });

  it("finds a rival by name or alias, case-insensitively", async () => {
    const rival = {
      id: RIVAL,
      organization_id: ORG,
      name: "Skylink",
      meta: { aliases: ["Skylink Robotics"] },
      created_at: AT,
    };
    database.answers({ rows: [rival] }, { rows: [rival] }, { rows: [rival] });

    expect((await repository.resolveCompetitor(ORG, "SKYLINK"))?.id).toBe(RIVAL);
    expect((await repository.resolveCompetitor(ORG, "skylink robotics"))?.id).toBe(RIVAL);
    expect(await repository.resolveCompetitor(ORG, "AeroMesh")).toBeUndefined();
  });
});
