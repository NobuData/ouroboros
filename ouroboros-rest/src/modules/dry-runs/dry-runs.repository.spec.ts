import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import {
  DryRunsRepository,
  GUARD_TRACE_WINDOW,
  MAX_PICKER_CANDIDATES,
  isDryRunSource,
} from "./dry-runs.repository";
import {
  PINNED_SHA,
  SESSION_ID,
  TICKET_ID,
  WORKFLOW_ID,
  WORKSPACE,
  guardTrace,
  harnessStage,
} from "./dry-runs.store.fixture";

const DRY_RUN = "5eed008b-0000-4000-8000-000000000001";
const RUN = { id: DRY_RUN, organization_id: WORKSPACE };

describe("the dry-runs repository", () => {
  let database: RecordingDatabase;
  let dryRuns: DryRunsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    dryRuns = new DryRunsRepository(database.service);
  });

  function only() {
    expect(database.statements).toHaveLength(1);
    return database.statements[0];
  }

  it("knows which trackers a trigger can name", () => {
    expect(["github", "gitlab", "jira", "linear"].every(isDryRunSource)).toBe(true);
    expect(isDryRunSource("custom")).toBe(false);
  });

  it("reads a workflow by workspace and id, and its draft as the version-less row", async () => {
    await dryRuns.workflow(WORKSPACE, WORKFLOW_ID);
    expect(only().sql).toContain('from "ouroboros"."workflows"');
    expect(only().parameters).toEqual([WORKSPACE, WORKFLOW_ID]);

    database.statements.length = 0;
    database.answers({ rows: [{ definition: { dsl_version: "1.0" } }] });
    expect(await dryRuns.draftDefinition(WORKFLOW_ID)).toEqual({ dsl_version: "1.0" });
    expect(only().sql).toContain('"version" is null');

    expect(await dryRuns.draftDefinition(WORKFLOW_ID)).toBeUndefined();
  });

  it("reads one ticket in its workspace, with its effort and the repository it names", async () => {
    database.answers({ rows: [{ id: TICKET_ID, external_key: "#489" }] });

    const ticket = await dryRuns.ticket(WORKSPACE, TICKET_ID);

    expect(ticket).toEqual({ id: TICKET_ID, external_key: "#489" });
    const statement = only();
    expect(statement.sql).toContain("t.organization_id = $1");
    expect(statement.sql).toContain("t.id = $2::uuid");
    // The ticket's own estimate first, then the mirrored issue's.
    expect(statement.sql).toContain("coalesce(own.effort, mirrored.effort) as effort");
    expect(statement.sql).toContain("e.ticket_id = t.id");
    expect(statement.sql).toContain("issue.number::text = t.external_id");
    expect(statement.sql).toContain("lower(gh.login) = lower(t.meta #>> '{github,owner}')");
    expect(statement.parameters).toEqual([WORKSPACE, TICKET_ID, 1]);

    database.statements.length = 0;
    expect(await dryRuns.ticket(WORKSPACE, TICKET_ID)).toBeUndefined();
  });

  it("reads the picker's candidates: open, sized, from a tracker a trigger can name, bounded", async () => {
    await dryRuns.candidates(WORKSPACE, 10_000);

    const statement = only();
    expect(statement.sql).toContain("t.state = 'open' and t.sizing_status = 'sized'");
    expect(statement.sql).toContain("src.kind in ($2, $3, $4, $5)");
    expect(statement.sql).toContain("order by t.source_updated_at desc, t.external_key");
    expect(statement.parameters).toEqual([
      WORKSPACE,
      "github",
      "gitlab",
      "jira",
      "linear",
      MAX_PICKER_CANDIDATES,
    ]);
  });

  it("reads the workspace's cap through the effective view", async () => {
    database.answers({ rows: [{ dry_run_cap_cents: 2500 }] });

    expect(await dryRuns.workspaceCapCents(WORKSPACE)).toBe(2500);
    expect(only().sql).toContain('from "ouroboros"."workspace_settings_effective"');
  });

  it("reads the spend guard's traces from the copilot's replies, newest first, never a discarded session's", async () => {
    database.answers({ rows: [{ tool_trace: guardTrace(500) }] });

    expect(await dryRuns.guardTraces(WORKSPACE, WORKFLOW_ID)).toEqual([guardTrace(500)]);
    const statement = only();
    expect(statement.sql).toContain('"s"."status" <> $3');
    expect(statement.sql).toContain('"m"."role" = $4');
    expect(statement.sql).toContain('order by "m"."created_at" desc, "m"."seq" desc');
    expect(statement.parameters).toEqual([
      WORKSPACE,
      WORKFLOW_ID,
      "discarded",
      "copilot",
      GUARD_TRACE_WINDOW,
    ]);
  });

  it("checks a session is a conversation about this workflow, in this workspace", async () => {
    expect(await dryRuns.sessionIsAbout(WORKSPACE, WORKFLOW_ID, SESSION_ID)).toBe(false);
    expect(only().parameters).toEqual([WORKSPACE, WORKFLOW_ID, SESSION_ID]);

    database.answers({ rows: [{ id: SESSION_ID }] });
    expect(await dryRuns.sessionIsAbout(WORKSPACE, WORKFLOW_ID, SESSION_ID)).toBe(true);
  });

  it("records a dry run with what it tests, leaving the status to the database", async () => {
    database.answers({ rows: [{ id: DRY_RUN, status: "precheck" }] });

    await dryRuns.insert({
      organizationId: WORKSPACE,
      workflowId: WORKFLOW_ID,
      baseVersion: null,
      draftRev: 3,
      sessionId: SESSION_ID,
      ticketId: TICKET_ID,
      pinnedSha: PINNED_SHA,
    });

    const statement = only();
    expect(statement.sql).toContain('insert into "ouroboros"."dry_runs"');
    expect(statement.sql).not.toContain('"status"');
    expect(statement.parameters).toEqual([
      WORKSPACE,
      WORKFLOW_ID,
      null,
      3,
      SESSION_ID,
      TICKET_ID,
      PINNED_SHA,
    ]);
  });

  it("opens a run with a green pre-check, and ends one with its findings", async () => {
    database.answers({ rows: [{ id: DRY_RUN }] }, { rows: [{ id: DRY_RUN }] });

    await dryRuns.markRunning(DRY_RUN);
    await dryRuns.failPrecheck(DRY_RUN, [{ code: "graph.unreachable", node: "build" }], "why");

    const [running, failed] = database.statements;
    expect(running?.parameters).toEqual(["running", "[]", DRY_RUN]);
    expect(failed?.sql).toContain('"finished_at" = greatest(now(), started_at)');
    expect(failed?.parameters).toEqual([
      "failed",
      '[{"code":"graph.unreachable","node":"build"}]',
      "why",
      DRY_RUN,
    ]);
  });

  it("records a stage row once, leaving a repeat of the same position alone", async () => {
    await dryRuns.insertStage(RUN, harnessStage(2, "implement", { metrics: { tokens: 84000 } }));
    await dryRuns.insertStage(
      RUN,
      harnessStage(3, "open-pr", { verdict: "not_reached", startedAt: null, finishedAt: null }),
    );

    const [first, second] = database.statements;
    expect(first?.sql).toContain('on conflict ("dry_run_id", "seq") do nothing');
    expect(first?.parameters).toEqual([
      WORKSPACE,
      DRY_RUN,
      2,
      "implement",
      "implement",
      "ok",
      "llm",
      "implement done",
      '{"tokens":84000}',
      null,
      new Date("2026-10-06T15:05:00.000Z"),
      new Date("2026-10-06T15:05:30.000Z"),
    ]);
    expect(second?.parameters.slice(-2)).toEqual([null, null]);
  });

  it("records artifacts with a path summary on the diff only, and nothing for none", async () => {
    await dryRuns.insertArtifacts(RUN, []);
    expect(database.statements).toHaveLength(0);

    await dryRuns.insertArtifacts(RUN, [
      {
        kind: "overlay_diff",
        content: "@@",
        truncated: false,
        originalBytes: 2,
        pathSummary: [{ path: "a.c", added: 1, removed: 0 }],
      },
      {
        kind: "plan_excerpt",
        content: "3 steps",
        truncated: true,
        originalBytes: 90000,
        pathSummary: [],
      },
    ]);

    expect(only().parameters).toEqual([
      WORKSPACE,
      DRY_RUN,
      "overlay_diff",
      "@@",
      false,
      2,
      '[{"path":"a.c","added":1,"removed":0}]',
      WORKSPACE,
      DRY_RUN,
      "plan_excerpt",
      "3 steps",
      true,
      90000,
      null,
    ]);
  });

  it("ends only a run that is still running, with the harness's wall time when it gave one", async () => {
    database.answers({ rows: [{ id: DRY_RUN, status: "complete" }] });

    const ended = await dryRuns.finish(DRY_RUN, {
      status: "complete",
      failureReason: null,
      durationMs: 161000,
      costCents: 31,
      tokens: 96000,
      guardAudit: [{ guard: "allow_list", call: "git_push", count: 1 }],
    });

    expect(ended).toEqual({ id: DRY_RUN, status: "complete" });
    const statement = only();
    expect(statement.sql).toContain('where "id" = $7 and "status" = $8');
    expect(statement.parameters).toEqual([
      "complete",
      null,
      31,
      96000,
      '[{"guard":"allow_list","call":"git_push","count":1}]',
      161000,
      DRY_RUN,
      "running",
    ]);
  });

  it("measures the wall time itself when the harness never said, and answers a run already ended as it stands", async () => {
    database.answers({ rows: [] }, { rows: [{ id: DRY_RUN, status: "cancelled" }] });

    const ended = await dryRuns.finish(DRY_RUN, {
      status: "failed",
      failureReason: "late",
      durationMs: null,
      costCents: null,
      tokens: null,
      guardAudit: [],
    });

    expect(ended).toEqual({ id: DRY_RUN, status: "cancelled" });
    expect(database.statements[0]?.sql).toContain("extract(epoch from now() - started_at)");
    expect(database.statements[1]?.sql).toContain('select * from "ouroboros"."dry_runs"');
  });

  it("finds a dry run only under its workspace and workflow, and the open one by status", async () => {
    await dryRuns.find(WORKSPACE, WORKFLOW_ID, DRY_RUN);
    await dryRuns.open(WORKFLOW_ID);

    const [found, open] = database.statements;
    expect(found?.parameters).toEqual([WORKSPACE, WORKFLOW_ID, DRY_RUN]);
    expect(open?.sql).toContain('"status" not in ($2, $3, $4, $5)');
    expect(open?.parameters).toEqual([
      WORKFLOW_ID,
      "complete",
      "failed",
      "budget_stopped",
      "cancelled",
    ]);
  });

  it("reads rows in card order, artifacts diff first, and history newest first with the ticket's key", async () => {
    await dryRuns.stages(DRY_RUN);
    await dryRuns.artifacts(DRY_RUN);
    await dryRuns.history(WORKSPACE, WORKFLOW_ID, 50);

    const [stages, artifacts, history] = database.statements;
    expect(stages?.sql).toContain('order by "seq" asc');
    expect(artifacts?.sql).toContain('order by "kind" asc, "created_at" asc');
    expect(history?.sql).toContain('"t"."external_key" as "ticket_key"');
    expect(history?.sql).toContain('order by "r"."started_at" desc');
    expect(history?.parameters).toEqual([WORKSPACE, WORKFLOW_ID, 50]);
  });

  it("sums the dry-run accounting from dry_runs alone, keeping unpriced apart from free", async () => {
    database.answers({ rows: [{ runs: "3", cost_cents: "62", unpriced: "1" }] });

    expect(await dryRuns.spend(WORKSPACE, WORKFLOW_ID)).toEqual({
      runs: 3,
      cost_cents: 62,
      unpriced: 1,
    });
    const statement = only();
    expect(statement.sql).toContain('from "ouroboros"."dry_runs"');
    expect(statement.sql).not.toMatch(/"runs"\.|token_usage|run_stages/);

    database.answers({ rows: [{ runs: "0", cost_cents: null, unpriced: "0" }] });
    expect(await dryRuns.spend(WORKSPACE, WORKFLOW_ID)).toEqual({
      runs: 0,
      cost_cents: null,
      unpriced: 0,
    });
  });
});
