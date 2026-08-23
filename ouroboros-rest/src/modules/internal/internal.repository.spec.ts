import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { InternalRepository } from "./internal.repository";

/**
 * The one statement, and what it deliberately does not do.
 *
 * Real Kysely over a recording driver, per `runs.repository.spec.ts`'s argument: this layer
 * holds a statement rather than a rule, so what is asserted is the SQL PostgreSQL would
 * receive.
 *
 * Two properties. It reads **one column** — the workspace, not the run — because a lease has
 * no business reading whose issue it is or what model it named, and a `selectAll` here would
 * hand this module a row it does not need. And it is **the only statement**: a second one
 * appearing in this file would be the internal surface growing a data layer, which is the
 * moment to ask whether it belongs in the module that owns the table.
 */

const RUN = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";
const WORKSPACE = "aBcD1234eFgH5678iJkL9012mNoP3456";

describe("the workspace a run belongs to", () => {
  let database: RecordingDatabase;
  let runs: InternalRepository;

  beforeEach(() => {
    database = recordingDatabase();
    runs = new InternalRepository(database.service);
  });

  it("is looked up by the run's primary key", async () => {
    await runs.organizationOfRun(RUN);

    expect(database.statements).toHaveLength(1);
    expect(database.statements[0].sql).toContain('from "ouroboros"."runs"');
    expect(database.statements[0].sql).toContain('"id" = $1');
    expect(database.statements[0].parameters).toEqual([RUN]);
  });

  it("selects the workspace and nothing else", async () => {
    // A lease is attributed to a workspace; everything else on the row belongs to the runs
    // API, and reading it here would be this module quietly acquiring an interest in it.
    await runs.organizationOfRun(RUN);

    expect(database.statements[0].sql).toContain('"organization_id"');
    expect(database.statements[0].sql).not.toContain("*");
  });

  it("answers with the workspace when the run exists", async () => {
    database.answers({ rows: [{ organization_id: WORKSPACE }] });

    await expect(runs.organizationOfRun(RUN)).resolves.toBe(WORKSPACE);
  });

  it("answers undefined when it does not, rather than throwing", async () => {
    // *No such run* is an answer this query can give truthfully. What to tell the caller
    // about it is the surface's decision — `lease.ts` turns it into `404 run_not_found` —
    // and a repository that threw would have made that decision for it.
    database.answers({ rows: [] });

    await expect(runs.organizationOfRun(RUN)).resolves.toBeUndefined();
  });

  it("is scoped by nothing else, deliberately", async () => {
    // The reason this is not a method on `RunsRepository`: every statement there filters on
    // `organization_id`, and its own suite asserts that. Here the workspace is the *answer*,
    // so there is nothing to filter by — and putting the exception in the file whose whole
    // point is the predicate is how a predicate goes missing somewhere else.
    await runs.organizationOfRun(RUN);

    expect(database.statements[0].sql).not.toContain('"organization_id" = $');
  });
});
