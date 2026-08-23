import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { kindsOnCadence } from "./checks";
import { ProviderHealthRepository, type DueCutoffs } from "./provider-health.repository";

/**
 * The four statements — asserted as SQL, for the reason `registry.repository.spec.ts` gives:
 * this layer holds statements rather than rules, so mocking a method would prove nothing
 * about the two things that can actually be wrong here.
 *
 * The first is the **credential**. Exactly one statement in this module may name
 * `credentials_encrypted`, and the sweep's own read must report it as a boolean instead. That
 * is asserted over every other statement rather than over the one that was easy to remember.
 *
 * The second is **`paused`**. V015 calls it an operator's intent rather than a conclusion from
 * a check, and the honest reading is that nobody wants the provider contacted — so the rows
 * must not leave the database at all, which is a property of the `where` clause and of
 * nothing above it.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const CONNECTION = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const NOW = new Date("2026-08-23T10:00:00.000Z");

const CUTOFFS: DueCutoffs = {
  local: { kinds: kindsOnCadence("local"), before: new Date(NOW.getTime() - 60_000) },
  cloud: { kinds: kindsOnCadence("cloud"), before: new Date(NOW.getTime() - 900_000) },
};

describe("the provider health repository", () => {
  let database: RecordingDatabase;
  let connections: ProviderHealthRepository;

  beforeEach(() => {
    database = recordingDatabase();
    connections = new ProviderHealthRepository(database.service);
  });

  describe("what the statements never ask for", () => {
    /**
     * Every statement that is not the credential read, as a callable.
     *
     * Enumerated rather than sampled: a statement added with `selectAll()` is a statement that
     * pulls a workspace's sealed provider keys into a background job that has no use for them,
     * and it should fail this suite on the day it is written.
     */
    const everyOtherStatement: readonly [
      string,
      (repository: ProviderHealthRepository) => Promise<unknown>,
    ][] = [
      ["forOrganization", (repository) => repository.forOrganization(WORKSPACE)],
      [
        "record",
        (repository) =>
          repository.record(WORKSPACE, CONNECTION, {
            status: "active",
            health: { check: "reachability" },
            checkedAt: NOW,
          }),
      ],
    ];

    it.each(everyOtherStatement)("does not name the sealed column in %s", async (_name, issue) => {
      await issue(connections);

      for (const statement of database.sql()) {
        expect(statement).not.toContain("credentials_encrypted");
      }
    });

    it("reports the sweep's rows as having a credential, not as holding one", async () => {
      // `due` is the one other statement that mentions the column at all, and it may mention
      // it only inside the predicate that turns it into a boolean. Asserted as *the whole of*
      // its occurrence rather than as an absence, because an absence here would be a test that
      // could be satisfied by deleting the projection the sweep needs.
      await connections.due(CUTOFFS, 50);

      const [statement] = database.statements;

      expect(statement.sql.split("credentials_encrypted")).toHaveLength(2);
      expect(statement.sql).toContain('credentials_encrypted is not null as "has_credential"');
    });
  });

  describe("the sweep's read", () => {
    it("leaves paused connections in the database", async () => {
      await connections.due(CUTOFFS, 50);

      const [statement] = database.statements;
      expect(statement.sql).toContain('"status" != $');
      expect(statement.parameters).toContain("paused");
    });

    it("asks each cadence class for its own kinds and its own cutoff", async () => {
      await connections.due(CUTOFFS, 50);

      const [statement] = database.statements;
      expect(statement.parameters).toEqual(
        expect.arrayContaining([
          "paused",
          "ollama",
          "openai_compatible",
          "anthropic",
          CUTOFFS.local.before,
          CUTOFFS.cloud.before,
        ]),
      );
    });

    it("takes the longest-waiting first, and the never-checked before all of them", async () => {
      await connections.due(CUTOFFS, 50);

      const [statement] = database.statements;
      expect(statement.sql).toContain('order by "last_checked_at" asc nulls first');
    });

    it("caps what one cycle will check", async () => {
      await connections.due(CUTOFFS, 7);

      const [statement] = database.statements;
      expect(statement.sql).toContain("limit");
      expect(statement.parameters).toContain(7);
    });

    it("is deliberately not scoped to a workspace, because its caller is a timer", async () => {
      // The one unscoped read in this service. What keeps it safe is written into it: no
      // credential leaves the statement, and the only consumer writes back to the row it came
      // from and answers nobody. See the repository's header.
      await connections.due(CUTOFFS, 50);

      const [statement] = database.statements;
      expect(statement.parameters).not.toContain(WORKSPACE);
    });
  });

  describe("the credential read", () => {
    it("selects the column and nothing beside it", async () => {
      database.answers({ rows: [{ credentials_encrypted: "ouro.v1.1.nonce.cipher" }] });

      await connections.sealedCredential(WORKSPACE, CONNECTION);

      const [statement] = database.statements;
      expect(statement.sql).toContain('select "credentials_encrypted" from');
      expect(statement.sql).not.toContain("display_name");
    });

    it("carries the workspace as well as the id", async () => {
      database.answers({ rows: [] });

      await connections.sealedCredential(WORKSPACE, CONNECTION);

      const [statement] = database.statements;
      expect(statement.parameters).toEqual([WORKSPACE, CONNECTION]);
    });

    it("answers null for a connection that holds none", async () => {
      database.answers({ rows: [{ credentials_encrypted: null }] });

      await expect(connections.sealedCredential(WORKSPACE, CONNECTION)).resolves.toBeNull();
    });

    it("answers null for a connection that is not this workspace's", async () => {
      database.answers({ rows: [] });

      await expect(connections.sealedCredential(WORKSPACE, CONNECTION)).resolves.toBeNull();
    });
  });

  describe("the write", () => {
    it("moves the three columns V015 requires to agree, in one statement", async () => {
      await connections.record(WORKSPACE, CONNECTION, {
        status: "error",
        health: { check: "reachability", detail: "unreachable (ECONNREFUSED)" },
        checkedAt: NOW,
      });

      expect(database.statements).toHaveLength(1);

      const [statement] = database.statements;
      expect(statement.sql).toContain('"status" = $');
      expect(statement.sql).toContain('"last_checked_at" = $');
      expect(statement.sql).toContain('"health" = $');
    });

    it("sends the health object as jsonb rather than as a stringified object", async () => {
      // `pg` renders a JavaScript object into a jsonb column as `[object Object]`, which the
      // column accepts and nothing can read back.
      await connections.record(WORKSPACE, CONNECTION, {
        status: "active",
        health: { check: "reachability", latency_ms: 4 },
        checkedAt: NOW,
      });

      const [statement] = database.statements;
      expect(statement.sql).toContain("::jsonb");
      expect(statement.parameters).toContain('{"check":"reachability","latency_ms":4}');
    });

    it("is scoped to the workspace as well as to the row", async () => {
      await connections.record(WORKSPACE, CONNECTION, {
        status: "active",
        health: { check: "reachability" },
        checkedAt: NOW,
      });

      const [statement] = database.statements;
      expect(statement.parameters).toContain(WORKSPACE);
      expect(statement.parameters).toContain(CONNECTION);
    });
  });

  describe("the page's read", () => {
    it("carries the workspace into the statement, by parameter", async () => {
      await connections.forOrganization(WORKSPACE);

      const [statement] = database.statements;
      expect(statement.sql).toContain("organization_id");
      expect(statement.parameters).toContain(WORKSPACE);
      expect(statement.sql).not.toContain(WORKSPACE);
    });

    it("orders by name, so the chips do not reshuffle between polls", async () => {
      await connections.forOrganization(WORKSPACE);

      expect(database.statements[0].sql).toContain('order by "display_name"');
    });

    it("includes paused connections, which the strip still has to draw", async () => {
      // Unlike the sweep. `paused` is a state a person chose and a chip a person should see.
      await connections.forOrganization(WORKSPACE);

      expect(database.statements[0].parameters).not.toContain("paused");
    });
  });
});
