import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import type { Run } from "../db/schema";
import { REQUEUE_FALLBACK_EFFORT, RunExecutionRepository } from "./run-execution.repository";

/**
 * The statements behind #160's execution routes and the run supervisor, as the compiler produces
 * them — real Kysely over a recording driver, as `ingest.repository.spec.ts` argues. What matters
 * is invisible from a mocked method: the epoch is raised **in the database**, the base commit is
 * written only when asked, a heartbeat moves one column, and the supervisor's reads select the
 * runs and workspaces the contract names.
 */

const RUN = "5eed0009-0000-4000-8000-000000000482";
const WORKSPACE = "acme-robotics-id";
const AT = new Date("2026-10-15T14:25:00.000Z");

/** A live, coding run. */
function run(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN,
    organization_id: WORKSPACE,
    github_repo_id: "5eed0003-0000-4000-8000-000000000001",
    issue_number: 482,
    issue_title: "Fix flaky CAN-bus telemetry test",
    workflow_tag: "standard-fix",
    workflow_version_pin: 14,
    playbook_id: null,
    ...overrides,
  } as Run;
}

describe("the run-execution repository", () => {
  let database: RecordingDatabase;
  let service: RecordingDatabase["service"];
  let execution: RunExecutionRepository;

  beforeEach(() => {
    database = recordingDatabase();
    service = database.service;
    execution = new RunExecutionRepository(service);
  });

  /** The SQL of the one statement issued. */
  function only(): string {
    expect(database.statements).toHaveLength(1);

    return database.statements[0].sql;
  }

  it("starts a run by raising its epoch in the database and naming a branch only when it has none", async () => {
    database.answers({ rows: [run({ exec_epoch: 3 })] });

    const started = await execution.start(service.db, RUN, "engine-worker-a");

    expect(started.exec_epoch).toBe(3);
    expect(only()).toContain('"exec_epoch" = exec_epoch + 1');
    expect(only()).toContain('"exec_heartbeat_at" = now()');
    expect(only()).toContain(
      "\"branch_name\" = coalesce(branch_name, 'ouro/run-' || id || '-' || issue_number)",
    );
    expect(only()).toContain("returning *");
    expect(database.statements[0].parameters).toEqual(["engine-worker-a", RUN]);
  });

  it("heartbeats by moving the heartbeat alone", async () => {
    database.answers({ rows: [{ exec_heartbeat_at: AT }] });

    await expect(execution.heartbeat(service.db, RUN)).resolves.toEqual(AT);
    expect(only()).toMatch(/set "exec_heartbeat_at" = now\(\) where "id" = \$1/);
  });

  it("checkpoints the state, refreshes the heartbeat, and writes a base commit only when given one", async () => {
    database.answers(
      { rows: [{ exec_checkpoint_at: AT }] },
      { rows: [{ exec_checkpoint_at: AT }] },
    );

    await execution.checkpoint(service.db, RUN, { position: "code" }, "a".repeat(40));
    await execution.checkpoint(service.db, RUN, { position: "review" }, undefined);

    const [first, second] = database.statements;
    expect(first.sql).toContain('"exec_checkpoint_at" = now()');
    expect(first.sql).toContain('"exec_heartbeat_at" = now()');
    expect(first.sql).toContain('"exec_base_commit" = $2');
    expect(first.parameters).toEqual([{ position: "code" }, "a".repeat(40), RUN]);
    expect(second.sql).not.toContain("exec_base_commit");
  });

  it("finishes to review in flight, and to a resting status with a finish time", async () => {
    await execution.finish(service.db, RUN, "review");
    await execution.finish(service.db, RUN, "failed");

    const [review, failed] = database.statements;
    expect(review.sql).not.toContain("finished_at");
    expect(review.parameters).toEqual(["review", RUN]);
    expect(failed.sql).toContain('"finished_at" = now()');
    expect(failed.parameters).toEqual(["failed", RUN]);
  });

  it("writes the finish reason as the store's own transcript line, stage-less", async () => {
    await execution.appendFinishEvent(service.db, RUN, "attempt limit reached", {
      outcome: "failed",
      stage_key: "implement",
    });

    expect(only()).toContain('insert into "ouroboros"."run_events"');
    expect(database.statements[0].parameters).toEqual([
      RUN,
      "system",
      null,
      null,
      null,
      null,
      "attempt limit reached",
      { outcome: "failed", stage_key: "implement" },
    ]);
  });

  it("reads the run's repository inside the run's workspace, enabled or not", async () => {
    database.answers({
      rows: [{ id: "r1", login: "acme-robotics", name: "helios-firmware", defaultBranch: "main" }],
    });

    await expect(execution.repositoryOf(service.db, run())).resolves.toEqual({
      id: "r1",
      slug: "acme-robotics/helios-firmware",
      name: "helios-firmware",
      defaultBranch: "main",
    });
    expect(only()).toContain('"github_orgs"."organization_id" = $2');
    expect(only()).not.toContain("enabled");
  });

  it("answers no repository when it left the workspace", async () => {
    await expect(execution.repositoryOf(service.db, run())).resolves.toBeUndefined();
  });

  it("reads the issue body and labels from the canonical GitHub ticket, or none", async () => {
    database.answers({ rows: [{ body: "The CAN-bus test flakes.", labels: ["flaky"] }] });

    await expect(execution.ticketOf(service.db, run())).resolves.toEqual({
      body: "The CAN-bus test flakes.",
      labels: ["flaky"],
    });
    await expect(execution.ticketOf(service.db, run())).resolves.toEqual({
      body: null,
      labels: [],
    });
    expect(database.statements[0].sql).toContain('"tickets"."labels"');
    expect(database.statements[0].sql).toContain('"ticket_sources"."kind" = $');
    expect(database.statements[0].parameters).toContain("482");
  });

  it("reads the issue's latest size estimate", async () => {
    database.answers({ rows: [{ effort: "s", estMinutes: 45 }] });

    await expect(execution.latestEstimate(service.db, run())).resolves.toEqual({
      effort: "s",
      estMinutes: 45,
    });
    expect(only()).toContain('order by "ouroboros"."issue_estimates"."version" desc');
    await expect(execution.latestEstimate(service.db, run())).resolves.toBeUndefined();
  });

  describe("requeueing", () => {
    it("appends an unconfirmed item at the tail, carrying the run's pin and the latest estimate", async () => {
      database.answers(
        { rows: [{ effort: "l", estMinutes: 120 }] },
        { rows: [{ last: 7 }] },
        { rows: [{ id: "q-new" }] },
      );

      await expect(execution.requeue(service.db, run())).resolves.toEqual({ id: "q-new" });

      const insert = database.statements[2];
      expect(insert.sql).toContain('insert into "ouroboros"."queue_items"');
      expect(insert.sql).toContain('on conflict ("organization_id", "issue_number") do nothing');
      expect(insert.sql).not.toContain("confirmed");
      expect(insert.parameters).toEqual([
        WORKSPACE,
        "5eed0003-0000-4000-8000-000000000001",
        482,
        "Fix flaky CAN-bus telemetry test",
        "l",
        "standard-fix",
        14,
        "explicit",
        8,
        120,
        null,
      ]);
    });

    it("falls back to the middle effort and the head of an empty queue for an unestimated issue", async () => {
      database.answers({ rows: [] }, { rows: [{ last: null }] }, { rows: [{ id: "q-1" }] });

      await execution.requeue(service.db, run({ workflow_version_pin: null }));

      const parameters = database.statements[2].parameters;
      expect(parameters[4]).toBe(REQUEUE_FALLBACK_EFFORT);
      expect(parameters[6]).toBeNull();
      expect(parameters[7]).toBeNull();
      expect(parameters[8]).toBe(1);
      expect(parameters[9]).toBeNull();
    });

    it("answers no item when the issue is already queued", async () => {
      database.answers({ rows: [] }, { rows: [{ last: 3 }] }, { rows: [] });

      await expect(execution.requeue(service.db, run())).resolves.toEqual({ id: null });
    });
  });

  describe("the supervisor's reads", () => {
    it("selects live executing runs that went quiet after a start, or were never started", async () => {
      database.answers({ rows: [{ id: "r1" }, { id: "r2" }] });

      await expect(execution.staleRuns(AT)).resolves.toEqual(["r1", "r2"]);
      expect(only()).toContain('"origin" = $1');
      expect(only()).toContain('"status" in ($2, $3)');
      expect(only()).toContain('("exec_epoch" > $4 and "exec_heartbeat_at" < $5)');
      expect(only()).toContain('("exec_epoch" = $6 and "started_at" < $7)');
      expect(database.statements[0].parameters).toEqual([
        "live",
        "coding",
        "building",
        0,
        AT,
        0,
        AT,
      ]);
    });

    it("selects workspaces with a confirmed, unleased item that are not paused", async () => {
      database.answers({ rows: [{ organization_id: WORKSPACE }] });

      await expect(execution.claimableWorkspaces(AT)).resolves.toEqual([WORKSPACE]);
      expect(only()).toContain("select distinct");
      expect(only()).toContain('"queue_items"."confirmed_at" is not null');
      expect(only()).toContain('"queue_items"."claim_expires_at" <= $1');
      expect(only()).toContain(
        'not exists (select "ouroboros"."workspace_lifecycle"."organization_id"',
      );
      expect(only()).toContain('"workspace_lifecycle"."state" <> $2');
      expect(database.statements[0].parameters).toEqual([AT, "active"]);
    });
  });
});
