/** The launcher's statements, compiled ([#388](https://github.com/NobuData/ouroboros/issues/388), BB.5). */

import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { LaunchRepository } from "./launch.repository";

const WORKSPACE = "org-1";
const REPOSITORY = "repo-1";

describe("the launch repository", () => {
  let database: RecordingDatabase;
  let launches: LaunchRepository;

  beforeEach(() => {
    database = recordingDatabase();
    launches = new LaunchRepository(database.service);
  });

  describe("mirroredPick", () => {
    it("reads the issue by number inside the workspace and the repository, with its latest estimate", async () => {
      await launches.mirroredPick(WORKSPACE, REPOSITORY, 488);

      const { sql, parameters } = database.statements[0];
      expect(sql).toContain(`"ouroboros"."github_issues"`);
      expect(sql).toContain("left join lateral");
      expect(sql).toContain("ie.github_issue_id = i.id");
      expect(sql).toContain("order by ie.version desc");
      expect(sql).toContain("i.organization_id = $1");
      expect(sql).toContain("i.github_repo_id = $2");
      expect(sql).toContain("i.number = $3");
      expect(parameters).toEqual([WORKSPACE, REPOSITORY, 488]);
    });

    it("maps the row, and an issue never estimated to a null cycle", async () => {
      database.answers({
        rows: [{ id: "issue-488", number: 488, title: "Typo sweep", cycle_min: 3, cycle_max: 6 }],
      });
      await expect(launches.mirroredPick(WORKSPACE, REPOSITORY, 488)).resolves.toEqual({
        id: "issue-488",
        number: 488,
        title: "Typo sweep",
        cycleMin: 3,
        cycleMax: 6,
      });

      database.answers({
        rows: [{ id: "issue-1", number: 1, title: "New", cycle_min: null, cycle_max: null }],
      });
      await expect(launches.mirroredPick(WORKSPACE, REPOSITORY, 1)).resolves.toMatchObject({
        cycleMin: null,
        cycleMax: null,
      });
    });

    it("answers undefined for an issue the backlog does not mirror", async () => {
      await expect(launches.mirroredPick(WORKSPACE, REPOSITORY, 999)).resolves.toBeUndefined();
    });
  });

  it("reads the queue item of an issue, scoped by workspace and repository", async () => {
    database.answers({ rows: [{ id: "queue-1" }] });

    await expect(launches.queueItem(WORKSPACE, REPOSITORY, 488)).resolves.toEqual({
      id: "queue-1",
    });

    const { sql, parameters } = database.statements[0];
    expect(sql).toContain('from "ouroboros"."queue_items"');
    expect(sql).toContain('"organization_id" = $1');
    expect(sql).toContain('"github_repo_id" = $2');
    expect(sql).toContain('"issue_number" = $3');
    expect(parameters).toEqual([WORKSPACE, REPOSITORY, 488]);
  });

  it("reads the newest run of an issue, scoped by workspace and repository", async () => {
    database.answers({ rows: [{ id: "run-1", workflowTag: "quick-fixes" }] });

    await expect(launches.latestRun(WORKSPACE, REPOSITORY, 488)).resolves.toEqual({
      id: "run-1",
      workflowTag: "quick-fixes",
    });

    const { sql, parameters } = database.statements[0];
    expect(sql).toContain('from "ouroboros"."runs"');
    expect(sql).toContain('"workflow_tag" as "workflowTag"');
    expect(sql).toContain('order by "started_at" desc');
    expect(parameters).toEqual([WORKSPACE, REPOSITORY, 488, 1]);
  });
});
