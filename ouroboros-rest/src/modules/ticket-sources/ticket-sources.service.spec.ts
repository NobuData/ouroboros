import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Logger } from "@nestjs/common";

import type { VaultService } from "../vault/vault.service";
import type { SyncCycleReport } from "./sync.report";
import { TicketSourceError } from "./ticket-source.errors";
import {
  FIXTURE_CREDENTIAL,
  FIXTURE_ENVELOPE,
  FIXTURE_GITHUB_SOURCE,
  FIXTURE_NOW,
  githubSource,
  githubTicket,
  jiraSource,
  jiraTicket,
  page,
  recordingIntake,
  scriptedProvider,
  type RecordingIntake,
} from "./ticket-source.fixture";
import type { TicketSourceProvider } from "./ticket-source.provider";
import { TicketSourceRegistry } from "./ticket-source.registry";
import type {
  SyncSource,
  SyncWrite,
  SyncWritten,
  TicketSourcesRepository,
} from "./ticket-sources.repository";
import { TicketSourcesService } from "./ticket-sources.service";

/**
 * The loop ([#139](https://github.com/NobuData/ouroboros/issues/139)), and the four criteria
 * it is the subject of:
 *
 *   * **zero provider-specific branches** — asserted structurally over this file's subject's
 *     own source, because behaviour cannot prove the *absence* of a branch that nothing
 *     currently triggers;
 *   * **provider errors map to source status with honest reasons** — asserted as what the loop
 *     writes to the row, for each of the four classes;
 *   * **cursor handling is provider-owned** — asserted as what the loop passes back, byte for
 *     byte, and as the fact that *full or incremental* is decided by a null and nothing else;
 *   * **credentials are decrypted only inside provider calls, never logged** — asserted against
 *     a captured log transcript, with a credential-shaped fixture.
 *
 * The repository and the vault are hand-written doubles rather than `jest.mock`: both have two
 * or three methods, and a double that records its calls reads as the thing the assertion is
 * about. The database itself is `ticket-sources.integration-spec.ts`'s.
 */

/** The loop's own source, for the structural assertions. */
const SOURCE = readFileSync(join(__dirname, "ticket-sources.service.ts"), "utf8").replaceAll(
  /https:\/\/github\.com\/NobuData\/\S*/g,
  "",
);

/** A repository that records what it was asked and answers what a spec queued. */
interface FakeRepository extends TicketSourcesRepository {
  readonly writes: SyncWrite[];
  readonly failures: { sourceId: string; status: string; reason: string }[];
  readonly credentialReads: string[];
}

/**
 * A repository double.
 *
 * @param sources - What a cycle finds.
 * @param written - What the transaction reports back; the default is a sync that changed
 *   nothing, so a spec that is not about counting says nothing about them.
 * @param options - `sealed` is the envelope on every source, `applyFails` makes the
 *   transaction throw.
 * @returns The double.
 */
function fakeRepository(
  sources: readonly SyncSource[],
  written: Partial<SyncWritten> = {},
  options: { sealed?: string | null; applyFails?: unknown } = {},
): FakeRepository {
  const writes: SyncWrite[] = [];
  const failures: { sourceId: string; status: string; reason: string }[] = [];
  const credentialReads: string[] = [];

  return {
    writes,
    failures,
    credentialReads,
    activeSources: () => Promise.resolve([...sources]),
    sealedCredential: (sourceId: string) => {
      credentialReads.push(sourceId);

      return Promise.resolve(options.sealed ?? null);
    },
    applySync: (write: SyncWrite) => {
      writes.push(write);

      if (options.applyFails !== undefined) {
        // `unknown`, for the reason `ticket-source.fixture.ts` gives: what a double has to be
        // able to stage includes the values a well-typed caller would never produce.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject(options.applyFails);
      }

      return Promise.resolve({
        imported: 0,
        updated: 0,
        unchanged: 0,
        skippedClosed: 0,
        estimable: [],
        ...written,
      });
    },
    markFailure: (sourceId: string, status: string, reason: string) => {
      failures.push({ sourceId, status, reason });

      return Promise.resolve();
    },
  } as unknown as FakeRepository;
}

/**
 * A vault double.
 *
 * @param opened - What an envelope opens to, or a thrown value.
 * @returns The double.
 */
function fakeVault(opened: string | Error = FIXTURE_CREDENTIAL): VaultService {
  return {
    decryptText: () => (opened instanceof Error ? Promise.reject(opened) : Promise.resolve(opened)),
  } as unknown as VaultService;
}

/** Everything a cycle needs, assembled. */
function build(options: {
  sources?: readonly SyncSource[];
  providers?: readonly TicketSourceProvider[];
  written?: Partial<SyncWritten>;
  sealed?: string | null;
  vault?: VaultService;
  intake?: RecordingIntake;
  applyFails?: unknown;
}): {
  service: TicketSourcesService;
  repository: FakeRepository;
  intake: RecordingIntake;
} {
  const repository = fakeRepository(options.sources ?? [githubSource()], options.written, {
    sealed: options.sealed ?? null,
    applyFails: options.applyFails,
  });
  const registry = new TicketSourceRegistry(options.providers ?? [scriptedProvider()]);
  const intake = options.intake ?? recordingIntake();

  return {
    service: new TicketSourcesService(repository, registry, options.vault ?? fakeVault(), intake),
    repository,
    intake,
  };
}

/**
 * Run `work` with the logger silenced, and answer what it answered.
 *
 * A cycle that skipped or failed a source says so, which is the property `sync.report.ts`
 * insists on — and a suite that exercises those paths would otherwise print them to the CI log
 * beside the assertions about them. Used where the *log* is not the subject;
 * {@link transcriptOf} is for where it is.
 *
 * @param work - What to run.
 * @returns Whatever it returned.
 */
async function quietly<T>(work: () => Promise<T>): Promise<T> {
  let answer: T | undefined;

  await transcriptOf(async () => {
    answer = await work();

    return answer;
  });

  return answer as T;
}

/** Everything written to the logger during `work`, as one string. */
async function transcriptOf(work: () => Promise<unknown>): Promise<string> {
  const lines: unknown[] = [];
  const capture = (...args: unknown[]): undefined => {
    lines.push(...args);

    return undefined;
  };
  const spies = (["log", "warn", "error", "debug", "verbose"] as const).map((level) =>
    jest.spyOn(Logger.prototype, level).mockImplementation(capture),
  );

  try {
    await work();
  } finally {
    for (const spy of spies) {
      spy.mockRestore();
    }
  }

  return lines.map((line) => JSON.stringify(line)).join("\n");
}

describe("the sync loop", () => {
  it("has no branch on a source's kind anywhere in it", () => {
    // The criterion the whole ticket is about, and the one behaviour cannot demonstrate: a
    // `switch (source.kind)` that nothing in the suite happens to trigger passes every
    // behavioural test there is. So this reads the file.
    //
    // The one place a kind may appear is the lookup, and the assertion below is the *shape* of
    // that: `registry.find(...)` with the kind as its argument, and no comparison against a
    // literal.
    const body = SOURCE.slice(SOURCE.indexOf("export class TicketSourcesService"));

    for (const kind of ["github", "gitlab", "jira", "linear"]) {
      expect(body).not.toContain(`"${kind}"`);
      expect(body).not.toContain(`'${kind}'`);
    }

    expect(body).toContain("this.registry.find(source.kind)");
  });

  it("dispatches through the registry rather than importing a provider", async () => {
    const provider = scriptedProvider({ kind: "github" });
    const { service } = build({ providers: [provider] });

    await service.cycle();

    expect(provider.calls).toHaveLength(1);
  });

  it("syncs sources of different kinds through their own providers", async () => {
    // The generalization, as behaviour: two sources, two kinds, two providers, one loop that
    // knows about neither.
    const github = scriptedProvider({ kind: "github" });
    const jira = scriptedProvider({ kind: "jira" });
    const { service } = build({
      sources: [githubSource(), jiraSource()],
      providers: [github, jira],
    });

    const report = await service.cycle();

    expect(github.calls).toHaveLength(1);
    expect(jira.calls).toHaveLength(1);
    expect(report.sources.map((outcome) => outcome.kind)).toStrictEqual(["github", "jira"]);
  });
});

describe("full and incremental", () => {
  it("takes a source with no cursor through fullSync", async () => {
    const provider = scriptedProvider();
    const { service } = build({ sources: [githubSource({ cursor: null })], providers: [provider] });

    await service.cycle();

    expect(provider.members).toStrictEqual(["fullSync"]);
  });

  it("takes a source with a stored cursor through incrementalSync, unread", async () => {
    // The acceptance criterion: *"the loop stores what the provider returns and never
    // interprets it"*. The cursor here is deliberately not a timestamp — nothing in the loop
    // may care.
    const provider = scriptedProvider();
    const stored = "opaque::page-token::7f3a";
    const { service } = build({
      sources: [githubSource({ cursor: stored, syncedAt: new Date("2026-09-11T00:00:00Z") })],
      providers: [provider],
    });

    await service.cycle();

    expect(provider.members).toStrictEqual(["incrementalSync"]);
    expect(provider.cursors).toStrictEqual([stored]);
  });

  it("stores the cursor a provider returned, byte for byte", async () => {
    const returned = '{"after":"Y3Vyc29yOjQ4NQ=="}';
    const provider = scriptedProvider({ pages: [page([], { nextCursor: returned })] });
    const { service, repository } = build({ providers: [provider] });

    await service.cycle();

    expect(repository.writes[0]?.cursor).toBe(returned);
  });

  it("passes a null cursor through as null, which leaves the stored one alone", async () => {
    const { service, repository } = build({ providers: [scriptedProvider()] });

    await service.cycle();

    expect(repository.writes[0]?.cursor).toBeNull();
  });

  it("marks a cycle pending when a provider says there is more", async () => {
    const provider = scriptedProvider({ pages: [page([], { hasMore: true })] });
    const { service } = build({ providers: [provider] });

    expect((await service.cycle()).pending).toBe(true);
  });

  it("does not mark a cycle pending on a full page a provider called the last", async () => {
    // The reason `hasMore` is the provider's answer and not a comparison the loop makes: page
    // size is the provider's business, and a loop that inferred "more" from a page that looked
    // full would spin on the last page of every sync.
    const provider = scriptedProvider({
      pages: [page([githubTicket(), jiraTicket()], { hasMore: false })],
    });
    const { service } = build({ providers: [provider] });

    expect((await service.cycle()).pending).toBe(false);
  });
});

describe("an unsupported kind", () => {
  it("is skipped rather than failed, and the row is left alone", async () => {
    // A missing provider is a property of the build rather than of somebody's configuration.
    // `R__dev_seed_sources.sql` seeds a Jira source, so a loop that failed a skip would paint
    // every development workspace red on first boot for a release schedule.
    const { service, repository } = build({
      sources: [jiraSource()],
      providers: [scriptedProvider({ kind: "github" })],
    });

    const report = await quietly(async () => service.cycle());

    expect(report.sources[0]?.skipped).toBe("unsupported_kind");
    expect(report.sources[0]?.failure).toBeUndefined();
    expect(repository.failures).toStrictEqual([]);
    expect(repository.writes).toStrictEqual([]);
  });

  it("does not open a credential for a source it cannot sync", async () => {
    // Narrowness for its own sake: a secret that is never opened cannot be leaked, and there
    // is nothing to open it *for*.
    const { service, repository } = build({
      sources: [jiraSource()],
      providers: [],
      sealed: FIXTURE_ENVELOPE,
    });

    await quietly(async () => service.cycle());

    expect(repository.credentialReads).toStrictEqual([]);
  });

  it("does not cost its neighbours their sync", async () => {
    const github = scriptedProvider({ kind: "github" });
    const { service } = build({
      sources: [jiraSource(), githubSource()],
      providers: [github],
    });

    const report = await quietly(async () => service.cycle());

    expect(report.sources).toHaveLength(2);
    expect(github.calls).toHaveLength(1);
  });
});

describe("a provider that failed", () => {
  it.each([
    ["auth", "credentials rejected"],
    ["not_found", "project or repository not found"],
    ["upstream", "tracker unavailable"],
  ])("writes %s onto the source as an honest reason", async (errorClass, reason) => {
    const { service, repository } = build({
      providers: [scriptedProvider({ fails: new TicketSourceError(errorClass as "auth", "raw") })],
    });

    const report = await quietly(async () => service.cycle());

    expect(repository.failures).toStrictEqual([
      { sourceId: FIXTURE_GITHUB_SOURCE, status: "error", reason },
    ]);
    expect(report.sources[0]?.failure).toStrictEqual({ errorClass, reason });
  });

  it("says when a rate limit lifts, which is the criterion's own example", async () => {
    const failure = new TicketSourceError(
      "rate_limit",
      "429 with Retry-After",
      new Date("2026-09-12T14:20:00.000Z"),
    );
    const { service, repository } = build({ providers: [scriptedProvider({ fails: failure })] });

    await quietly(async () => service.cycle());

    expect(repository.failures[0]?.reason).toBe("rate limited until 14:20 UTC");
  });

  it("never writes the freshness stamp for a sync that did not happen", async () => {
    const { service, repository } = build({
      providers: [scriptedProvider({ fails: new TicketSourceError("upstream", "503") })],
    });

    const report = await quietly(async () => service.cycle());

    expect(repository.writes).toStrictEqual([]);
    expect(report.sources[0]?.syncedAt).toBeUndefined();
    expect(report.sources[0]?.cursor).toBeUndefined();
  });

  it("reads a provider that threw something else as upstream rather than swallowing it", async () => {
    // A provider that threw a `TypeError` has a bug, and `upstream` is the honest reading from
    // here. Deliberately not a skip: the sync really did fail, and a row that said otherwise
    // would be the silent no-op this loop is not allowed to have.
    const { service, repository } = build({
      providers: [
        scriptedProvider({ fails: new TypeError("cannot read properties of undefined") }),
      ],
    });

    const report = await quietly(async () => service.cycle());

    expect(report.sources[0]?.failure?.errorClass).toBe("upstream");
    expect(repository.failures[0]?.reason).toBe("tracker unavailable");
  });

  it("keeps going when the failure itself could not be recorded", async () => {
    const repository = fakeRepository([githubSource(), githubSource({ sourceId: "second" })]);

    jest.spyOn(repository, "markFailure").mockRejectedValue(new Error("database is away"));

    const service = new TicketSourcesService(
      repository,
      new TicketSourceRegistry([scriptedProvider({ fails: new TicketSourceError("auth", "401") })]),
      fakeVault(),
      recordingIntake(),
    );

    let report: SyncCycleReport | undefined;

    const transcript = await transcriptOf(async () => {
      report = await service.cycle();

      return report;
    });

    // Both sources still appear: the write that failed cost its own row's status and nothing
    // else, which is what keeps one unreachable statement from losing a chunk.
    expect(report?.sources).toHaveLength(2);
    expect(transcript).toContain("could not be recorded on the source");
  });
});

describe("the estimation handoff", () => {
  it("happens after the transaction, with what the transaction returned", async () => {
    const estimable = [
      {
        organizationId: "org-sources",
        ticketId: "t-1",
        sourceId: FIXTURE_GITHUB_SOURCE,
        sourceKind: "github" as const,
        externalKey: "#485",
        reason: "imported" as const,
      },
    ];
    const { service, intake } = build({ written: { imported: 1, estimable } });

    const report = await service.cycle();

    expect(intake.accepted).toStrictEqual(estimable);
    expect(report.sources[0]?.enqueued).toBe(1);
  });

  it("is still called with an empty batch, so a port can bound its own admission", async () => {
    const { service, intake } = build({});

    await service.cycle();

    expect(intake.batches()).toBe(1);
    expect(intake.accepted).toStrictEqual([]);
  });

  it("costs the handoff and not the sync when it throws", async () => {
    // The rows are already committed and the next cycle will not re-offer them, so the honest
    // thing is to say so loudly rather than fail a cycle that succeeded.
    const intake = recordingIntake(new Error("queue is full"));
    const { service } = build({ intake, written: { imported: 2 } });

    let report: SyncCycleReport | undefined;

    const transcript = await transcriptOf(async () => {
      report = await service.cycle();

      return report;
    });

    expect(transcript).toContain("could not be handed to the estimation pipeline");
    // The sync itself succeeded and says so: the rows are committed, and a cycle that had
    // rejected here would have reported a failure on a source that is perfectly healthy.
    expect(report?.sources[0]?.imported).toBe(2);
    expect(report?.sources[0]?.failure).toBeUndefined();
  });
});

describe("the credential", () => {
  it("is opened only when the source has one", async () => {
    const provider = scriptedProvider();
    const { service } = build({ providers: [provider], sealed: null });

    await service.cycle();

    expect(provider.calls[0]?.credentials).toBeNull();
  });

  it("reaches the provider opened, and nothing else", async () => {
    const provider = scriptedProvider();
    const { service } = build({ providers: [provider], sealed: FIXTURE_ENVELOPE });

    await service.cycle();

    expect(provider.calls[0]?.credentials).toBe(FIXTURE_CREDENTIAL);
    // The context is the whole of what a provider is handed: no display name, no status, no
    // sealed column, nothing it could write back with.
    expect(Object.keys(provider.calls[0] ?? {}).sort()).toStrictEqual([
      "config",
      "credentials",
      "organizationId",
      "sourceId",
    ]);
  });

  it("never appears in a log line, sealed or open", async () => {
    // Asserted against a transcript rather than by reading the code, because the failure mode
    // is an interpolation somebody adds later — and the fixture credential is deliberately
    // distinctive so a match here is a match rather than a coincidence.
    const transcript = await transcriptOf(async () => {
      const { service } = build({
        providers: [scriptedProvider({ fails: new TicketSourceError("auth", "401 from listing") })],
        sealed: FIXTURE_ENVELOPE,
      });

      return service.cycle();
    });

    expect(transcript).not.toContain(FIXTURE_CREDENTIAL);
    expect(transcript).not.toContain(FIXTURE_ENVELOPE);
  });

  it("fails the sync as auth when the envelope will not open, and says nothing about it", async () => {
    // A workspace whose key is gone, or an envelope sealed under a version this deployment
    // cannot reach. From the outside that is indistinguishable from a credential that no
    // longer works, and it is fixed in the same place.
    const { service, repository } = build({
      sealed: FIXTURE_ENVELOPE,
      vault: fakeVault(new Error("workspace org-sources has no key at version 1")),
    });

    const transcript = await transcriptOf(async () => service.cycle());

    expect(repository.failures[0]).toStrictEqual({
      sourceId: FIXTURE_GITHUB_SOURCE,
      status: "error",
      reason: "credentials rejected",
    });
    expect(transcript).not.toContain(FIXTURE_ENVELOPE);
  });

  it("is not held on the service after a cycle", async () => {
    // Not a zeroization — a JavaScript string cannot be one — but the narrowest lifetime
    // available. What is checked is that nothing on the service or in the report refers to it.
    const { service } = build({ providers: [scriptedProvider()], sealed: FIXTURE_ENVELOPE });

    await service.cycle();

    expect(JSON.stringify(service.lastCycle())).not.toContain(FIXTURE_CREDENTIAL);
    expect(JSON.stringify(service)).not.toContain(FIXTURE_CREDENTIAL);
  });
});

describe("the cycle", () => {
  it("gives every source in one cycle the same freshness instant", async () => {
    // *"synced 40s ago"* has to mean the same thing for every source a cycle touched, rather
    // than drifting by however long the cycle took.
    const { service, repository } = build({
      sources: [githubSource(), githubSource({ sourceId: "second" })],
    });

    await service.cycle();

    const stamps = repository.writes.map((write) => write.syncedAt.getTime());

    expect(new Set(stamps).size).toBe(1);
  });

  it("has no report before the first one, which is a different fact from an empty one", async () => {
    const { service } = build({ sources: [] });

    expect(service.lastCycle()).toBeUndefined();

    await service.cycle();

    expect(service.lastCycle()?.sources).toStrictEqual([]);
  });

  it("reports every active source, whether or not anything happened to it", async () => {
    const { service } = build({
      sources: [githubSource(), jiraSource()],
      providers: [scriptedProvider({ kind: "github" })],
    });

    const report = await quietly(async () => service.cycle());

    expect(report.sources).toHaveLength(2);

    for (const outcome of report.sources) {
      const said =
        outcome.skipped !== undefined ||
        outcome.failure !== undefined ||
        outcome.syncedAt !== undefined;

      expect(said).toBe(true);
    }
  });

  it("carries the cycle's clock into the report", async () => {
    jest.useFakeTimers().setSystemTime(FIXTURE_NOW);

    try {
      const { service } = build({});

      expect((await service.cycle()).startedAt).toStrictEqual(FIXTURE_NOW);
    } finally {
      jest.useRealTimers();
    }
  });
});
