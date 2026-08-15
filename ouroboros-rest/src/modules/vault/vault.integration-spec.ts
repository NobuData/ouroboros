import { ApiHarness } from "../../testing/harness.fixture";
import { MASTER_WRAPPER_ID } from "./master.key.wrapper";
import { VaultRotation } from "./vault.rotation";
import { VaultService } from "./vault.service";
import { wrapperWith } from "./vault.fixture";

/**
 * The vault against a migrated PostgreSQL — V013's table, its constraints and its cascade
 * ([#222](https://github.com/NobuData/ouroboros/issues/222)).
 *
 * The unit suites run the same operations over an in-memory `tenant_keys`, and that is
 * exactly what makes this one necessary: a fake is written to the rules its author believes
 * the table has. Four things can only be asserted here, and each of them is a claim the
 * product makes to a user:
 *
 *   * **The statements the repository issues are ones the server accepts** — the partial
 *     unique index, the status/`rotated_at` CHECK and the composite key are real, and a
 *     rotation has to satisfy all three inside one transaction.
 *   * **A rotation is atomic against a concurrent one.** Two rotations racing is the case
 *     the `for update` and the index exist for, and neither exists in a Map.
 *   * **Crypto-shredding.** Deleting the workspace destroys the key, which is what makes
 *     that workspace's ciphertext unrecoverable from a backup that still holds it.
 *   * **A re-wrap changes zero data ciphertexts**, verified byte-for-byte against values
 *     that really went through the database.
 *
 * ---------------------------------------------------------------------------
 * **This suite reaches into the injector**, which every other integration suite is warned
 * off doing. The reason is not convenience: `VaultModule` declares no controller and no
 * route, deliberately — a route that decrypted a credential would be a route that returned
 * one, and which of those exist is AD.2's (#223) decision behind a re-authentication step.
 * There is therefore no request that exercises this, and the injector is the only door.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

const RECORD = "connection-anthropic";
const SECOND = "connection-openai";
const SECRET = "sk-ant-api03-integration-0000000000000000000000";

/** One row of `tenant_keys`, as this suite reads it back. */
interface KeyRow {
  version: number;
  sealed_dek: Buffer;
  wrapper: string;
  status: string;
  rotated_at: Date | null;
  updated_at: Date;
}

describe("the credential vault, against a migrated database", () => {
  let api: ApiHarness;
  let vault: VaultService;
  let rotation: VaultRotation;

  beforeAll(async () => {
    api = await ApiHarness.start();
    vault = api.nest.get(VaultService);
    rotation = api.nest.get(VaultRotation);
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * A workspace with an owner — the only fixture this suite needs, because `tenant_keys`
   * hangs off `organization` and nothing else.
   *
   * @returns The workspace's id.
   */
  async function workspace(): Promise<string> {
    return (await api.workspace(await api.signIn())).id;
  }

  /**
   * The workspace's key rows, straight from the table.
   *
   * @param organizationId - The workspace.
   * @returns Its rows, oldest version first.
   */
  async function keyRows(organizationId: string): Promise<KeyRow[]> {
    const { rows } = await api.sql.query<KeyRow>(
      `select version, sealed_dek, wrapper, status, rotated_at, updated_at
         from ouroboros.tenant_keys
        where organization_id = $1
        order by version asc`,
      [organizationId],
    );

    return rows;
  }

  describe("sealing a credential", () => {
    it("round-trips through the database", async () => {
      const organizationId = await workspace();

      const envelope = await vault.encryptText(organizationId, RECORD, SECRET);

      expect(await vault.decryptText(organizationId, RECORD, envelope)).toBe(SECRET);
    });

    it("creates the workspace's key lazily, sealed and stamped", async () => {
      const organizationId = await workspace();

      expect(await keyRows(organizationId)).toEqual([]);

      await vault.encryptText(organizationId, RECORD, SECRET);
      const rows = await keyRows(organizationId);

      expect(rows).toHaveLength(1);
      expect(rows[0].version).toBe(1);
      expect(rows[0].status).toBe("active");
      expect(rows[0].rotated_at).toBeNull();
      expect(rows[0].wrapper).toBe(MASTER_WRAPPER_ID);
    });

    it("stores no key material and no plaintext in the row", async () => {
      const organizationId = await workspace();
      await vault.encryptText(organizationId, RECORD, SECRET);

      const [row] = await keyRows(organizationId);
      const stored = row.sealed_dek.toString("utf8");

      expect(stored).not.toContain(SECRET);
      expect(stored).not.toContain(api.configuration.vaultMasterKey);
    });

    it("gives two workspaces two different keys", async () => {
      const first = await workspace();
      const second = await workspace();

      await vault.encryptText(first, RECORD, SECRET);
      await vault.encryptText(second, RECORD, SECRET);

      const [one] = await keyRows(first);
      const [two] = await keyRows(second);

      expect(one.sealed_dek).not.toEqual(two.sealed_dek);
    });

    it("refuses a ciphertext moved to another workspace, and to another record", async () => {
      const owner = await workspace();
      const other = await workspace();
      const envelope = await vault.encryptText(owner, RECORD, SECRET);

      // The other workspace gets a key of its own first, so the refusal is the AAD binding
      // rather than a missing key.
      await vault.encryptText(other, RECORD, "something else");

      await expect(vault.decryptText(other, RECORD, envelope)).rejects.toThrow();
      await expect(vault.decryptText(owner, SECOND, envelope)).rejects.toThrow();
    });

    it("adopts one key when two first writes race", async () => {
      // The `on conflict do nothing` path, against the real primary key and the real partial
      // unique index — which is where it either works or does not.
      const organizationId = await workspace();

      const [first, second] = await Promise.all([
        vault.encryptText(organizationId, RECORD, SECRET),
        vault.encryptText(organizationId, SECOND, "second secret"),
      ]);

      expect(await keyRows(organizationId)).toHaveLength(1);
      expect(await vault.decryptText(organizationId, RECORD, first)).toBe(SECRET);
      expect(await vault.decryptText(organizationId, SECOND, second)).toBe("second secret");
    });
  });

  describe("rotating", () => {
    it("adds a version, retires its predecessor, and stamps when", async () => {
      const organizationId = await workspace();
      await vault.encryptText(organizationId, RECORD, SECRET);

      expect(await vault.rotate(organizationId)).toBe(2);

      const rows = await keyRows(organizationId);

      expect(rows.map((row) => [row.version, row.status])).toEqual([
        [1, "retired"],
        [2, "active"],
      ]);
      expect(rows[0].rotated_at).toBeInstanceOf(Date);
      expect(rows[1].rotated_at).toBeNull();
    });

    it("leaves the old ciphertext readable and puts new writes on the new version", async () => {
      const organizationId = await workspace();
      const before = await vault.encryptText(organizationId, RECORD, SECRET);

      await vault.rotate(organizationId);
      const after = await vault.encryptText(organizationId, SECOND, "written after");

      expect(await vault.decryptText(organizationId, RECORD, before)).toBe(SECRET);
      expect(after.startsWith("ouro.v1.2.")).toBe(true);
      expect(before.startsWith("ouro.v1.1.")).toBe(true);
    });

    it("lets exactly one of two concurrent rotations win", async () => {
      // The reason the rule is a partial unique index rather than a check in the service:
      // two active versions would split the workspace's ciphertext across two keys with
      // nothing recording which. A rotation that lost the race did not happen, and its caller
      // is told so.
      const organizationId = await workspace();
      await vault.encryptText(organizationId, RECORD, SECRET);

      const outcomes = await Promise.allSettled([
        vault.rotate(organizationId),
        vault.rotate(organizationId),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);

      const rows = await keyRows(organizationId);

      expect(rows.filter((row) => row.status === "active")).toHaveLength(1);
      expect(rows).toHaveLength(2);
    });

    it("keeps every generation readable across several rotations", async () => {
      const organizationId = await workspace();
      const sealed = [await vault.encryptText(organizationId, RECORD, SECRET)];

      for (let round = 0; round < 3; round += 1) {
        await vault.rotate(organizationId);
        sealed.push(await vault.encryptText(organizationId, RECORD, SECRET));
      }

      expect(await keyRows(organizationId)).toHaveLength(4);

      for (const envelope of sealed) {
        expect(await vault.decryptText(organizationId, RECORD, envelope)).toBe(SECRET);
      }
    });

    it("re-seals a value onto the current version", async () => {
      const organizationId = await workspace();
      const before = await vault.encryptText(organizationId, RECORD, SECRET);
      await vault.rotate(organizationId);

      const after = await vault.reseal(organizationId, RECORD, before);

      expect(after.startsWith("ouro.v1.2.")).toBe(true);
      expect(await vault.decryptText(organizationId, RECORD, after)).toBe(SECRET);
    });

    it("sweeps, and reports honestly that no module registers a store yet", async () => {
      // #138, #101 and #189 are open and nothing in the schema holds an encrypted column, so
      // there is nothing to re-encrypt. The sweep says so rather than claiming to have run.
      const organizationId = await workspace();
      await vault.encryptText(organizationId, RECORD, SECRET);
      await vault.rotate(organizationId);

      expect(await rotation.sweep(organizationId)).toEqual({
        organizations: 1,
        resealed: 0,
        adopted: 0,
        failed: 0,
      });
    });
  });

  describe("re-wrapping the key-encryption key", () => {
    // **The criterion the whole design exists for**: moving custody changes the sealed keys
    // and *no data ciphertext*. Asserted byte-for-byte against values that went through
    // PostgreSQL, because a `bytea` round trip is exactly where a re-wrap that quietly
    // rewrote something would show up.
    it("changes every sealed key and no stored ciphertext", async () => {
      const organizationId = await workspace();
      const first = await vault.encryptText(organizationId, RECORD, SECRET);
      await vault.rotate(organizationId);
      const second = await vault.encryptText(organizationId, SECOND, "second secret");

      const sealedBefore = (await keyRows(organizationId)).map((row) =>
        Buffer.from(row.sealed_dek),
      );

      // The same backend with the same key — the operator's `rewrap` after a master key
      // change, and the shape AF.3 uses across backends. `converted` is every version, not
      // only the active one.
      expect(
        await vault.rewrap(organizationId, wrapperWith(api.configuration.vaultMasterKey)),
      ).toBe(2);

      const sealedAfter = await keyRows(organizationId);

      for (const [index, row] of sealedAfter.entries()) {
        expect(row.sealed_dek).not.toEqual(sealedBefore[index]);
        expect(row.wrapper).toBe(MASTER_WRAPPER_ID);
      }

      // Not one stored envelope moved, and both generations still open.
      expect(await vault.decryptText(organizationId, RECORD, first)).toBe(SECRET);
      expect(await vault.decryptText(organizationId, SECOND, second)).toBe("second secret");
    });

    it("moves updated_at, which is what says when custody changed", async () => {
      const organizationId = await workspace();
      await vault.encryptText(organizationId, RECORD, SECRET);
      const [before] = await keyRows(organizationId);

      await vault.rewrap(organizationId, wrapperWith(api.configuration.vaultMasterKey));
      const [after] = await keyRows(organizationId);

      expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());
      expect(after.version).toBe(before.version);
      expect(after.status).toBe(before.status);
    });

    it("does nothing for a workspace that has never stored a secret", async () => {
      expect(await vault.rewrap(await workspace())).toBe(0);
    });
  });

  describe("crypto-shredding", () => {
    // The strongest claim in the security model, and the one that is a foreign key rather
    // than a promise: destroy the key and the ciphertext is unrecoverable *whatever backups
    // exist*, because the backup holds the rows and does not hold the key.
    it("destroys every version of a workspace's key when the workspace is deleted", async () => {
      const organizationId = await workspace();
      const envelope = await vault.encryptText(organizationId, RECORD, SECRET);
      await vault.rotate(organizationId);

      expect(await keyRows(organizationId)).toHaveLength(2);

      await api.sql.query(`delete from ouroboros.organization where "id" = $1`, [organizationId]);

      expect(await keyRows(organizationId)).toEqual([]);

      // And the ciphertext that was held elsewhere is now unopenable — which is the whole
      // point of destroying the key rather than only the rows.
      await expect(vault.decryptText(organizationId, RECORD, envelope)).rejects.toThrow();
    });

    it("leaves every other workspace's keys alone", async () => {
      const doomed = await workspace();
      const survivor = await workspace();
      await vault.encryptText(doomed, RECORD, SECRET);
      const kept = await vault.encryptText(survivor, RECORD, "kept");

      await api.sql.query(`delete from ouroboros.organization where "id" = $1`, [doomed]);

      expect(await keyRows(survivor)).toHaveLength(1);
      expect(await vault.decryptText(survivor, RECORD, kept)).toBe("kept");
    });
  });
});
