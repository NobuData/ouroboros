import { recordingDatabase, type RecordingDatabase } from "../../db/database.fixture";
import { HOVER, ORG, REPO, stats } from "./watch.fixture";
import { DEFAULT_SETTINGS, WatchRepository, baselineOf, itemOf } from "./watch.repository";

/**
 * The watch's statements, against a real Kysely over a recording driver — the SQL asserted is
 * the SQL PostgreSQL would receive. Whether the server accepts it is the integration suite's.
 */

const ITEM = "17e00000-0000-4000-8000-000000000001";
const BASELINE = "ba5e0000-0000-4000-8000-000000000001";
const AT = new Date("2026-10-10T02:00:00Z");

const baselineRecord = {
  baseline_id: BASELINE,
  organization_id: ORG,
  repo_ref: REPO,
  release_tag: "v2.0.4",
  metric_source: "case_metric" as const,
  metric_key: HOVER,
  metric_class: "accuracy" as const,
  baseline_window: stats(5),
  captured_at: AT,
  captured_via: "release" as const,
};
const itemRecord = {
  ...baselineRecord,
  id: ITEM,
  current: stats(5.7),
  drift_value: "14",
  drift_unit: "%",
  drift_display: "+14%",
  severity: "err" as const,
  status: "detected" as const,
  bisect_id: null,
  bisect_result: null,
  investigation_id: null,
  investigation_display_id: null,
  fix_ticket_ref: null,
  pr_ref: null,
  note: null,
  detected_at: AT,
  status_changed_at: AT,
};

describe("the watch repository", () => {
  let database: RecordingDatabase;
  let repository: WatchRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new WatchRepository(database.service);
  });

  const last = () => database.statements[database.statements.length - 1];

  it("reads the defaults for a workspace with no settings row", async () => {
    expect(await repository.settings(ORG)).toBe(DEFAULT_SETTINGS);
    expect(last().parameters).toEqual([ORG]);
    expect(DEFAULT_SETTINGS).toMatchObject({ autoBisect: true, autoFile: false, metrics: [] });
  });

  it("reads a stored settings row", async () => {
    database.answers({
      rows: [
        {
          thresholds: { classes: {}, metrics: {} },
          metrics: [],
          auto_bisect: false,
          auto_file: true,
          fix_source_id: "s",
          last_compared_at: AT,
        },
      ],
    });

    expect(await repository.settings(ORG)).toEqual({
      thresholds: { classes: {}, metrics: {} },
      metrics: [],
      autoBisect: false,
      autoFile: true,
      fixSourceId: "s",
      lastComparedAt: AT,
    });
  });

  it("upserts only what a save carried, and keeps the rest", async () => {
    database.answers({
      rows: [
        {
          thresholds: { classes: {}, metrics: {} },
          metrics: [],
          auto_bisect: true,
          auto_file: true,
          fix_source_id: null,
          last_compared_at: null,
        },
      ],
    });

    await repository.saveSettings(ORG, { autoFile: true }, "user-ken");

    const { sql, parameters } = last();
    expect(sql).toContain('insert into "ouroboros".regression_watch_settings');
    expect(sql).toContain("on conflict (organization_id) do update");
    expect(sql).toContain("auto_file = coalesce($");
    expect(sql).toContain("metrics = coalesce($");
    // Absent fields travel as nulls the statement coalesces away; the fix source says whether it was sent.
    expect(parameters).toContain("user-ken");
    expect(parameters.filter((value) => value === true)).toHaveLength(2);
    expect(parameters).toContain(false);
  });

  it("stamps the nightly comparison, creating the row if need be", async () => {
    await repository.markCompared(ORG, AT);

    expect(last().sql).toContain(
      "on conflict (organization_id) do update set last_compared_at = $",
    );
    expect(last().parameters).toEqual([ORG, AT, AT]);
  });

  it("finds the workspaces due a comparison, and the ones watching a repository", async () => {
    database.answers({ rows: [{ organization_id: ORG }] }, { rows: [{ organization_id: ORG }] });

    expect(await repository.workspacesDue(AT)).toEqual([ORG]);
    expect(last().sql).toContain("s.last_compared_at is null or s.last_compared_at < $1");
    expect(await repository.workspacesWatching("Acme/Helios")).toEqual([ORG]);
    expect(last().sql).toContain("lower(m ->> 'repo') = lower($1)");
  });

  it("asks the database for a metric's effective threshold", async () => {
    const rule = {
      direction: "higher_is_worse",
      warn_pct: 5,
      err_pct: 10,
      min_spread_multiple: 2,
      min_samples: 10,
    };
    database.answers({ rows: [{ rule }] });

    expect(await repository.threshold(ORG, HOVER, "accuracy")).toEqual(rule);
    expect(last().sql).toContain('"ouroboros".regression_threshold($1, $2, $3)');
    expect(last().parameters).toEqual([ORG, HOVER, "accuracy"]);
  });

  it("stores a baseline once per release and metric", async () => {
    database.answers({ rows: [baselineRecord] });
    const row = {
      organizationId: ORG,
      repo: REPO,
      releaseTag: "v2.0.4",
      metricSource: "case_metric" as const,
      metricKey: HOVER,
      metricClass: "accuracy" as const,
      window: stats(5),
      capturedVia: "release" as const,
      capturedBy: null,
    };

    expect((await repository.insertBaseline(row))?.id).toBe(BASELINE);
    expect(last().sql).toContain(
      "on conflict (organization_id, repo_ref, release_tag, metric_key) do nothing",
    );
    expect(await repository.insertBaseline(row)).toBeUndefined();
  });

  it("reads the newest baseline of each repository and metric", async () => {
    database.answers({ rows: [baselineRecord] });

    expect(await repository.latestBaselines(ORG)).toHaveLength(1);
    expect(last().sql).toContain("select distinct on (b.repo_ref, b.metric_key)");
    expect(last().sql).toContain("order by b.repo_ref, b.metric_key, b.captured_at desc, b.id");
  });

  it("reads items in their workspace, open ones first", async () => {
    database.answers(
      { rows: [itemRecord] },
      { rows: [itemRecord] },
      { rows: [] },
      { rows: [itemRecord] },
    );

    expect((await repository.items(ORG, 100))[0].id).toBe(ITEM);
    expect(last().sql).toContain(
      "order by (w.status in ('fixed_merged', 'dismissed')), w.detected_at desc",
    );
    expect((await repository.item(ORG, ITEM))?.driftValue).toBe(14);
    expect(last().sql).toContain("w.organization_id = $1 and w.id = $2::uuid");
    expect(await repository.openItem(ORG, BASELINE)).toBeUndefined();
    expect(last().sql).toContain("w.baseline_id = $2::uuid");
    expect(await repository.openItems(200)).toHaveLength(1);
    expect(last().sql).toContain("order by w.updated_at, w.id");
  });

  it("opens an item detected and reads it back", async () => {
    database.answers({ rows: [{ id: ITEM }] }, { rows: [itemRecord] });

    const opened = await repository.insertItem(ORG, BASELINE, {
      current: stats(5.7),
      driftValue: 14,
      driftUnit: "%",
      severity: "err",
    });

    expect(opened.status).toBe("detected");
    expect(database.statements[0].sql).toContain('insert into "ouroboros".regression_watch_items');
    expect(database.statements[0].sql).not.toContain("status");
  });

  it("fails loudly when an inserted item cannot be read back", async () => {
    database.answers({ rows: [{ id: ITEM }] }, { rows: [] });

    await expect(
      repository.insertItem(ORG, BASELINE, {
        current: stats(5.7),
        driftValue: 14,
        driftUnit: "%",
        severity: "err",
      }),
    ).rejects.toThrow("could not be read");
  });

  it("refreshes a reading only while the item is open", async () => {
    await repository.updateReading(ORG, ITEM, {
      current: stats(5.4),
      driftValue: 8,
      driftUnit: "%",
      severity: "warn",
    });

    expect(last().sql).toContain("and status in ($");
    expect(last().parameters).toEqual(
      expect.arrayContaining([8, "%", "warn", ORG, ITEM, "detected", "fix_running"]),
    );
  });

  it("moves an item only from the status it expects to leave", async () => {
    database.answers({ rows: [{ id: ITEM }] }, { rows: [] });

    expect(
      await repository.move(ORG, ITEM, "bisecting", {
        status: "bisected",
        bisectResult: {
          culprit_sha: "a".repeat(40),
          farm_job_ids: [],
          steps: 1,
          confidence_basis: { method: "m", inputs: {} },
        },
      }),
    ).toBe(true);
    expect(last().sql).toContain("status = $");
    expect(last().sql).toContain("bisect_result = $");
    expect(last().sql).toMatch(
      /where organization_id = \$\d+ and id = \$\d+::uuid and status = \$\d+/,
    );
    expect(last().parameters.slice(-3)).toEqual([ORG, ITEM, "bisecting"]);
    expect(await repository.move(ORG, ITEM, "detected", { note: "needs repro" })).toBe(false);
  });

  it("sets every reference a move can carry", async () => {
    database.answers({ rows: [{ id: ITEM }] });

    await repository.move(ORG, ITEM, "fix_running", {
      bisectId: "b",
      investigationId: "i",
      fixTicketRef: { kind: "ticket", id: "t", key: "#517" },
      prRef: { pull_request_id: "p", key: "#641" },
      note: null,
    });

    for (const column of ["bisect_id", "investigation_id", "fix_ticket_ref", "pr_ref", "note"]) {
      expect(last().sql).toContain(`${column} = $`);
    }
  });

  it("dismisses only an open item, recording who and why", async () => {
    database.answers({ rows: [{ id: ITEM }] }, { rows: [] });

    expect(await repository.dismiss(ORG, ITEM, "user-ken", "Sensor swap.")).toBe(true);
    expect(last().sql).toContain(
      "set status = 'dismissed', dismissed_by = $1, dismissed_at = now()",
    );
    expect(last().parameters.slice(0, 4)).toEqual(["user-ken", "Sensor swap.", ORG, ITEM]);
    expect(await repository.dismiss(ORG, ITEM, "user-ken", "again")).toBe(false);
  });

  it("opens a queued regression_forensics investigation, origin regression_watch", async () => {
    database.answers({ rows: [{ id: "inv", display_id: "RS-131" }] }, { rows: [] });

    expect(await repository.openInvestigation(ORG, "Why?", [])).toEqual({
      id: "inv",
      displayId: "RS-131",
    });
    expect(last().sql).toContain("'queued', 'regression_watch'");
    expect(last().sql).toContain("k.slug = 'regression_forensics'");
    expect(last().sql).toContain("k.playbook -> 'default_tools'");
    expect(await repository.openInvestigation(ORG, "Why?", ["code"])).toBeUndefined();
  });

  it("checks insights metrics against the catalogue, asking nothing for none", async () => {
    expect(await repository.unknownMetrics([])).toEqual([]);
    expect(database.statements).toHaveLength(0);
    database.answers({ rows: [{ metric_id: "merge_rate" }] });

    expect(await repository.unknownMetrics(["merge_rate", "nope"])).toEqual(["nope"]);
  });

  it("lists ticket sources, and reads a draft's batch and ticket", async () => {
    database.answers(
      { rows: [{ id: "s1" }] },
      {
        rows: [
          {
            id: "d",
            local_key: "FIX-1",
            batch_id: "b",
            status: "sized",
            ticket_id: null,
            external_key: null,
          },
        ],
      },
      {
        rows: [
          {
            id: "d",
            local_key: "FIX-1",
            batch_id: "b",
            status: "pushed",
            ticket_id: "t",
            external_key: "#517",
          },
        ],
      },
      { rows: [] },
    );

    expect(await repository.ticketSources(ORG)).toEqual(["s1"]);
    expect(await repository.draftState(ORG, "d")).toEqual({
      draftId: "d",
      localKey: "FIX-1",
      batchId: "b",
      batchStatus: "sized",
      ticket: null,
    });
    expect((await repository.draftState(ORG, "d"))?.ticket).toEqual({ id: "t", key: "#517" });
    expect(await repository.draftState(ORG, "d")).toBeUndefined();
  });

  it("reads a fix ticket's mirror, queue, run and merged pull request inside its workspace", async () => {
    database.answers(
      {
        rows: [
          {
            issue_id: "i",
            queued: true,
            active_run_id: "r",
            ran_before: true,
            pr_id: "p",
            pr_number: 641,
          },
        ],
      },
      { rows: [] },
    );

    expect(await repository.fixProgress(ORG, "t")).toEqual({
      issueId: "i",
      queued: true,
      activeRunId: "r",
      ranBefore: true,
      mergedPr: { id: "p", number: 641 },
    });
    const { sql } = last();
    expect(sql).toContain("p.ticket_id = ticket.id");
    expect(sql).toContain("p.state = 'merged'");
    expect(sql).toContain("r.github_repo_id = gi.github_repo_id and r.issue_number = gi.number");
    expect(sql).toContain("where t.organization_id = $");
    expect(await repository.fixProgress(ORG, "t")).toEqual({
      issueId: null,
      queued: false,
      activeRunId: null,
      ranBefore: false,
      mergedPr: null,
    });
  });
});

describe("row mapping", () => {
  it("maps a baseline and an item", () => {
    expect(baselineOf(baselineRecord)).toMatchObject({
      id: BASELINE,
      repo: REPO,
      releaseTag: "v2.0.4",
      metricKey: HOVER,
    });
    expect(itemOf(itemRecord)).toMatchObject({
      id: ITEM,
      driftValue: 14,
      driftDisplay: "+14%",
      baseline: { id: BASELINE },
    });
  });
});
