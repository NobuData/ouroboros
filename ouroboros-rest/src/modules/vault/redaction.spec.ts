import { Logger } from "@nestjs/common";

import { VaultRotation } from "./vault.rotation";
import {
  FakeSecretStore,
  OTHER_WORKSPACE,
  WORKSPACE,
  inMemoryVault,
  masterKey,
  wrapperWith,
  type InMemoryVault,
} from "./vault.fixture";

/**
 * The other half of [#222](https://github.com/NobuData/ouroboros/issues/222)'s last
 * criterion — *redaction tests confirm no plaintext secret reaches any log sink*.
 *
 * `no-secret-logging.mjs` is the lint rule, and it catches a developer *naming* a secret in
 * a log call. It cannot catch a secret that reaches a sink some other way: interpolated into
 * an error message by a library, carried in a rejected promise's `cause`, or written to
 * `console` by something this module called. So this suite captures **every** sink — Nest's
 * `Logger` and the `console` behind it — drives the vault through every operation it has,
 * including the failure paths, and then searches everything that was written for the values
 * that must never appear.
 *
 * Failure paths are the point. A happy path logs almost nothing; the lines that get written
 * while something is going wrong are the ones nobody reviews, and an error message that
 * quotes what it was given is the classic way a credential ends up in a log aggregator.
 *
 * The needles are chosen to be findable in every encoding a leak could take: the plaintext
 * itself, its base64, its base64url, and its hex.
 */

const RECORD = "connection-anthropic";
const SECOND = "connection-openai";

/** The credential. Distinctive enough that a substring search means something. */
const SECRET = "sk-ant-api03-MUSTNOTLEAK-0000000000000000000000";

/** The master key, in the encoding an operator sets and the encodings a leak could take. */
const MASTER = masterKey(0x5a);

/**
 * Every spelling of a value that would count as a leak.
 *
 * A log line holding the base64 of a credential has leaked the credential exactly as much as
 * one holding its bytes, and a `Buffer` interpolated into a template literal by mistake
 * renders as its UTF-8 — so all four are searched for rather than the obvious one.
 *
 * @param value - The plaintext.
 * @returns Its spellings, minus any that are empty.
 */
function spellings(value: string): string[] {
  const bytes = Buffer.from(value, "utf8");

  return [value, bytes.toString("base64"), bytes.toString("base64url"), bytes.toString("hex")];
}

/** A sink recorder: everything written anywhere, as one string. */
interface Sinks {
  /** Everything written, joined. */
  written(): string;
}

/**
 * Capture every log sink for the duration of a test.
 *
 * Both layers, because they are genuinely different holes: Nest's `Logger` is what this
 * module uses, and `console` is what a library underneath it would use. `process.stdout` is
 * not intercepted — the two above are what write to it, and replacing the stream would also
 * swallow Jest's own reporter.
 *
 * @returns The recorder.
 */
function captureSinks(): Sinks {
  const lines: unknown[] = [];
  const record = (...parts: unknown[]): undefined => {
    lines.push(...parts);
    return undefined;
  };

  for (const method of ["log", "error", "warn", "debug", "verbose", "fatal"] as const) {
    jest.spyOn(Logger.prototype, method).mockImplementation(record);
    jest.spyOn(Logger, method).mockImplementation(record);
  }

  for (const method of ["log", "error", "warn", "debug", "info", "trace"] as const) {
    jest.spyOn(console, method).mockImplementation(record);
  }

  return {
    written: () =>
      lines
        .map((line) => {
          if (line instanceof Error) {
            return `${line.message} ${line.stack ?? ""}`;
          }

          return typeof line === "string" ? line : JSON.stringify(line);
        })
        .join("\n"),
  };
}

describe("what the vault writes to a log", () => {
  let sinks: Sinks;
  let vault: InMemoryVault;
  let store: FakeSecretStore;

  beforeEach(() => {
    sinks = captureSinks();
    store = new FakeSecretStore();
    vault = inMemoryVault({ key: MASTER, stores: [store] });
  });

  /**
   * Assert that nothing in any sink spells out any of the values a leak would.
   *
   * @param values - The plaintexts that must not appear, in any encoding.
   */
  function expectNoLeak(...values: string[]): void {
    const written = sinks.written();

    for (const value of values) {
      for (const spelling of spellings(value)) {
        expect(written).not.toContain(spelling);
      }
    }
  }

  it("logs nothing at all on the happy path", async () => {
    // The strongest form of the guarantee: an encrypt and a decrypt that worked have nothing
    // to say, so there is no line for a secret to be in.
    const envelope = await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);
    await vault.vault.decryptText(WORKSPACE, RECORD, envelope);

    expect(sinks.written()).toBe("");
  });

  it("leaks nothing while sealing, opening, rotating, sweeping and re-wrapping", async () => {
    const first = await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);
    store.put(WORKSPACE, RECORD, first, true);
    store.put(WORKSPACE, SECOND, SECRET, false);

    await vault.rotation.rotate(WORKSPACE);
    await vault.rotation.sweep(WORKSPACE);
    await vault.rotation.sweepAll();
    await vault.vault.rewrap(WORKSPACE, wrapperWith(MASTER));
    await vault.vault.decryptText(WORKSPACE, RECORD, store.get(WORKSPACE, RECORD)?.secret ?? "");

    expectNoLeak(SECRET, MASTER);
  });

  // The failure paths, one per way the vault can refuse. Each is driven to completion and the
  // sinks are searched afterwards — including the ones the rejection was caught by, because a
  // `catch` that logs is exactly what a caller of this service will write.
  it("leaks nothing when a ciphertext fails authentication", async () => {
    const envelope = await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);

    await expect(vault.vault.decryptText(OTHER_WORKSPACE, RECORD, envelope)).rejects.toThrow();
    await expect(vault.vault.decryptText(WORKSPACE, SECOND, envelope)).rejects.toThrow();
    await expect(vault.vault.decryptText(WORKSPACE, RECORD, `${envelope}AA`)).rejects.toThrow();

    expectNoLeak(SECRET, MASTER);
  });

  it("leaks nothing when a value is not an envelope at all", async () => {
    await expect(vault.vault.decryptText(WORKSPACE, RECORD, SECRET)).rejects.toThrow();

    // The one case where the *secret itself* is the malformed input, so a parser that quoted
    // what it refused would put the credential in the message directly.
    expectNoLeak(SECRET);
  });

  it("leaks nothing when the master key is wrong", async () => {
    const theirs = inMemoryVault({ key: masterKey(1) });
    const envelope = await theirs.vault.encryptText(WORKSPACE, RECORD, SECRET);
    const row = await theirs.keys.activeKey(WORKSPACE);

    if (row !== undefined) {
      vault.keys.seed(row);
    }

    await expect(vault.vault.decryptText(WORKSPACE, RECORD, envelope)).rejects.toThrow();

    expectNoLeak(SECRET, MASTER, masterKey(1));
  });

  it("leaks nothing when a sweep cannot write a record back", async () => {
    // The sweep *does* log here — it has to, because a detached job has nowhere else to
    // report — so this is the line most likely to carry something it should not.
    const envelope = await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);
    store.put(WORKSPACE, RECORD, envelope, true);
    store.unwritable.add(RECORD);

    await vault.vault.rotate(WORKSPACE);
    const report = await vault.rotation.sweep(WORKSPACE);

    expect(report.failed).toBe(1);
    expect(sinks.written()).toContain(RECORD);
    expectNoLeak(SECRET, MASTER);
  });

  it("leaks nothing when the detached sweep fails outright", async () => {
    store.put(WORKSPACE, RECORD, await vault.vault.encryptText(WORKSPACE, RECORD, SECRET), true);
    jest.spyOn(store, "pending").mockRejectedValue(new Error(`store unreachable for ${RECORD}`));

    await vault.rotation.rotate(WORKSPACE);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sinks.written()).toContain("store unreachable");
    expectNoLeak(SECRET, MASTER);
  });

  it("leaks nothing when a re-wrap cannot open a row", async () => {
    await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);

    await expect(vault.vault.rewrap(WORKSPACE, wrapperWith(masterKey(9)))).rejects.toThrow();

    expectNoLeak(SECRET, MASTER, masterKey(9));
  });

  it("keeps identifiers, which is what makes a failure diagnosable", async () => {
    // The rule is *no values*, not *no output*. A line naming the workspace, the record and
    // the store is what an operator acts on, and a sweep that said only "something failed"
    // would satisfy the redaction criterion by being useless.
    const envelope = await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);
    store.put(WORKSPACE, RECORD, envelope, true);
    store.unwritable.add(RECORD);
    await vault.vault.rotate(WORKSPACE);
    await vault.rotation.sweep(WORKSPACE);

    const written = sinks.written();

    expect(written).toContain(WORKSPACE);
    expect(written).toContain(RECORD);
    expect(written).toContain(store.name);
  });
});

describe("what the vault's own errors carry", () => {
  // Errors are the most-copied strings in a service — logged, wrapped, serialized into a
  // response body, pasted into an issue. A secret that reaches one has reached all four, so
  // the messages are asserted directly rather than only through the sinks above.
  it("names no value in any message it can produce", async () => {
    const vault = inMemoryVault({ key: MASTER });
    const envelope = await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);
    const messages: string[] = [];

    /**
     * Run something expected to fail and keep its message.
     *
     * @param work - The operation.
     */
    async function failing(work: () => Promise<unknown>): Promise<void> {
      try {
        await work();
        throw new Error("expected this operation to fail");
      } catch (error) {
        messages.push((error as Error).message);
      }
    }

    await failing(() => vault.vault.decryptText(OTHER_WORKSPACE, RECORD, envelope));
    await failing(() => vault.vault.decryptText(WORKSPACE, SECOND, envelope));
    await failing(() => vault.vault.decryptText(WORKSPACE, RECORD, SECRET));
    await failing(() => vault.vault.decryptText(WORKSPACE, RECORD, `${envelope}AA`));
    await failing(() =>
      vault.vault.decryptText(WORKSPACE, RECORD, envelope.replace("ouro.v1.1.", "ouro.v1.9.")),
    );
    await failing(() => vault.vault.rotate(OTHER_WORKSPACE));
    await failing(() => vault.vault.rewrap(WORKSPACE, wrapperWith(masterKey(9))));

    const all = messages.join("\n");

    expect(messages).toHaveLength(7);

    for (const value of [SECRET, MASTER, envelope]) {
      for (const spelling of spellings(value)) {
        expect(all).not.toContain(spelling);
      }
    }

    // And the ciphertext itself is not quoted either, in any of its own encodings.
    expect(all).not.toContain(envelope.split(".")[4]);
  });
});

describe("the seam a consumer uses to decide what is sealed", () => {
  it("does not require a consumer to hold a plaintext to answer", () => {
    // `VaultRotation.isSealed` is a prefix test on the *stored* value, so a store deciding
    // whether a record needs adopting never has to decrypt anything to find out.
    expect(VaultRotation.isSealed("ouro.v1.1.abc.def")).toBe(true);
    expect(VaultRotation.isSealed(SECRET)).toBe(false);
  });
});
