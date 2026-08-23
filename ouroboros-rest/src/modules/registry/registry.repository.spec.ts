import { readFileSync } from "node:fs";
import { join } from "node:path";

import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { RegistryRepository } from "./registry.repository";
import type { AliasResolutionRow } from "./resolution";

/**
 * The three statements, and the two properties a resolution rests on.
 *
 * This layer holds no rules — it holds statements — which is why mocking a *method* would
 * prove nothing here. `expect(repository.resolveAlias).toHaveBeenCalled()` says nothing about
 * whether the workspace reached the `where` clause or whether the join dragged the sealed
 * credential along with it, and both of those are what this module has to get right. So
 * these run against a real Kysely over a recording driver: the compiler is real, the SQL
 * asserted is the SQL PostgreSQL would receive, and nothing is sent.
 *
 * Whether the server accepts these statements, and whether the plan is the two index lookups
 * V015 was shaped for, is asserted where a database exists —
 * `ouroboros-db/tests/constraints.sql` for the plan, `registry.integration-spec.ts` for the
 * answers.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const CONNECTION = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";

/** One row, as the resolution join hands it back. */
const ROW = {
  alias: "coder-max",
  model_id: "claude-fable-5",
  params: { thinking: "max" },
  connection_id: CONNECTION,
  kind: "anthropic",
  display_name: "Anthropic",
  base_url: null,
  status: "active",
} satisfies AliasResolutionRow;

describe("the registry repository", () => {
  let database: RecordingDatabase;
  let registry: RegistryRepository;

  beforeEach(() => {
    database = recordingDatabase();
    registry = new RegistryRepository(database.service);
  });

  /**
   * Every statement this repository can issue, as a callable.
   *
   * Enumerated rather than sampled: a method added without a workspace predicate is a method
   * that resolves one workspace's alias onto another workspace's provider — and therefore
   * onto its credential — so it should fail this suite on the day it is written.
   */
  const everyStatement: readonly [string, (repository: RegistryRepository) => Promise<unknown>][] =
    [
      ["resolveAlias", (repository) => repository.resolveAlias(WORKSPACE, "coder-max")],
      ["listAliases", (repository) => repository.listAliases(WORKSPACE)],
      [
        "aliasesForConnection",
        (repository) => repository.aliasesForConnection(WORKSPACE, CONNECTION),
      ],
    ];

  describe("scoping", () => {
    it.each(everyStatement)("carries the workspace into %s, by parameter", async (_name, issue) => {
      database.answers({ rows: [ROW] });

      await issue(registry);

      const [statement] = database.statements;
      expect(statement.sql).toContain("organization_id");
      expect(statement.parameters).toContain(WORKSPACE);
      // Not interpolated. Every value this repository sends is a placeholder, which is what
      // makes an alias supplied by a DSL expression or a query string harmless.
      expect(statement.sql).not.toContain(WORKSPACE);
    });
  });

  describe("what the statements never ask for", () => {
    /**
     * The ticket's third acceptance criterion, as a probe rather than as inspection.
     *
     * `credentials_encrypted` is not in {@link AliasResolutionRow}, so a leak through these
     * statements could not compile — but a `select *`, or a column added to the list by
     * somebody widening the resolution, would both compile fine and would put a ciphertext
     * into every answer this module gives. This asserts on the SQL, which is the thing that
     * would actually carry it.
     */
    it.each(everyStatement)("does not name the credential column in %s", async (_name, issue) => {
      database.answers({ rows: [ROW] });

      await issue(registry);

      for (const sql of database.sql()) {
        expect(sql).not.toContain("credentials_encrypted");
        // A star would pull the column in without ever naming it, which is the version of
        // this mistake that an assertion on the column name alone would miss.
        expect(sql).not.toMatch(/select\s+\*/i);
      }
    });

    it("names the column, in code, in exactly one file in this module", () => {
      // The other half of the same criterion, and the half a compiled statement cannot show:
      // the re-encryption store *has* to read the ciphertext, so the rule is not "nowhere" —
      // it is "one place, and it is that one". The same shape as
      // `organization.repository.spec.ts`, which reads its own module's source for a rule a
      // type cannot express.
      //
      // Comments are stripped first, deliberately. Three files in this module *discuss* the
      // column — arguing why they do not select it is most of what their headers are for —
      // and an assertion that could not tell a header from a `select` would force the
      // reasoning out of the files that need it most.
      const code = (file: string): string =>
        readFileSync(join(__dirname, file), "utf8")
          .split("\n")
          .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
          .join("\n");

      expect(code("registry.repository.ts")).not.toContain("credentials_encrypted");
      expect(code("registry.service.ts")).not.toContain("credentials_encrypted");
      expect(code("resolution.ts")).not.toContain("credentials_encrypted");
      expect(code("registry.secrets.ts")).toContain("credentials_encrypted");
    });
  });

  describe("resolveAlias", () => {
    it("asks for the alias and its connection in one statement", async () => {
      database.answers({ rows: [ROW] });

      await registry.resolveAlias(WORKSPACE, "coder-max");

      expect(database.statements).toHaveLength(1);
      const [statement] = database.statements;
      expect(statement.sql).toContain('"ouroboros"."model_aliases"');
      expect(statement.sql).toContain('inner join "ouroboros"."provider_connections"');
      expect(statement.parameters).toEqual([WORKSPACE, "coder-max"]);
    });

    it("joins on the workspace as well as the connection id", () => {
      // Equivalent to joining on the id alone, given V015's composite foreign key — and
      // written out so the workspace predicate is visible in the statement rather than being
      // a consequence of a constraint the reader has to go and look up.
      return registry.resolveAlias(WORKSPACE, "coder-max").then(() => {
        const [statement] = database.statements;
        expect(statement.sql).toContain(
          'on "c"."organization_id" = "a"."organization_id" and "c"."id" = "a"."provider_connection_id"',
        );
      });
    });

    it("hands back the row the server answered with", async () => {
      database.answers({ rows: [ROW] });

      await expect(registry.resolveAlias(WORKSPACE, "coder-max")).resolves.toEqual(ROW);
    });

    it("answers undefined for an alias this workspace does not have", async () => {
      await expect(registry.resolveAlias(WORKSPACE, "no-such-alias")).resolves.toBeUndefined();
    });

    it("does not fold the alias it was given", async () => {
      // V015 stores aliases lower-case and constrains them to that shape, so `Coder-Max` is a
      // name this workspace does not have. Folding it here would be this layer deciding what
      // somebody meant, and would resolve two different requests to one row.
      await registry.resolveAlias(WORKSPACE, "Coder-Max");

      expect(database.statements[0].parameters).toContain("Coder-Max");
    });
  });

  describe("listAliases", () => {
    it("orders by name, which is what a menu is scanned by", async () => {
      database.answers({ rows: [ROW] });

      await registry.listAliases(WORKSPACE);

      expect(database.statements[0].sql).toContain('order by "a"."alias"');
    });

    it("takes no window, because a workspace's registry is a handful of rows", async () => {
      await registry.listAliases(WORKSPACE);

      expect(database.statements[0].sql).not.toContain("limit");
      expect(database.statements[0].sql).not.toContain("offset");
    });

    it("answers with every row, in the order the server gave them", async () => {
      const second = { ...ROW, alias: "local-docs", model_id: "llama-4-maverick" };
      database.answers({ rows: [ROW, second] });

      await expect(registry.listAliases(WORKSPACE)).resolves.toEqual([ROW, second]);
    });

    it("answers with nothing for a workspace whose registry is empty", async () => {
      await expect(registry.listAliases(WORKSPACE)).resolves.toEqual([]);
    });
  });

  describe("aliasesForConnection", () => {
    it("asks only for the names, ordered", async () => {
      database.answers({ rows: [{ alias: "coder-max" }, { alias: "local-docs" }] });

      await expect(registry.aliasesForConnection(WORKSPACE, CONNECTION)).resolves.toEqual([
        "coder-max",
        "local-docs",
      ]);

      const [statement] = database.statements;
      expect(statement.sql).toContain('order by "alias"');
      expect(statement.parameters).toEqual([WORKSPACE, CONNECTION]);
    });

    it("enters through the index the foreign key needs, by naming both columns", async () => {
      await registry.aliasesForConnection(WORKSPACE, CONNECTION);

      // `model_aliases_provider_idx` is on `(organization_id, provider_connection_id)`. A
      // statement that filtered on the connection alone would still be correct and would
      // scan, which is the thing V015's index exists to prevent.
      expect(database.statements[0].sql).toContain('"organization_id" = $1');
      expect(database.statements[0].sql).toContain('"provider_connection_id" = $2');
    });

    it("answers with nothing when no alias depends on the connection", async () => {
      await expect(registry.aliasesForConnection(WORKSPACE, CONNECTION)).resolves.toEqual([]);
    });
  });
});
