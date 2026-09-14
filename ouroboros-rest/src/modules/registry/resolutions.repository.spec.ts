import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { ResolutionSnapshotsRepository } from "./resolutions.repository";

/**
 * The snapshot read, asserted as SQL — for `registry.repository.spec.ts`'s reason: this layer is
 * a statement, and the things that can be wrong with it are in the statement.
 *
 * Tenancy first, then the three decisions `resolutions.repository.ts` argues: containment on the
 * chain (V024's GIN index), the pinned shape version, and one row in a deterministic order.
 * Whether PostgreSQL answers the seeded run #482 is `resolutions.integration-spec.ts`' question.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

describe("the resolution snapshot repository", () => {
  let database: RecordingDatabase;
  let snapshots: ResolutionSnapshotsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    snapshots = new ResolutionSnapshotsRepository(database.service);
  });

  it("scopes the read to one workspace, by parameter", async () => {
    await snapshots.latestNaming(WORKSPACE, "coder-max");

    const [statement] = database.statements;

    expect(statement.sql).toContain('"s"."organization_id" = $');
    expect(statement.parameters).toContain(WORKSPACE);
    expect(statement.sql).not.toContain(WORKSPACE);
  });

  it("joins the run within the same workspace, for its issue number", async () => {
    await snapshots.latestNaming(WORKSPACE, "coder-max");

    const { sql } = database.statements[0];

    expect(sql).toContain('inner join "ouroboros"."runs" as "r"');
    expect(sql).toContain('"r"."organization_id" = "s"."organization_id"');
    expect(sql).toContain('"r"."issue_number"');
  });

  it("finds the alias by containment on the chain, with the name as a parameter", async () => {
    // `chain @> '[{"alias": …}]'` is what V024's `resolution_snapshots_chain_idx` serves. The name
    // travels inside a parameter, so a name can never become SQL.
    await snapshots.latestNaming(WORKSPACE, "coder-max");

    const [statement] = database.statements;

    expect(statement.sql).toMatch(/"s"\."chain" @> \$\d+::jsonb/);
    expect(statement.parameters).toContain(JSON.stringify([{ alias: "coder-max" }]));
    expect(statement.sql).not.toContain("coder-max");
  });

  it("reads only the shape version this build can read", async () => {
    await snapshots.latestNaming(WORKSPACE, "coder-max");

    const [statement] = database.statements;

    expect(statement.sql).toContain('"s"."shape_version" = $');
    expect(statement.parameters).toContain(1);
  });

  it("answers the latest one, breaking a millisecond tie by id", async () => {
    await snapshots.latestNaming(WORKSPACE, "coder-max");

    const { sql } = database.statements[0];

    expect(sql).toContain('order by "s"."resolved_at" desc, "s"."id" desc');
    expect(sql).toMatch(/limit \$\d+$/);
  });

  it("only reads", async () => {
    await snapshots.latestNaming(WORKSPACE, "coder-max");

    for (const statement of database.sql()) {
      expect(statement).toMatch(/^select /);
    }
  });

  it("answers undefined when no snapshot names the alias", async () => {
    database.answers({ rows: [] });

    await expect(snapshots.latestNaming(WORKSPACE, "gpt5-experiments")).resolves.toBeUndefined();
  });
});
