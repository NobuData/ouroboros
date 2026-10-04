import { recordingDatabase } from "../db/database.fixture";
import { enqueueRunEvent, runEventData, type RunEventRow } from "./webhook.run-events";

/** The run plane's events (#487): written on the caller's executor, carrying the run's facts. */

const RUN: RunEventRow = {
  id: "run-1",
  organization_id: "org-acme",
  loop_seq: 482,
  github_repo_id: "repo-1",
  issue_number: 412,
  status: "merged",
  pr_number: 514,
  started_at: new Date("2026-10-04T11:00:00.000Z"),
  finished_at: new Date("2026-10-04T12:00:00.000Z"),
};

describe("a run event", () => {
  it("carries the run's facts and nothing else", () => {
    expect(runEventData(RUN)).toEqual({
      runId: "run-1",
      loopSeq: 482,
      repositoryId: "repo-1",
      issueNumber: 412,
      status: "merged",
      prNumber: 514,
      startedAt: "2026-10-04T11:00:00.000Z",
      finishedAt: "2026-10-04T12:00:00.000Z",
    });
  });

  it("publishes a merge as run.merged and pr.merged, in one insert on the caller's executor", async () => {
    const database = recordingDatabase();

    await enqueueRunEvent(database.service.db, "merged", RUN);

    expect(database.statements).toHaveLength(1);
    expect(database.statements[0].sql).toContain('insert into "ouroboros"."webhook_outbox"');
    expect(database.statements[0].parameters).toEqual(
      expect.arrayContaining(["org-acme", "run.merged", "pr.merged", RUN.finished_at]),
    );
  });

  it("publishes an open as run.opened at the run's start", async () => {
    const database = recordingDatabase();

    await enqueueRunEvent(database.service.db, "opened", { ...RUN, finished_at: null });

    expect(database.statements[0].parameters).toEqual(
      expect.arrayContaining(["run.opened", RUN.started_at]),
    );
    expect(database.statements[0].parameters).not.toContain("pr.merged");
  });
});
