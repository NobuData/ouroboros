import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import type { TenantKey } from "../db/schema";
import { MASTER_WRAPPER_ID } from "./master.key.wrapper";
import { FIRST_VERSION, VaultRepository } from "./vault.repository";

/**
 * The statements, and the two properties that cannot be checked anywhere else.
 *
 * **Every statement is scoped to one workspace.** `tenant_keys` holds the keys to every
 * credential in the installation, so a missing `where organization_id = $1` here is not a
 * leaked row — it is one workspace opening another's secrets. That is what a recording
 * database can see and a mocked method cannot.
 *
 * **The rotation is one transaction, in one order.** Retire, then insert: the partial unique
 * index counts active rows, so an insert that ran first would be refused by the row it is
 * replacing. The `for update` in front of both is what makes the version number correct
 * rather than merely unique. All three are assertions about the SQL, which is why they are
 * here rather than in `vault.service.spec.ts`.
 *
 * `vault.integration-spec.ts` runs every one of these against a migrated PostgreSQL, because
 * a statement that compiles is not a statement the server accepts.
 */

const WORKSPACE = "org-9f1c0a5e";

const ROW = {
  organization_id: WORKSPACE,
  version: 1,
  sealed_dek: Buffer.from("sealed"),
  wrapper: MASTER_WRAPPER_ID,
  status: "active",
  rotated_at: null,
  created_at: new Date("2026-08-14T09:00:00.000Z"),
  updated_at: new Date("2026-08-14T09:00:00.000Z"),
} satisfies TenantKey;

describe("the vault repository", () => {
  let database: RecordingDatabase;
  let keys: VaultRepository;

  beforeEach(() => {
    database = recordingDatabase();
    keys = new VaultRepository(database.service);
  });

  describe("reading a key", () => {
    it("finds the active version, scoped to the workspace and nothing else", async () => {
      database.answers({ rows: [ROW] });

      expect(await keys.activeKey(WORKSPACE)).toEqual(ROW);
      expect(database.statements[0].sql).toContain('from "ouroboros"."tenant_keys"');
      expect(database.statements[0].sql).toContain('where "organization_id" = $1');
      expect(database.statements[0].sql).toContain('and "status" = $2');
      expect(database.statements[0].parameters).toEqual([WORKSPACE, "active"]);
    });

    it("answers undefined for a workspace that has never stored a secret", async () => {
      database.answers({ rows: [] });

      // Absence is an ordinary state, not an error: keys are created lazily.
      expect(await keys.activeKey(WORKSPACE)).toBeUndefined();
    });

    it("looks a version up by the whole primary key", async () => {
      database.answers({ rows: [ROW] });

      expect(await keys.keyAt(WORKSPACE, 3)).toEqual(ROW);
      expect(database.statements[0].sql).toContain('where "organization_id" = $1');
      expect(database.statements[0].sql).toContain('and "version" = $2');
      expect(database.statements[0].parameters).toEqual([WORKSPACE, 3]);
    });

    it("does not filter a version lookup by status", async () => {
      // Retirement stops new writes; it does not stop reads. A `status = 'active'` here would
      // make a rotation destroy every value the sweep had not reached yet.
      database.answers({ rows: [ROW] });
      await keys.keyAt(WORKSPACE, 1);

      expect(database.statements[0].sql).not.toContain("status");
    });

    it("reads every version of one workspace's keys, oldest first", async () => {
      database.answers({ rows: [ROW] });

      expect(await keys.allKeys(WORKSPACE)).toEqual([ROW]);
      expect(database.statements[0].sql).toContain('where "organization_id" = $1');
      expect(database.statements[0].sql).toContain('order by "version" asc');
      expect(database.statements[0].parameters).toEqual([WORKSPACE]);
    });
  });

  describe("creating the first version", () => {
    it("inserts on conflict do nothing, then reads back what is stored", async () => {
      // The concurrent first-write case: whichever insert lands is the workspace's key, and
      // the other request adopts it rather than failing a request that did nothing wrong.
      // Reading *back* is the load-bearing half — returning the row this call tried to write
      // would hand the loser a key the table does not hold.
      database.answers({ rows: [] }, { rows: [ROW] });

      const created = await keys.createFirstVersion({
        organization_id: WORKSPACE,
        version: FIRST_VERSION,
        sealed_dek: ROW.sealed_dek,
        wrapper: ROW.wrapper,
      });

      expect(created).toEqual(ROW);
      expect(database.statements[0].sql).toContain('insert into "ouroboros"."tenant_keys"');
      expect(database.statements[0].sql).toContain("on conflict do nothing");
      expect(database.statements[1].sql).toContain('where "organization_id" = $1');
    });

    it("writes only the four columns it owns, leaving the rest to the table", async () => {
      // `status`, `rotated_at`, `created_at` and `updated_at` are the table's — the first two
      // by default, the last two by default and trigger. A writer that named them could
      // report a key as older than it is.
      database.answers({ rows: [] }, { rows: [ROW] });

      await keys.createFirstVersion({
        organization_id: WORKSPACE,
        version: FIRST_VERSION,
        sealed_dek: ROW.sealed_dek,
        wrapper: ROW.wrapper,
      });

      expect(database.statements[0].sql).toContain(
        '("organization_id", "version", "sealed_dek", "wrapper")',
      );
      expect(database.statements[0].sql).not.toContain('"rotated_at"');
      expect(database.statements[0].sql).not.toContain('"updated_at"');
    });

    it("fails rather than inventing a key if the row vanished between the two statements", async () => {
      // A workspace deleted mid-request. Inventing a key here would seal a secret with
      // something nothing can reach.
      database.answers({ rows: [] }, { rows: [] });

      await expect(
        keys.createFirstVersion({
          organization_id: WORKSPACE,
          version: FIRST_VERSION,
          sealed_dek: ROW.sealed_dek,
          wrapper: ROW.wrapper,
        }),
      ).rejects.toThrow(/no active key immediately after creating one/);
    });
  });

  describe("rotating", () => {
    /** What a rotation stores, given the version the transaction decided on. */
    const seal = jest.fn((version: number) =>
      Promise.resolve({
        sealed_dek: Buffer.from(`sealed for ${version.toString()}`),
        wrapper: MASTER_WRAPPER_ID,
      }),
    );

    it("runs as one transaction: lock, retire, insert", async () => {
      database.answers({ rows: [ROW] }, {}, { rows: [{ ...ROW, version: 2 }] });

      const rotated = await keys.rotate(WORKSPACE, seal);

      expect(rotated.version).toBe(2);
      expect(database.sql()[0]).toBe("begin");
      expect(database.sql().at(-1)).toBe("commit");

      // The lock, which is what makes "the next version" correct rather than merely unique:
      // two rotations that both read version 3 would both compute 4.
      expect(database.statements[1].sql).toContain("for update");

      // Retire before insert. The partial unique index counts active rows, so the other order
      // is refused by the row being replaced.
      expect(database.statements[2].sql).toContain('update "ouroboros"."tenant_keys"');
      expect(database.statements[2].sql).toContain('set "status" = $1, "rotated_at" = now()');
      expect(database.statements[3].sql).toContain('insert into "ouroboros"."tenant_keys"');
    });

    it("seals the new key against the version the transaction chose", async () => {
      // The wrapper binds the version into the sealed key's AAD, so the number cannot be
      // decided before the transaction has read the current one.
      database.answers({ rows: [{ ...ROW, version: 7 }] }, {}, { rows: [{ ...ROW, version: 8 }] });

      await keys.rotate(WORKSPACE, seal);

      expect(seal).toHaveBeenCalledWith(8);
    });

    it("retires exactly the version it read, in this workspace", async () => {
      database.answers({ rows: [{ ...ROW, version: 4 }] }, {}, { rows: [{ ...ROW, version: 5 }] });

      await keys.rotate(WORKSPACE, seal);

      expect(database.statements[2].parameters).toEqual(["retired", WORKSPACE, 4]);
    });

    it("refuses a workspace with no active key, and rolls back", async () => {
      database.answers({ rows: [] });

      await expect(keys.rotate(WORKSPACE, seal)).rejects.toThrow(/never stored a secret/);
      expect(database.sql().at(-1)).toBe("rollback");
    });
  });

  describe("re-wrapping", () => {
    // **The statement the whole envelope-encryption decision rests on.** It touches the
    // sealed key and the backend that sealed it, and nothing else — not the version, not the
    // status, and no data ciphertext anywhere in the schema.
    it("updates the seal and the wrapper of one version, and nothing else", async () => {
      database.answers({ rows: [{ ...ROW, wrapper: "aws-kms" }] });

      await keys.replaceSeal(WORKSPACE, 2, {
        sealed_dek: Buffer.from("resealed"),
        wrapper: "aws-kms",
      });

      const statement = database.statements[0];

      expect(statement.sql).toContain('update "ouroboros"."tenant_keys"');
      expect(statement.sql).toContain('set "sealed_dek" = $1, "wrapper" = $2');
      expect(statement.sql).toContain('where "organization_id" = $3 and "version" = $4');
      expect(statement.sql).not.toContain('"status"');
      expect(statement.sql).not.toContain('"version" =  $');
      expect(statement.parameters).toEqual([Buffer.from("resealed"), "aws-kms", WORKSPACE, 2]);
    });

    it("does not touch updated_at, which the trigger owns", async () => {
      // What says when custody changed. A writer that set it could report a re-wrap as older
      // than it is — and "when did the migration finish" is the question an operator asks.
      database.answers({ rows: [ROW] });
      await keys.replaceSeal(WORKSPACE, 1, { sealed_dek: Buffer.alloc(1), wrapper: "aws-kms" });

      expect(database.statements[0].sql).not.toContain('"updated_at"');
    });
  });

  describe("enumerating workspaces", () => {
    it("reads organization, in a stable order, for the one-time migration", async () => {
      // Driven from `organization` rather than from `tenant_keys`: a workspace holding secrets
      // this service never sealed has no key row, so the other query would skip exactly the
      // workspaces the migration exists for.
      database.answers({ rows: [{ id: "org-a" }, { id: "org-b" }] });

      expect(await keys.organizationIds()).toEqual(["org-a", "org-b"]);
      expect(database.statements[0].sql).toContain('from "ouroboros"."organization"');
      expect(database.statements[0].sql).toContain('order by "createdAt" asc, "id" asc');
    });

    it("only reads it — the organization table is BetterAuth's to write", async () => {
      database.answers({ rows: [] });
      await keys.organizationIds();

      expect(database.statements[0].sql.startsWith("select")).toBe(true);
    });
  });
});
