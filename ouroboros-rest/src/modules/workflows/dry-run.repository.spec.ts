import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { WorkflowDryRunRepository } from "./dry-run.repository";

/**
 * The one statement a dry run issues, as the SQL PostgreSQL would receive — real Kysely over a
 * recording driver, per `workflows.repository.spec.ts`. Two properties: it is scoped to the
 * workspace (the `404` for another workspace's issue), and the effort is the estimate in force.
 */

const WORKSPACE = "acme-robotics-id";
const ISSUE = "7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

describe("the dry-run repository", () => {
  let database: RecordingDatabase;
  let repository: WorkflowDryRunRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new WorkflowDryRunRepository(database.service);
  });

  it("is scoped to the workspace and keyed by the issue", async () => {
    await repository.issue(WORKSPACE, ISSUE);

    expect(database.statements[0].sql).toContain('"github_issues"."organization_id" = $');
    expect(database.statements[0].sql).toContain('"github_issues"."id" = $');
    expect(database.statements[0].parameters).toEqual(expect.arrayContaining([WORKSPACE, ISSUE]));
  });

  it("reads the estimate in force — the highest version, and only it", async () => {
    await repository.issue(WORKSPACE, ISSUE);

    expect(database.statements[0].sql).toContain('"issue_estimates"."version" desc');
    expect(database.statements[0].sql).toContain("limit $");
    expect(database.statements[0].sql).toContain("left join lateral");
  });

  it("answers undefined when the id names nothing this workspace holds", async () => {
    await expect(repository.issue(WORKSPACE, ISSUE)).resolves.toBeUndefined();
  });

  it("answers the number, the labels and the effort of a matched issue", async () => {
    database.answers({ rows: [{ number: 485, labels: ["bug"], effort: "m" }] });

    await expect(repository.issue(WORKSPACE, ISSUE)).resolves.toEqual({
      number: 485,
      labels: ["bug"],
      effort: "m",
    });
  });

  it("answers a null effort for an issue nobody has sized", async () => {
    database.answers({ rows: [{ number: 12, labels: [], effort: null }] });

    await expect(repository.issue(WORKSPACE, ISSUE)).resolves.toMatchObject({ effort: null });
  });
});
