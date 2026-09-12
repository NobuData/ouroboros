import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { WorkflowStatsRepository } from "./stats.repository";
import { usageWindowStart } from "./stats.service";

/**
 * The three statements, and the properties the rail's honesty rests on
 * ([#135](https://github.com/NobuData/ouroboros/issues/135)).
 *
 * This layer holds statements rather than rules, which is exactly why a mocked *method* would
 * prove nothing here: `expect(repository.registryEntries).toHaveBeenCalled()` says nothing
 * about whether the SQL it issued was scoped to one workspace, and *scoped to one workspace* is
 * the criterion this ticket's cross-org rule rests on. So these run a real Kysely over a
 * recording driver — the real compiler, the real dialect, nothing sent.
 *
 * Whether PostgreSQL accepts the jsonb expressions below, and whether the numbers are right,
 * is `workflows.integration-spec.ts`' question against real rows.
 */

const WORKSPACE = "acme-robotics-id";

/** A moment with nothing round about it, so a window boundary is recognisable in a parameter list. */
const NOW = new Date("2026-09-12T14:37:41.532Z");

describe("the workflow stats repository", () => {
  let database: RecordingDatabase;
  let repository: WorkflowStatsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new WorkflowStatsRepository(database.service);
  });

  describe("scoping", () => {
    /**
     * Every read this repository can perform, as a callable.
     *
     * Enumerated so the assertion below is over the surface rather than over a sample: a
     * method added without a workspace predicate is a method that would answer with somebody
     * else's numbers, and it should fail this suite on the day it is written.
     */
    const everyRead: readonly [
      string,
      (repository: WorkflowStatsRepository) => Promise<unknown>,
    ][] = [
      ["registryEntries", (subject) => subject.registryEntries(WORKSPACE)],
      ["runShares", (subject) => subject.runShares(WORKSPACE, usageWindowStart(NOW))],
      ["activeSlugs", (subject) => subject.activeSlugs(WORKSPACE)],
    ];

    it.each(everyRead)("scopes %s to one workspace, by parameter", async (_name, read) => {
      await read(repository);

      const [statement] = database.statements;
      expect(statement.sql).toContain('"organization_id" = $');
      // By parameter, never by interpolation: the id is the tenant context's, and this is what
      // makes it impossible for one to be spliced into SQL.
      expect(statement.parameters).toContain(WORKSPACE);
    });
  });

  describe("the registry read", () => {
    it("reaches the definition through `current_version`, not through the newest row", async () => {
      // V029 is emphatic that `current_version` is a pointer rather than a cache of
      // `max(version)`: a workflow can carry a draft and several published versions while an
      // older one is in force, and the `v14` chip is what is in force.
      await repository.registryEntries(WORKSPACE);

      const [statement] = database.statements;
      expect(statement.sql).toContain('"v"."workflow_id" = "w"."id"');
      expect(statement.sql).toContain('"v"."version" = "w"."current_version"');
    });

    it("joins the version rather than requiring one, so a draft-only workflow stays on the rail", async () => {
      // **+ New workflow** leaves a workflow with no version in force. An inner join would
      // drop it from the rail, which is a row silently missing rather than an honest caption.
      await repository.registryEntries(WORKSPACE);

      expect(database.statements[0].sql).toContain("left join");
    });

    it("leaves archived workflows out", async () => {
      await repository.registryEntries(WORKSPACE);

      const [statement] = database.statements;
      expect(statement.sql).toContain('"w"."status" != $');
      expect(statement.parameters).toContain("archived");
    });

    it("asks for the node count and the terminal actions, not for the documents", async () => {
      // A definition holds a prompt template per model stage — up to 20 000 characters each —
      // so counting nodes here rather than in PostgreSQL would move megabytes of prose to
      // produce two integers.
      await repository.registryEntries(WORKSPACE);

      const [statement] = database.statements;
      expect(statement.sql).toContain("jsonb_array_length");
      expect(statement.sql).toContain("array_agg");
      expect(statement.sql).not.toContain('"v"."definition" as');
    });

    it("guards every jsonb expression, because the column promises only an object", async () => {
      // `workflow_versions_definition_object` CHECKs an object and no further, and both
      // `jsonb_array_length` and `jsonb_array_elements` raise on a value that is not an array.
      // One malformed draft must not be a 500 for the whole rail.
      await repository.registryEntries(WORKSPACE);

      const { sql } = database.statements[0];
      expect(sql).toContain("jsonb_typeof");
      expect(sql).toContain("'[]'::jsonb");
    });

    it("looks for terminals by the DSL's own node type", async () => {
      await repository.registryEntries(WORKSPACE);

      expect(database.statements[0].parameters).toContain("term");
    });

    it("orders by creation, then by slug, so the rail does not reshuffle between reads", async () => {
      await repository.registryEntries(WORKSPACE);

      const { sql } = database.statements[0];
      expect(sql).toContain('order by "w"."created_at" asc, "w"."slug" asc');
    });

    it("hands back the rows as they were selected", async () => {
      database.answers({
        rows: [
          {
            id: "workflow-1",
            slug: "standard-fix",
            name: "standard-fix",
            status: "active",
            current_version: 14,
            stage_count: 6,
            terminal_actions: ["back_to_queue", "open_pr_automerge"],
          },
        ],
      });

      await expect(repository.registryEntries(WORKSPACE)).resolves.toEqual([
        {
          id: "workflow-1",
          slug: "standard-fix",
          name: "standard-fix",
          status: "active",
          current_version: 14,
          stage_count: 6,
          terminal_actions: ["back_to_queue", "open_pr_automerge"],
        },
      ]);
    });
  });

  describe("the run shares", () => {
    it("counts the window's runs per tag, in one pass", async () => {
      // One statement, so the numerator and the denominator cannot disagree about which runs
      // were in the window — `windows.ts`' whole argument.
      await repository.runShares(WORKSPACE, usageWindowStart(NOW));

      const [statement] = database.statements;
      expect(statement.sql).toContain("count(*)::int");
      expect(statement.sql).toContain('group by "workflow_tag"');
      expect(database.statements).toHaveLength(1);
    });

    it("windows on `started_at`, so a run in flight is still a run", async () => {
      // `finished_at` is null while a loop is running, so windowing on it would leave every
      // live loop out of *used by N% of runs* — which is the usage a studio reader is asking
      // about.
      await repository.runShares(WORKSPACE, usageWindowStart(NOW));

      const [statement] = database.statements;
      expect(statement.sql).toContain('"started_at" >= $');
      expect(statement.sql).not.toContain("finished_at");
      expect(statement.parameters).toContainEqual(usageWindowStart(NOW));
    });

    it("does not join `workflows`, so a renamed workflow's runs still count", async () => {
      // Decision F8 keeps the tag opaque and V029 added no foreign key. A run performed under
      // a since-deleted workflow is still a run this workspace performed, and the denominator
      // that left it out would inflate every share on the page.
      await repository.runShares(WORKSPACE, usageWindowStart(NOW));

      expect(database.statements[0].sql).not.toContain("workflows");
    });

    it("hands back one row per tag", async () => {
      database.answers({
        rows: [
          { workflow_tag: "standard-fix", runs: 47 },
          { workflow_tag: "docs-loop", runs: 3 },
        ],
      });

      await expect(repository.runShares(WORKSPACE, usageWindowStart(NOW))).resolves.toEqual([
        { workflow_tag: "standard-fix", runs: 47 },
        { workflow_tag: "docs-loop", runs: 3 },
      ]);
    });
  });

  describe("the offered slugs", () => {
    it("asks for active workflows only, and for nothing but the slug", async () => {
      // A paused workflow belongs on the rail and not in an assign menu; the read is on the
      // path of every queue write, so it takes none of the jsonb work with it.
      await repository.activeSlugs(WORKSPACE);

      const [statement] = database.statements;
      expect(statement.sql).toContain('"status" = $');
      expect(statement.parameters).toContain("active");
      expect(statement.sql).not.toContain("definition");
      expect(statement.sql).not.toContain("join");
    });

    it("flattens the rows into slugs, in the rail's order", async () => {
      database.answers({ rows: [{ slug: "standard-fix" }, { slug: "docs-loop" }] });

      await expect(repository.activeSlugs(WORKSPACE)).resolves.toEqual([
        "standard-fix",
        "docs-loop",
      ]);
    });

    it("answers an empty list for a workspace with no workflows", async () => {
      // Which is every installation today: V029's tables have no writer yet. What that empty
      // list *means* is `registry.service.ts`' decision, not this one's.
      await expect(repository.activeSlugs(WORKSPACE)).resolves.toEqual([]);
    });
  });
});
