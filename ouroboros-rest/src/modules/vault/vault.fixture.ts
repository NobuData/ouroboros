/**
 * A vault with a real `KeyWrapper`, real cryptography and an in-memory `tenant_keys`.
 *
 * The vault's acceptance criteria are almost all about *bytes* — a flipped bit fails
 * authentication, a ciphertext moved between workspaces fails, a re-wrap changes no data
 * ciphertext — and none of them is about SQL. Running them against the recording database
 * would mean queueing an answer per statement in the order the service happens to issue
 * them, which makes every spec a test of the call order rather than of the property. So the
 * statements are stood in for here, and `vault.repository.spec.ts` is what holds the SQL to
 * account.
 *
 * **The crypto is not stood in for.** {@link inMemoryVault} builds the real
 * `MasterKeyWrapper` over a real 32-byte key and the real `VaultService`, so what these
 * suites exercise is the cipher, the nonce, the AAD and the envelope exactly as a deployment
 * would. A fake wrapper would make the tamper and binding tests assertions about the fake.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import { randomBytes } from "node:crypto";

import type { AppConfigService } from "../config/config.service";
import type { NewTenantKey, TenantKey } from "../db/schema";
import { KEY_BYTES } from "./envelope";
import { MasterKeyWrapper } from "./master.key.wrapper";
import { FIRST_VERSION, type VaultRepository } from "./vault.repository";
import { VaultRotation, type VaultSecretRecord, type VaultSecretStore } from "./vault.rotation";
import { VaultService } from "./vault.service";

/** A workspace id, shaped like BetterAuth's — text, and opaque. */
export const WORKSPACE = "org-vault-fixture";

/** A second workspace, for the cross-tenant assertions. */
export const OTHER_WORKSPACE = "org-vault-fixture-other";

/**
 * Build a valid master key.
 *
 * @param fill - Byte to fill it with, so two calls with different fills are two different
 *   keys — which is what the re-wrap assertions need.
 * @returns 32 bytes, base64, exactly as `OURO_VAULT_MASTER_KEY` is written.
 */
export function masterKey(fill = 7): string {
  return Buffer.alloc(KEY_BYTES, fill).toString("base64");
}

/**
 * A `MasterKeyWrapper` over a given key, without a Nest container.
 *
 * @param key - The base64 key, from {@link masterKey}.
 * @returns The wrapper.
 */
export function wrapperWith(key: string): MasterKeyWrapper {
  return new MasterKeyWrapper({ vaultMasterKey: key } as unknown as AppConfigService);
}

/**
 * `ouroboros.tenant_keys`, in a Map.
 *
 * Every rule the migration enforces is enforced here too — one active version per workspace,
 * versions from 1, `rotated_at` set exactly when a row is retired — because a fake that was
 * more permissive than the table would let a service bug pass here and fail in production.
 * `vault.integration-spec.ts` runs the same operations against the real table.
 */
export class FakeTenantKeys {
  /** Keyed `organizationId version`, which is what the composite primary key is. */
  private readonly rows = new Map<string, TenantKey>();

  /** Every workspace `organizationIds()` should report, in insertion order. */
  readonly organizations: string[] = [WORKSPACE, OTHER_WORKSPACE];

  /**
   * @param organizationId - The workspace.
   * @param version - The key version.
   * @returns The map key for that row.
   */
  private static at(organizationId: string, version: number): string {
    return `${organizationId} ${version.toString()}`;
  }

  /**
   * Every row, for an assertion about what the table holds.
   *
   * @returns The rows, in no particular order.
   */
  all(): TenantKey[] {
    return [...this.rows.values()];
  }

  /**
   * Put a row in exactly as given, bypassing the service.
   *
   * What restoring a `tenant_keys` dump into a differently-configured deployment does, and
   * the only way to set up the re-wrap cases: those need a workspace's *retired* versions
   * present as well as its active one, and `createFirstVersion` deliberately refuses to
   * create a second row.
   *
   * @param row - The row, stamps and status included.
   */
  seed(row: TenantKey): void {
    this.rows.set(FakeTenantKeys.at(row.organization_id, row.version), { ...row });
  }

  /** @see VaultRepository.activeKey */
  activeKey(organizationId: string): Promise<TenantKey | undefined> {
    return Promise.resolve(
      [...this.rows.values()].find(
        (row) => row.organization_id === organizationId && row.status === "active",
      ),
    );
  }

  /** @see VaultRepository.keyAt */
  keyAt(organizationId: string, version: number): Promise<TenantKey | undefined> {
    return Promise.resolve(this.rows.get(FakeTenantKeys.at(organizationId, version)));
  }

  /** @see VaultRepository.allKeys */
  allKeys(organizationId: string): Promise<TenantKey[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.organization_id === organizationId)
        .sort((left, right) => left.version - right.version),
    );
  }

  /**
   * @see VaultRepository.createFirstVersion
   *
   * `on conflict do nothing` and then a re-read, modelled exactly — the insert is *skipped*
   * when a row is already there and the caller is handed whatever is stored, rather than
   * being handed the row it tried to write. The distinction is the whole of the concurrent
   * first-write case: a fake that returned the caller's own row would let both racing
   * requests seal with their own key while the table kept only one, and the second request's
   * ciphertext would be unreadable from the moment it was written.
   */
  createFirstVersion(key: NewTenantKey): Promise<TenantKey> {
    const at = FakeTenantKeys.at(key.organization_id, FIRST_VERSION);

    if (!this.rows.has(at)) {
      this.insert(key.organization_id, FIRST_VERSION, key.sealed_dek, key.wrapper);
    }

    return this.activeKey(key.organization_id) as Promise<TenantKey>;
  }

  /** @see VaultRepository.rotate */
  async rotate(
    organizationId: string,
    seal: (version: number) => Promise<Pick<NewTenantKey, "sealed_dek" | "wrapper">>,
  ): Promise<TenantKey> {
    const current = await this.activeKey(organizationId);

    if (current === undefined) {
      throw new Error(
        `vault: workspace ${organizationId} has no active key to rotate — it has never stored a secret`,
      );
    }

    const version = current.version + 1;
    const sealed = await seal(version);

    this.rows.set(FakeTenantKeys.at(organizationId, current.version), {
      ...current,
      status: "retired",
      rotated_at: new Date(),
    });

    return this.insert(organizationId, version, sealed.sealed_dek, sealed.wrapper);
  }

  /** @see VaultRepository.replaceSeal */
  replaceSeal(
    organizationId: string,
    version: number,
    sealed: Pick<NewTenantKey, "sealed_dek" | "wrapper">,
  ): Promise<TenantKey> {
    const row = this.rows.get(FakeTenantKeys.at(organizationId, version));

    if (row === undefined) {
      throw new Error(`vault: no key at version ${version.toString()}`);
    }

    const updated: TenantKey = {
      ...row,
      sealed_dek: sealed.sealed_dek,
      wrapper: sealed.wrapper,
      updated_at: new Date(),
    };

    this.rows.set(FakeTenantKeys.at(organizationId, version), updated);
    return Promise.resolve(updated);
  }

  /** @see VaultRepository.organizationIds */
  organizationIds(): Promise<string[]> {
    return Promise.resolve([...this.organizations]);
  }

  /**
   * Add a row, with the trigger-owned stamps the table would have written.
   *
   * @param organizationId - The workspace.
   * @param version - The version.
   * @param sealedDek - The sealed key material.
   * @param wrapper - Which wrapper sealed it.
   * @returns The stored row.
   */
  private insert(
    organizationId: string,
    version: number,
    sealedDek: NewTenantKey["sealed_dek"],
    wrapper: NewTenantKey["wrapper"],
  ): TenantKey {
    const row: TenantKey = {
      organization_id: organizationId,
      version,
      sealed_dek: sealedDek,
      wrapper: wrapper,
      status: "active",
      rotated_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    this.rows.set(FakeTenantKeys.at(organizationId, version), row);
    return row;
  }
}

/**
 * A {@link VaultSecretStore} holding records in memory — the stand-in for #138, #101 and
 * #189, which have not landed.
 *
 * It is the seam's proof: the sweep and the one-time migration are exercised against a store
 * that behaves the way a real one will, including the two states the interface distinguishes
 * — a record already sealed on an older version, and a record never sealed at all.
 */
export class FakeSecretStore implements VaultSecretStore {
  /**
   * What the store holds, keyed by workspace *and* record.
   *
   * Scoped by workspace like a real one, and not merely for tidiness: a store that reported
   * every workspace's records to every workspace would make `sweepAll` try to re-seal one
   * tenant's ciphertext under another's key, which the AAD binding then refuses — a failure
   * the fixture would have invented rather than found.
   */
  private readonly rows = new Map<string, VaultSecretRecord>();

  /** Record ids this store refuses to write, to exercise the sweep's failure isolation. */
  readonly unwritable = new Set<string>();

  /**
   * @param name - How the store is named in the sweep's log lines.
   */
  constructor(readonly name = "fake_secrets") {}

  /**
   * @param organizationId - The workspace.
   * @param recordId - The record.
   * @returns The map key for that record.
   */
  private static at(organizationId: string, recordId: string): string {
    return `${organizationId} ${recordId}`;
  }

  /**
   * Put a record in, as it is stored before the sweep sees it.
   *
   * @param organizationId - The workspace it belongs to.
   * @param recordId - The record.
   * @param secret - Its stored secret — an envelope, or plaintext for a record to adopt.
   * @param sealed - Whether `secret` is one of the vault's envelopes.
   */
  put(organizationId: string, recordId: string, secret: string, sealed: boolean): void {
    this.rows.set(FakeSecretStore.at(organizationId, recordId), { recordId, secret, sealed });
  }

  /**
   * What the store holds for one record now, for an assertion.
   *
   * @param organizationId - The workspace.
   * @param recordId - The record.
   * @returns The record, or `undefined`.
   */
  get(organizationId: string, recordId: string): VaultSecretRecord | undefined {
    return this.rows.get(FakeSecretStore.at(organizationId, recordId));
  }

  /** @see VaultSecretStore.pending */
  pending(organizationId: string, version: number): Promise<readonly VaultSecretRecord[]> {
    return Promise.resolve(
      [...this.rows.entries()]
        .filter(([at]) => at.startsWith(`${organizationId} `))
        .map(([, record]) => record)
        .filter(
          (record) => !record.sealed || !record.secret.startsWith(`ouro.v1.${version.toString()}.`),
        ),
    );
  }

  /** @see VaultSecretStore.store */
  store(record: VaultSecretRecord, envelope: string): Promise<void> {
    if (this.unwritable.has(record.recordId)) {
      return Promise.reject(new Error(`fake store refuses to write ${record.recordId}`));
    }

    // The workspace is recovered from the existing entry, which is what a real store's own
    // primary key would give it.
    const at = [...this.rows.entries()].find(([, held]) => held === record)?.[0];

    if (at !== undefined) {
      this.rows.set(at, { recordId: record.recordId, secret: envelope, sealed: true });
    }

    return Promise.resolve();
  }
}

/** Everything a vault spec drives, wired together. */
export interface InMemoryVault {
  /** The service under test. */
  vault: VaultService;
  /** The rotation job over it. */
  rotation: VaultRotation;
  /** The stand-in `tenant_keys`, for assertions about what was stored. */
  keys: FakeTenantKeys;
  /** The configured wrapper — the same instance the service holds. */
  wrapper: MasterKeyWrapper;
  /** The stores the rotation sweeps. */
  stores: FakeSecretStore[];
}

/**
 * Build a working vault with no database and no Nest container.
 *
 * @param options - What to vary. `key` is the master key, so two vaults built with different
 *   keys are two custody backends; `stores` are what the rotation sweeps.
 * @returns The service, the rotation job, and the pieces to assert against.
 */
export function inMemoryVault(
  options: { key?: string; stores?: FakeSecretStore[] } = {},
): InMemoryVault {
  const keys = new FakeTenantKeys();
  const wrapper = wrapperWith(options.key ?? masterKey());
  const stores = options.stores ?? [];

  const vault = new VaultService(keys as unknown as VaultRepository, wrapper);
  const rotation = new VaultRotation(vault, keys as unknown as VaultRepository, stores);

  return { vault, rotation, keys, wrapper, stores };
}

/**
 * A random secret of a given size, for the round-trip cases.
 *
 * @param bytes - How many.
 * @returns The bytes.
 */
export function randomSecret(bytes = 48): Buffer {
  return randomBytes(bytes);
}
