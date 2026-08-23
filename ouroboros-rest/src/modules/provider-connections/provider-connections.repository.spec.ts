import { readFileSync } from "node:fs";
import { join } from "node:path";

import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import {
  FIXTURE_CONNECTION,
  FIXTURE_ENVELOPE,
  FIXTURE_WORKSPACE,
  connectionRow,
} from "./connection.fixture";
import {
  CONNECTION_COLUMNS,
  ProviderConnectionsRepository,
} from "./provider-connections.repository";

/**
 * The statements, and the three properties this module's safety rests on.
 *
 * This layer holds no rules — it holds statements — so mocking a *method* would prove
 * nothing: `expect(repository.find).toHaveBeenCalled()` says nothing about whether the
 * workspace reached the `where` clause, and that is the thing that stands between one
 * tenant's request and another tenant's sealed key. So these run against a real Kysely over
 * a recording driver, exactly as `registry.repository.spec.ts` does: the compiler is real,
 * the SQL asserted is the SQL PostgreSQL would receive, and nothing is sent.
 *
 * Whether the server accepts these statements is asserted where a database exists, in
 * `provider-connections.integration-spec.ts`.
 */

const WINDOW = { limit: 25, offset: 0 };

describe("the provider connections repository", () => {
  let database: RecordingDatabase;
  let connections: ProviderConnectionsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    connections = new ProviderConnectionsRepository(database.service);
  });

  /**
   * Every statement this repository can issue, as a callable.
   *
   * Enumerated rather than sampled: a method added without a workspace predicate is a method
   * that reads or writes another workspace's connection — and therefore its credential — so
   * it should fail this suite on the day it is written.
   */
  const everyStatement: readonly [
    string,
    (repository: ProviderConnectionsRepository) => Promise<unknown>,
  ][] = [
    ["list", (repository) => repository.list(FIXTURE_WORKSPACE, WINDOW)],
    ["find", (repository) => repository.find(FIXTURE_WORKSPACE, FIXTURE_CONNECTION)],
    ["envelopeOf", (repository) => repository.envelopeOf(FIXTURE_WORKSPACE, FIXTURE_CONNECTION)],
    [
      "envelopesFor",
      (repository) => repository.envelopesFor(FIXTURE_WORKSPACE, [FIXTURE_CONNECTION]),
    ],
    [
      "update",
      (repository) => repository.update(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, { enabled: false }),
    ],
    [
      "swapCredential",
      (repository) =>
        repository.swapCredential(
          FIXTURE_WORKSPACE,
          FIXTURE_CONNECTION,
          FIXTURE_ENVELOPE,
          "ouro.v1.1.bmV3.bmV3",
          new Date("2026-08-23T10:00:00.000Z"),
          { latency_ms: 12 },
        ),
    ],
    ["remove", (repository) => repository.remove(FIXTURE_WORKSPACE, FIXTURE_CONNECTION)],
  ];

  describe("scoping", () => {
    it.each(everyStatement)("carries the workspace into %s, by parameter", async (_name, issue) => {
      database.answers({ rows: [{ ...connectionRow(), total: "1" }] }, { rows: [{ total: "1" }] });

      await issue(connections);

      for (const statement of database.statements) {
        expect(statement.sql).toContain("organization_id");
        expect(statement.parameters).toContain(FIXTURE_WORKSPACE);
        // Not interpolated. Every value this repository sends is a placeholder, which is what
        // makes an id from a path segment harmless.
        expect(statement.sql).not.toContain(FIXTURE_WORKSPACE);
      }
    });

    it("carries it into the insert as a column rather than as a predicate", async () => {
      database.answers({ rows: [connectionRow()] });

      await connections.insert(
        {
          id: FIXTURE_CONNECTION,
          organization_id: FIXTURE_WORKSPACE,
          kind: "anthropic",
          display_name: "Anthropic Claude",
        },
        FIXTURE_ENVELOPE,
      );

      const [statement] = database.statements;
      expect(statement.sql).toContain('"organization_id"');
      expect(statement.parameters).toContain(FIXTURE_WORKSPACE);
    });
  });

  describe("what names the sealed column", () => {
    it.each(everyStatement)(
      "selects it in %s only where that is the point",
      async (name, issue) => {
        database.answers(
          { rows: [{ ...connectionRow(), total: "1" }] },
          { rows: [{ total: "1" }] },
        );

        await issue(connections);

        const reads = database.sql().filter((sql) => /^\s*select/i.test(sql));
        const namesIt = reads.some((sql) => sql.includes("credentials_encrypted"));

        expect(namesIt).toBe(name === "envelopeOf" || name === "envelopesFor");
      },
    );

    it.each(everyStatement)("never selects a star in %s", async (_name, issue) => {
      // A star would pull the sealed column into a resource without ever naming it, which is
      // the version of this mistake an assertion on the column name alone would miss.
      database.answers({ rows: [{ ...connectionRow(), total: "1" }] }, { rows: [{ total: "1" }] });

      await issue(connections);

      for (const sql of database.sql()) {
        expect(sql).not.toMatch(/select\s+\*/i);
      }
    });

    it("names it, in code, in the repository and nowhere else in this module", () => {
      // The half a compiled statement cannot show. Comments are stripped first: several files
      // here *discuss* the column — arguing about it is most of what their headers are for —
      // and an assertion that could not tell a header from a `select` would force the
      // reasoning out of the files that need it most. The same shape as
      // `registry.repository.spec.ts`'s own.
      const code = (file: string): string =>
        readFileSync(join(__dirname, file), "utf8")
          .split("\n")
          .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
          .join("\n");

      expect(code("provider-connections.repository.ts")).toContain("credentials_encrypted");
      expect(code("provider-connections.service.ts")).not.toContain("credentials_encrypted");
      expect(code("provider-connections.controller.ts")).not.toContain("credentials_encrypted");
      expect(code("resources.ts")).not.toContain("credentials_encrypted");
      expect(code("config.mapping.ts")).not.toContain("credentials_encrypted");
    });

    it("selects nothing but the envelope when it reads one", async () => {
      await connections.envelopeOf(FIXTURE_WORKSPACE, FIXTURE_CONNECTION);

      const [statement] = database.statements;
      expect(statement.sql).toContain('select "credentials_encrypted" from');
    });
  });

  describe("listing", () => {
    it("orders by name and breaks ties on the id", async () => {
      // `display_name` is deliberately not unique, so two cards called *Ollama* would
      // otherwise page in whatever order the planner felt like — which is how a row appears
      // on two pages and another on none.
      database.answers({ rows: [connectionRow()] }, { rows: [{ total: "1" }] });

      await connections.list(FIXTURE_WORKSPACE, WINDOW);

      expect(database.sql()[0]).toContain('order by "display_name", "id"');
    });

    it("windows the rows and counts the workspace's whole set", async () => {
      database.answers({ rows: [connectionRow()] }, { rows: [{ total: "7" }] });

      const page = await connections.list(FIXTURE_WORKSPACE, { limit: 2, offset: 4 });

      expect(database.statements[0].parameters).toEqual([FIXTURE_WORKSPACE, 2, 4]);
      expect(database.sql()[1]).toContain("count(*)");
      expect(page.total).toBe(7);
    });

    it("selects the whole row except the credential, the health blob and the workspace", () => {
      expect([...CONNECTION_COLUMNS]).toEqual([
        "id",
        "kind",
        "display_name",
        "base_url",
        "status",
        "last_checked_at",
        "monthly_cap_cents",
        "added_by",
        "last_used_at",
        "capability_note",
        "enabled",
        "created_at",
        "updated_at",
      ]);
    });
  });

  describe("reading envelopes in a batch", () => {
    it("asks one statement for a page's worth", async () => {
      database.answers({
        rows: [
          { id: "a", credentials_encrypted: FIXTURE_ENVELOPE },
          { id: "b", credentials_encrypted: null },
        ],
      });

      const envelopes = await connections.envelopesFor(FIXTURE_WORKSPACE, ["a", "b"]);

      expect(database.statements).toHaveLength(1);
      expect(envelopes.get("a")).toBe(FIXTURE_ENVELOPE);
      // Present with `null` rather than absent, so a caller can tell *no credential* from
      // *not in this workspace* without a second read.
      expect(envelopes.get("b")).toBeNull();
    });

    it("issues no statement at all for an empty page", async () => {
      await expect(connections.envelopesFor(FIXTURE_WORKSPACE, [])).resolves.toEqual(new Map());

      expect(database.statements).toHaveLength(0);
    });
  });

  describe("updating", () => {
    it("does not write updated_at, which the table's trigger owns", async () => {
      // V015 attaches `provider_connections_touch_updated_at`, and a service that set the
      // column too would be racing a trigger for it.
      database.answers({ rows: [connectionRow()] });

      await connections.update(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, { enabled: false });

      // The `returning` clause names it — that is a read — so the assertion is about the
      // `set` clause alone, which is the half that would race the trigger.
      expect(database.sql()[0].split(" where ")[0]).not.toContain("updated_at");
    });
  });

  describe("swapping a credential", () => {
    it("is one statement, so there is no window where neither credential is active", async () => {
      database.answers({ rows: [connectionRow()] });

      await connections.swapCredential(
        FIXTURE_WORKSPACE,
        FIXTURE_CONNECTION,
        FIXTURE_ENVELOPE,
        "ouro.v1.1.bmV3.bmV3",
        new Date("2026-08-23T10:00:00.000Z"),
        { latency_ms: 12 },
      );

      expect(database.statements).toHaveLength(1);
      expect(database.sql()[0]).toMatch(/^update/i);
      // No transaction either: one around a single statement adds a round trip and buys
      // nothing PostgreSQL does not already promise.
      expect(database.sql()).not.toContain("begin");
    });

    it("is conditional on the row still holding what was validated against", async () => {
      database.answers({ rows: [connectionRow()] });

      await connections.swapCredential(
        FIXTURE_WORKSPACE,
        FIXTURE_CONNECTION,
        FIXTURE_ENVELOPE,
        "ouro.v1.1.bmV3.bmV3",
        new Date("2026-08-23T10:00:00.000Z"),
        { latency_ms: 12 },
      );

      // `is not distinct from` rather than `=`, which is the only comparison that treats two
      // nulls as equal — a rotation onto a credential-less connection would otherwise match
      // nothing at all and read as a lost race.
      expect(database.sql()[0]).toContain('"credentials_encrypted" is not distinct from');
      expect(database.statements[0].parameters).toContain(FIXTURE_ENVELOPE);
    });

    it("answers undefined when the row had changed underneath", async () => {
      // No queued rows: the conditional update matched nothing.
      await expect(
        connections.swapCredential(
          FIXTURE_WORKSPACE,
          FIXTURE_CONNECTION,
          FIXTURE_ENVELOPE,
          "ouro.v1.1.bmV3.bmV3",
          new Date("2026-08-23T10:00:00.000Z"),
          { latency_ms: 12 },
        ),
      ).resolves.toBeUndefined();
    });

    it("stamps the check that authorised the swap", async () => {
      const at = new Date("2026-08-23T10:00:00.000Z");
      database.answers({ rows: [connectionRow()] });

      await connections.swapCredential(
        FIXTURE_WORKSPACE,
        FIXTURE_CONNECTION,
        null,
        "ouro.v1.1.bmV3.bmV3",
        at,
        { latency_ms: 12 },
      );

      expect(database.statements[0].parameters).toContain(at);
      expect(database.sql()[0]).toContain("last_checked_at");
      expect(database.sql()[0]).toContain('"status"');
    });
  });

  describe("removing", () => {
    it("reports whether a row was actually removed", async () => {
      database.answers({ numAffectedRows: 1n });
      await expect(connections.remove(FIXTURE_WORKSPACE, FIXTURE_CONNECTION)).resolves.toBe(true);
    });

    it("reports false for a connection this workspace does not have", async () => {
      database.answers({ numAffectedRows: 0n });
      await expect(connections.remove(FIXTURE_WORKSPACE, FIXTURE_CONNECTION)).resolves.toBe(false);
    });
  });
});
