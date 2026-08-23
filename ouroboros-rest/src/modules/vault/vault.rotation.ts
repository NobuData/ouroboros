/**
 * What finishes a rotation, and what performs the one-time migration — the same job, because
 * they are the same operation.
 *
 * `VaultService.rotate` makes a new key version active and returns. That leaves every value
 * sealed under the old version still sealed under it, still readable, and still counting the
 * old key as in use. Two things move them across, and this file owns both:
 *
 *   * **Lazily, on write.** A consumer that is updating a record anyway calls
 *     `VaultService.reseal`, and that record is current from then on. This costs nothing and
 *     covers whatever the product happens to touch.
 *   * **By sweep**, here, for everything the product does not touch. A credential that is
 *     working is a credential nobody edits, so without this the old key stays in use
 *     indefinitely — which makes "rotate the key" a thing that never actually finishes.
 *
 * The **one-time migration job** the issue asks for is the same sweep with one extra input:
 * a record whose stored secret is not one of this service's envelopes at all. It is adopted
 * — sealed for the first time — rather than re-sealed. One code path, because a migration
 * that had its own path would be a second implementation of the operation that matters,
 * exercised once and then never again.
 *
 * ---------------------------------------------------------------------------
 * **What is registered today, and that is stated rather than implied.**
 *
 * {@link VAULT_SECRET_STORES} holds one store: `registry/registry.secrets.ts`, over V015's
 * `provider_connections.credentials_encrypted` — Y.1
 * ([#189](https://github.com/NobuData/ouroboros/issues/189)), the first migration in
 * `ouroboros-db` to declare an encrypted column. Q.1
 * ([#138](https://github.com/NobuData/ouroboros/issues/138)) and K.3
 * ([#101](https://github.com/NobuData/ouroboros/issues/101)) are still open and register
 * theirs the same way.
 *
 * A store is registered **with the migration that creates its column** rather than with the
 * first thing that writes a value into it. Nothing stores a provider credential yet — AD.2
 * ([#223](https://github.com/NobuData/ouroboros/issues/223)) owns that lifecycle — and the
 * store is here anyway, because {@link VaultRotation.rotate} retires the old key version once
 * the sweep reports nothing left on it: a sealed column the sweep cannot see is not an inert
 * gap, it is a rotation that reports success while leaving ciphertext on a key nobody knows
 * is still in use.
 *
 * Until V015 this shipped as a seam with an empty array behind it, proved by a fake store in
 * `vault.rotation.spec.ts`. The alternative then — inventing a placeholder encrypted column
 * so the job would have something to do — would have made the acceptance criterion
 * demonstrable by adding schema nobody asked for, which was a worse trade than saying what
 * was true.
 *
 * ---------------------------------------------------------------------------
 * **The sweep runs detached, and there is no scheduler.** `ouroboros-rest` has no periodic
 * work anywhere and no `@nestjs/schedule` dependency, and acquiring one so that a sweep can
 * run every hour in every process — including the ones running tests — is a larger change
 * than this ticket. So {@link VaultRotation.rotate} starts the sweep without awaiting it: a
 * rotation returns as soon as the new key is active, and the re-encryption happens behind
 * it. {@link VaultRotation.sweep} is public and awaitable, which is what the tests use and
 * what AD.2's endpoint will use when it wants to report progress.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";

import { isEnvelope } from "./envelope";
import { VaultRepository } from "./vault.repository";
import { VaultService } from "./vault.service";

/**
 * The Nest token every module holding encrypted secrets registers itself under.
 *
 * A multi-provider array rather than a registry with an `add` method: the set of stores is
 * fixed when the application is built, so it should be a wiring decision visible in a
 * module's `providers` list rather than a side effect of something having been imported.
 */
export const VAULT_SECRET_STORES = "VAULT_SECRET_STORES";

/**
 * The version a workspace with **no key at all** reports to a store.
 *
 * Zero is not a version `ouroboros.tenant_keys` can hold — its CHECK starts at one — and
 * that is what makes it usable here: every record a store holds is "not sealed on version
 * zero", which is exactly true of a workspace that has never had a key. A store's
 * {@link VaultSecretStore.pending} therefore needs no special case for it.
 */
export const NO_VERSION = 0;

/**
 * One record holding one secret, as a store reports it to the sweep.
 *
 * `sealed` is what makes this interface serve both jobs — see this file's header.
 */
export interface VaultSecretRecord {
  /**
   * What the secret is attached to, and half of the AAD binding.
   *
   * Must be exactly the value the store passed to `VaultService.encrypt`, and must go on
   * being that value: it is authenticated, so a record id that changes makes the record
   * permanently unreadable. A primary key is the only safe choice.
   */
  readonly recordId: string;

  /**
   * The secret as it is stored right now.
   *
   * An envelope when `sealed` is true, and whatever the record held before this service
   * existed when it is false.
   */
  readonly secret: string;

  /**
   * Whether {@link secret} is one of this service's envelopes.
   *
   * `true` — re-seal it onto the current key version. `false` — **adopt** it: this record
   * has never been through the vault, and the sweep seals its plaintext for the first time.
   * The store decides, because only the store knows what its column used to hold; `isEnvelope`
   * is available for the common case where the answer is "look at it".
   */
  readonly sealed: boolean;
}

/**
 * A module that stores secrets the vault sealed, seen from the sweep's side.
 *
 * Two methods, and both are deliberately about *one workspace at a time*: a sweep that
 * loaded every record in the installation would hold every credential in the product in
 * memory at once, which is the one thing this service exists to avoid.
 */
export interface VaultSecretStore {
  /**
   * How this store is named in logs and in the sweep's report. Not an identifier anything
   * looks up — a human-readable name, like `provider_connections`.
   */
  readonly name: string;

  /**
   * The records of one workspace that are not sealed on `version`.
   *
   * Includes records that are not sealed at all — those are the migration's, and omitting
   * them is how a store ends up permanently holding a plaintext nobody notices.
   *
   * @param organizationId - The workspace.
   * @param version - The key version everything should end up on.
   * @returns The records needing work. Empty is the expected steady state.
   */
  pending(organizationId: string, version: number): Promise<readonly VaultSecretRecord[]>;

  /**
   * Store a record's new envelope, replacing whatever was there.
   *
   * Called once per record, after the vault has produced the new value. A store whose write
   * is conditional on the record not having changed underneath is welcome to make this a
   * no-op and report it as such — the sweep will find the record again next time, which is
   * the right outcome for a record somebody else just rewrote.
   *
   * @param record - The record, as {@link pending} reported it.
   * @param envelope - The new envelope, on the current key version.
   */
  store(record: VaultSecretRecord, envelope: string): Promise<void>;
}

/**
 * What one sweep did. Counts only — never a record's contents.
 *
 * Returned rather than logged, so a caller can decide what to say. The sweep does log a
 * summary, because a job started detached has nowhere else to report.
 */
export interface VaultSweepReport {
  /** How many workspaces were visited. */
  readonly organizations: number;
  /** Records re-sealed from an older key version onto the current one. */
  readonly resealed: number;
  /** Records sealed for the first time — the one-time migration's count. */
  readonly adopted: number;
  /**
   * Records that could not be converted.
   *
   * Non-zero means the sweep did **not** finish its job, and the old key version is still in
   * use. Each failure is logged with its store and record id, and the sweep continues: one
   * unreadable record must not stop the other thousand from moving.
   */
  readonly failed: number;
}

@Injectable()
export class VaultRotation {
  /** Where a sweep reports. Named per Nest. */
  private readonly logger = new Logger(VaultRotation.name);

  /**
   * @param vault - The crypto and the keys.
   * @param keys - Statements against `ouroboros.tenant_keys`, for enumerating workspaces.
   * @param stores - Every module holding sealed secrets. **Empty today** — see this file's
   *   header.
   */
  constructor(
    private readonly vault: VaultService,
    private readonly keys: VaultRepository,
    @Inject(VAULT_SECRET_STORES) private readonly stores: readonly VaultSecretStore[],
  ) {}

  /**
   * Rotate a workspace's key and start re-encrypting behind it.
   *
   * The public entry point for a rotation: the new version is active when this resolves, and
   * the sweep that moves existing records onto it runs detached. A caller that wants to know
   * when the re-encryption is *done* — a test, or AD.2 reporting progress — awaits
   * {@link sweep} instead of relying on this.
   *
   * @param organizationId - The workspace.
   * @returns The new active version number, as soon as it is active.
   */
  async rotate(organizationId: string): Promise<number> {
    const version = await this.vault.rotate(organizationId);

    // Detached on purpose — see this file's header. `void` plus a `catch` rather than a bare
    // call: an unhandled rejection from a background job takes the process down, and a sweep
    // that failed must not do that to the request that triggered it or to anything else.
    void this.sweep(organizationId).catch((error: unknown) => {
      this.logger.error(
        `vault: the re-encryption sweep for workspace ${organizationId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });

    return version;
  }

  /**
   * Re-encrypt one workspace's records onto its current key version.
   *
   * Also the migration: a record the store reports as unsealed is adopted rather than
   * re-sealed. Safe to run at any time and safe to run twice — a workspace with nothing
   * pending does one query per store and reports zeros.
   *
   * @param organizationId - The workspace.
   * @returns What it did.
   */
  async sweep(organizationId: string): Promise<VaultSweepReport> {
    if (this.stores.length === 0) {
      // Not an error and not a warning: no module holds sealed secrets yet, and the honest
      // report for that is zeros. #138, #101 and #189 are what change it.
      return { organizations: 1, resealed: 0, adopted: 0, failed: 0 };
    }

    // The workspace's current version, read rather than ensured. `VaultService.activeVersion`
    // would *create* a key for a workspace that has none, and `sweepAll` visits every
    // workspace in the installation — so using it here would hand a key to every workspace
    // that has never stored a secret, which is key material with no purpose that every backup
    // would then carry. {@link NO_VERSION} is what a workspace with no key reports, and every
    // record a store holds is pending against it, which is exactly right: nothing can be
    // sealed on a key that does not exist. A key is created only if there turns out to be
    // something to seal, by the encrypt below.
    const version = (await this.keys.activeKey(organizationId))?.version ?? NO_VERSION;
    let resealed = 0;
    let adopted = 0;
    let failed = 0;

    for (const store of this.stores) {
      const pending = await store.pending(organizationId, version);

      for (const record of pending) {
        try {
          const envelope = record.sealed
            ? await this.vault.reseal(organizationId, record.recordId, record.secret)
            : await this.vault.encryptText(organizationId, record.recordId, record.secret);

          await store.store(record, envelope);

          if (record.sealed) {
            resealed += 1;
          } else {
            adopted += 1;
          }
        } catch (error: unknown) {
          // Identifiers only. The record's contents are exactly what must not reach a log,
          // and `VaultError`'s messages are written to carry none — see `vault.errors.ts`.
          failed += 1;
          this.logger.warn(
            `vault: ${store.name} record ${record.recordId} in workspace ${organizationId} ` +
              `could not be re-encrypted: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    if (resealed + adopted + failed > 0) {
      // Re-read rather than reporting `version`: a workspace that started at NO_VERSION has a
      // key by now, and a log line saying "swept onto key version 0" would be a number that
      // does not exist.
      const current = (await this.keys.activeKey(organizationId))?.version ?? version;

      this.logger.log(
        `vault: workspace ${organizationId} swept onto key version ${current.toString()} — ` +
          `${resealed.toString()} re-encrypted, ${adopted.toString()} adopted, ${failed.toString()} failed`,
      );
    }

    return { organizations: 1, resealed, adopted, failed };
  }

  /**
   * Sweep every workspace in the installation — the one-time migration job.
   *
   * Iterates `organization` rather than `tenant_keys`, and the difference is the whole point:
   * a workspace holding secrets this service never sealed has **no** key row yet, so a job
   * driven from `tenant_keys` would skip precisely the workspaces the migration exists for.
   *
   * One workspace at a time, sequentially. A concurrent version would finish sooner and would
   * hold several workspaces' plaintext in memory at once; this job runs once and is not in
   * anybody's way.
   *
   * @returns The totals across every workspace.
   */
  async sweepAll(): Promise<VaultSweepReport> {
    const organizationIds = await this.keys.organizationIds();
    let resealed = 0;
    let adopted = 0;
    let failed = 0;

    for (const organizationId of organizationIds) {
      const report = await this.sweep(organizationId);
      resealed += report.resealed;
      adopted += report.adopted;
      failed += report.failed;
    }

    this.logger.log(
      `vault: swept ${organizationIds.length.toString()} workspaces — ${resealed.toString()} ` +
        `re-encrypted, ${adopted.toString()} adopted, ${failed.toString()} failed`,
    );

    return { organizations: organizationIds.length, resealed, adopted, failed };
  }

  /**
   * Does this stored value look like something the vault sealed?
   *
   * Re-exported from `envelope.ts` so a store implementing {@link VaultSecretStore.pending}
   * can answer its `sealed` question without importing the crypto module — which keeps the
   * dependency a consumer takes on the vault to this one file.
   *
   * @param value - A stored secret, of unknown provenance.
   * @returns `true` when it is one of this service's envelopes.
   */
  static isSealed(value: string): boolean {
    return isEnvelope(value);
  }
}
