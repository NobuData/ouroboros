import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { WorkflowCatalogRepository } from "./catalog.repository";

/**
 * The stage catalog's one statement — R.3
 * ([#145](https://github.com/NobuData/ouroboros/issues/145)).
 *
 * A real Kysely over a recording driver, as `stats.repository.spec.ts` argues: a mocked method
 * would say nothing about whether the SQL was scoped to one workspace, and one workspace's task
 * kinds suggested in another's inspector is the failure that matters here. Whether PostgreSQL
 * answers the rows is `catalog.integration-spec.ts`' question.
 */

const WORKSPACE = "acme-robotics-id";

describe("the stage catalog repository", () => {
  let database: RecordingDatabase;
  let repository: WorkflowCatalogRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new WorkflowCatalogRepository(database.service);
  });

  it("scopes the task kinds to one workspace, by parameter", async () => {
    await repository.taskKindNames(WORKSPACE);

    const [statement] = database.statements;
    expect(statement.sql).toContain('"organization_id" = $');
    // By parameter, never by interpolation: the id is the tenant context's.
    expect(statement.parameters).toContain(WORKSPACE);
  });

  it("reads the table the routing matrix draws, the name and nothing else", async () => {
    // Registry data (decision M3): the DSL, this catalog and the matrix read one vocabulary.
    await repository.taskKindNames(WORKSPACE);

    expect(database.statements[0].sql).toMatch(
      new RegExp(`^select "name" from "${SCHEMA_NAME}"\\."task_kinds"`),
    );
  });

  it("orders the names as the matrix does", async () => {
    await repository.taskKindNames(WORKSPACE);

    expect(database.statements[0].sql).toContain('order by "sort_order"');
  });

  it("answers the names, in the order the rows arrive", async () => {
    database.answers({ rows: [{ name: "analyze" }, { name: "implement" }, { name: "review" }] });

    await expect(repository.taskKindNames(WORKSPACE)).resolves.toEqual([
      "analyze",
      "implement",
      "review",
    ]);
  });

  it("answers nothing for a workspace whose routing has not been seeded", async () => {
    database.answers({ rows: [] });

    await expect(repository.taskKindNames(WORKSPACE)).resolves.toEqual([]);
  });
});
