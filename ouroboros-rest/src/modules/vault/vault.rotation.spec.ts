import { Logger } from "@nestjs/common";

import { parseEnvelope } from "./envelope";
import { REGISTERED_SECRET_STORES } from "./vault.module";
import { NO_VERSION, VaultRotation } from "./vault.rotation";
import {
  FakeSecretStore,
  OTHER_WORKSPACE,
  WORKSPACE,
  inMemoryVault,
  type InMemoryVault,
} from "./vault.fixture";

/**
 * The re-encrypt sweep, and the one-time migration — which are the same job.
 *
 * Two of [#222](https://github.com/NobuData/ouroboros/issues/222)'s criteria land here:
 * *the background sweep completes*, and *the migration job converts existing secrets from
 * the ad-hoc helper*. The second is exercised against a stand-in store, because the three
 * roadmaps that will register real ones — #138, #101 and #189 — are still open and nothing
 * in the database holds an encrypted column yet. That is asserted too, at the bottom of this
 * file: a test that the registry is empty is what makes the claim checkable rather than a
 * sentence in a pull request.
 */

const RECORD = "connection-anthropic";
const SECOND = "connection-openai";

/**
 * The sweep reports what it did, which is correct in a service and noise in a suite.
 *
 * Silenced rather than tolerated so that the two tests which *assert* on log output — the
 * failure line, and the detached sweep's error — are reading a sink nothing else is writing
 * to. `restoreMocks` puts the real logger back between tests.
 */
beforeEach(() => {
  jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
});

describe("sweeping a workspace onto its current key", () => {
  let store: FakeSecretStore;
  let vault: InMemoryVault;

  beforeEach(() => {
    store = new FakeSecretStore();
    vault = inMemoryVault({ stores: [store] });
  });

  /**
   * Seal a secret and register it with the store, the way a consumer would.
   *
   * @param recordId - The record.
   * @param secret - Its plaintext.
   * @returns The stored envelope.
   */
  async function store_(recordId: string, secret: string): Promise<string> {
    const envelope = await vault.vault.encryptText(WORKSPACE, recordId, secret);
    store.put(WORKSPACE, recordId, envelope, true);
    return envelope;
  }

  it("re-encrypts everything left on an older version", async () => {
    await store_(RECORD, "first secret");
    await store_(SECOND, "second secret");
    await vault.rotation.rotate(WORKSPACE);

    const report = await vault.rotation.sweep(WORKSPACE);

    expect(report).toEqual({ organizations: 1, resealed: 2, adopted: 0, failed: 0 });

    // `NO_VERSION` asks the store for everything it holds for the workspace, whatever version
    // it is on — which is what makes this an assertion about every record rather than about
    // the ones the sweep happened to touch.
    for (const record of await store.pending(WORKSPACE, NO_VERSION)) {
      expect(parseEnvelope(record.secret).version).toBe(2);
    }
  });

  it("leaves the values themselves unchanged", async () => {
    await store_(RECORD, "first secret");
    await vault.rotation.rotate(WORKSPACE);
    await vault.rotation.sweep(WORKSPACE);

    const swept = store.get(WORKSPACE, RECORD);

    expect(await vault.vault.decryptText(WORKSPACE, RECORD, swept?.secret ?? "")).toBe(
      "first secret",
    );
  });

  it("completes — a second sweep finds nothing to do", async () => {
    // "The background sweep completes" as something observable: after one pass, the workspace
    // has no record on an older version, so the old key has no readers left.
    await store_(RECORD, "first secret");
    await vault.rotation.rotate(WORKSPACE);

    await vault.rotation.sweep(WORKSPACE);
    const second = await vault.rotation.sweep(WORKSPACE);

    expect(second).toEqual({ organizations: 1, resealed: 0, adopted: 0, failed: 0 });
  });

  it("does nothing for a workspace whose records are already current", async () => {
    await store_(RECORD, "first secret");

    expect(await vault.rotation.sweep(WORKSPACE)).toEqual({
      organizations: 1,
      resealed: 0,
      adopted: 0,
      failed: 0,
    });
  });

  it("keeps going when one record cannot be converted, and says how many failed", async () => {
    // One unreadable record must not stop the other thousand from moving. A sweep that
    // aborted on the first failure would leave a rotation permanently unfinished for the
    // want of one broken row.
    await store_(RECORD, "first secret");
    await store_(SECOND, "second secret");
    store.unwritable.add(SECOND);
    await vault.rotation.rotate(WORKSPACE);

    const report = await vault.rotation.sweep(WORKSPACE);

    expect(report).toEqual({ organizations: 1, resealed: 1, adopted: 0, failed: 1 });
    expect(parseEnvelope(store.get(WORKSPACE, RECORD)?.secret ?? "").version).toBe(2);
    expect(parseEnvelope(store.get(WORKSPACE, SECOND)?.secret ?? "").version).toBe(1);
  });

  it("reports a failure without putting the record's secret in the log", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

    await store_(RECORD, "a secret nobody may log");
    store.unwritable.add(RECORD);
    await vault.rotation.rotate(WORKSPACE);
    await vault.rotation.sweep(WORKSPACE);

    const lines = warn.mock.calls.flat().join(" ");

    expect(lines).toContain(RECORD);
    expect(lines).toContain(WORKSPACE);
    expect(lines).not.toContain("a secret nobody may log");
  });

  it("sweeps every registered store, not only the first", async () => {
    const second = new FakeSecretStore("other_secrets");
    const both = inMemoryVault({ stores: [store, second] });

    store.put(WORKSPACE, RECORD, await both.vault.encryptText(WORKSPACE, RECORD, "one"), true);
    second.put(WORKSPACE, SECOND, await both.vault.encryptText(WORKSPACE, SECOND, "two"), true);
    await both.rotation.rotate(WORKSPACE);

    expect(await both.rotation.sweep(WORKSPACE)).toEqual({
      organizations: 1,
      resealed: 2,
      adopted: 0,
      failed: 0,
    });
  });
});

describe("the one-time migration", () => {
  // The other half of the same job: a record the store reports as *not sealed* is a value
  // from before this service existed, and the sweep seals it for the first time rather than
  // trying to re-seal something that is not an envelope.
  it("adopts a record this service has never sealed", async () => {
    const store = new FakeSecretStore();
    const vault = inMemoryVault({ stores: [store] });

    store.put(WORKSPACE, RECORD, "ghp_a-token-the-old-helper-encrypted", false);

    const report = await vault.rotation.sweep(WORKSPACE);

    expect(report).toEqual({ organizations: 1, resealed: 0, adopted: 1, failed: 0 });

    const adopted = store.get(WORKSPACE, RECORD);

    expect(adopted?.sealed).toBe(true);
    expect(await vault.vault.decryptText(WORKSPACE, RECORD, adopted?.secret ?? "")).toBe(
      "ghp_a-token-the-old-helper-encrypted",
    );
  });

  it("creates the workspace's key on the way, for a workspace that had none", async () => {
    const store = new FakeSecretStore();
    const vault = inMemoryVault({ stores: [store] });

    store.put(WORKSPACE, RECORD, "a plaintext credential", false);
    await vault.rotation.sweep(WORKSPACE);

    expect((await vault.keys.activeKey(WORKSPACE))?.version).toBe(1);
  });

  it("adopts and re-seals in the same pass", async () => {
    const store = new FakeSecretStore();
    const vault = inMemoryVault({ stores: [store] });

    store.put(
      WORKSPACE,
      RECORD,
      await vault.vault.encryptText(WORKSPACE, RECORD, "already ours"),
      true,
    );
    await vault.rotation.rotate(WORKSPACE);
    store.put(WORKSPACE, SECOND, "never sealed", false);

    expect(await vault.rotation.sweep(WORKSPACE)).toEqual({
      organizations: 1,
      resealed: 1,
      adopted: 1,
      failed: 0,
    });
  });

  it("visits every workspace, including those with no key", async () => {
    // Driven from `organization` rather than from `tenant_keys`, and this is why: a workspace
    // holding secrets this service never sealed has no key row, so a job driven the other way
    // would skip precisely the workspaces the migration exists for.
    const store = new FakeSecretStore();
    const vault = inMemoryVault({ stores: [store] });

    store.put(WORKSPACE, RECORD, "a plaintext credential", false);

    const report = await vault.rotation.sweepAll();

    expect(report.organizations).toBe(2);
    expect(report.adopted).toBe(1);
  });

  it("gives a key only to the workspaces that turn out to have something to seal", async () => {
    // `sweepAll` visits every workspace in the installation, and most of them have never
    // stored a secret. Creating a key for each on the way would fill `tenant_keys` with key
    // material that seals nothing and that every backup would carry from then on.
    const store = new FakeSecretStore();
    const vault = inMemoryVault({ stores: [store] });

    store.put(WORKSPACE, RECORD, "a plaintext credential", false);
    await vault.rotation.sweepAll();

    expect(vault.keys.all().map((row) => row.organization_id)).toEqual([WORKSPACE]);
    expect(await vault.keys.activeKey(OTHER_WORKSPACE)).toBeUndefined();
  });
});

describe("rotating through the job rather than the service", () => {
  it("returns as soon as the new version is active", async () => {
    const store = new FakeSecretStore();
    const vault = inMemoryVault({ stores: [store] });
    store.put(WORKSPACE, RECORD, await vault.vault.encryptText(WORKSPACE, RECORD, "before"), true);

    expect(await vault.rotation.rotate(WORKSPACE)).toBe(2);
    expect((await vault.keys.activeKey(WORKSPACE))?.version).toBe(2);
  });

  it("starts the sweep behind it rather than making the caller wait", async () => {
    // The sweep is detached: `rotate` does not await it. Draining the microtask queue is what
    // stands in for "a moment later", and the assertion is that the work happened without the
    // caller having asked for it.
    const store = new FakeSecretStore();
    const vault = inMemoryVault({ stores: [store] });
    store.put(WORKSPACE, RECORD, await vault.vault.encryptText(WORKSPACE, RECORD, "before"), true);

    await vault.rotation.rotate(WORKSPACE);
    await new Promise((resolve) => setImmediate(resolve));

    expect(parseEnvelope(store.get(WORKSPACE, RECORD)?.secret ?? "").version).toBe(2);
  });

  it("does not take the process down when the detached sweep fails", async () => {
    // An unhandled rejection from a background job kills the process. A sweep that failed
    // must not do that to the request that triggered it, or to anything else running.
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const store = new FakeSecretStore();
    const vault = inMemoryVault({ stores: [store] });

    store.put(WORKSPACE, RECORD, await vault.vault.encryptText(WORKSPACE, RECORD, "before"), true);
    jest.spyOn(store, "pending").mockRejectedValue(new Error("the store is unreachable"));

    await expect(vault.rotation.rotate(WORKSPACE)).resolves.toBe(2);
    await new Promise((resolve) => setImmediate(resolve));

    expect(error.mock.calls.flat().join(" ")).toContain("the store is unreachable");
  });
});

describe("what is registered today", () => {
  // The honest statement, as a test. #138, #101 and #189 are all open and no migration
  // declares an encrypted column, so there is nothing for the sweep to find — and this fails
  // the day one of them lands, which is when the sweep's behaviour needs a second look
  // rather than a green suite.
  it("registers no secret stores, because no module holds an encrypted secret yet", () => {
    expect(REGISTERED_SECRET_STORES).toEqual([]);
  });

  it("reports zeros rather than pretending to have swept", async () => {
    const empty = inMemoryVault();

    expect(await empty.rotation.sweep(WORKSPACE)).toEqual({
      organizations: 1,
      resealed: 0,
      adopted: 0,
      failed: 0,
    });
  });

  it("does not create a key for a workspace it has nothing to sweep", async () => {
    // A sweep over an empty registry must not be the thing that gives every workspace in the
    // installation a key it has no use for.
    const empty = inMemoryVault();
    await empty.rotation.sweepAll();

    expect(empty.keys.all()).toEqual([]);
  });
});

describe("telling a sealed value from one to adopt", () => {
  it("is re-exported so a store need not import the crypto module", () => {
    expect(VaultRotation.isSealed("ouro.v1.1.abc.def")).toBe(true);
    expect(VaultRotation.isSealed("ghp_a-plain-token")).toBe(false);
  });
});
