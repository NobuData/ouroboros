import { recordingDatabase, type RecordingDatabase } from "../../db/database.fixture";
import { GuardrailsRepository } from "../../guardrails/guardrails.repository";
import { MergeRepository, type MergePr } from "./merge.repository";

/**
 * What the org policy's per-PR rules read (BQ.2, #481): the PR's ticket for `auto_merge`, which of
 * its repository's loops it is for `dry_run_new_repos`, and an armer's roles. The integration suite
 * runs these statements against a migrated PostgreSQL.
 */

const ORG = "org-481";

const PR: MergePr = {
  id: "pr-514",
  organizationId: ORG,
  sourceId: "src-1",
  number: 514,
  title: "fix(can): frame order",
  state: "verifying",
  runId: "run-482",
  ticketKey: "#482",
};

describe("the merge repository — the org policy's facts", () => {
  let database: RecordingDatabase;
  let merges: MergeRepository;

  beforeEach(() => {
    database = recordingDatabase();
    merges = new MergeRepository(database.service, new GuardrailsRepository());
  });

  it("reads an empty ticket and an unknown loop for a PR no run opened, without a statement", async () => {
    expect(await merges.policyFacts({ ...PR, runId: null })).toEqual({
      ticket: { labels: [], effort: undefined },
      loop: null,
    });
    expect(database.statements).toHaveLength(0);
  });

  it("reads the ticket and counts the repository's loops that opened a PR, up to and including this one", async () => {
    database.answers(
      {
        rows: [
          {
            organization_id: ORG,
            github_repo_id: "repo-helios",
            issue_number: 482,
            workflow_tag: "standard-fix",
            workflow_version_pin: 14,
          },
        ],
      },
      { rows: [{ id: "issue-482", labels: ["bug", "refactor"] }] },
      { rows: [{ breakdown: { files: ["src/can/isr.c"] }, effort: "m" }] },
      { rows: [{ loop: 4 }] },
    );

    expect(await merges.policyFacts(PR)).toEqual({
      ticket: { labels: ["bug", "refactor"], effort: "m" },
      loop: 4,
    });

    const count = database.statements[3];

    // A loop's PR is on the run (written at merge) or mirrored — the seed's history has only the first.
    expect(count.sql).toContain("r.pr_number is not null");
    expect(count.sql).toContain("from ouroboros.pull_requests p");
    expect(count.sql).toContain("(r.created_at, r.id) <= (me.created_at, me.id)");
    expect(count.parameters).toEqual(["run-482", ORG, ORG, "repo-helios"]);
  });

  it("reads no loop when the count finds nothing, and nothing for a run of another workspace", async () => {
    database.answers(
      {
        rows: [
          {
            organization_id: ORG,
            github_repo_id: "r",
            issue_number: 1,
            workflow_tag: "t",
            workflow_version_pin: null,
          },
        ],
      },
      { rows: [] },
      { rows: [{ loop: 0 }] },
    );

    expect((await merges.policyFacts(PR)).loop).toBeNull();

    database.answers({
      rows: [
        {
          organization_id: "org-other",
          github_repo_id: "r",
          issue_number: 1,
          workflow_tag: "t",
          workflow_version_pin: null,
        },
      ],
    });

    expect(await merges.policyFacts(PR)).toEqual({
      ticket: { labels: [], effort: undefined },
      loop: null,
    });
  });

  it("reads an armer's roles, and none for someone who left", async () => {
    database.answers({ rows: [{ role: "admin" }] });

    expect(await merges.roles(ORG, "user-ken")).toEqual(["admin"]);
    expect(await merges.roles(ORG, "user-gone")).toEqual([]);
  });
});
