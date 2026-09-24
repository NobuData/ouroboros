import { ConflictError, NotFoundError } from "../errors/error.envelope";
import { FIRST_PUSH, SECOND_PUSH } from "../ticket-sources/conformance.pr.fixture";
import {
  IN_MEMORY_DEFAULT_BRANCH,
  InMemoryPrHost,
  InMemoryPrTicketSourceProvider,
} from "../ticket-sources/providers/in-memory.pr.fixture";
import {
  IN_MEMORY_PROJECT,
  IN_MEMORY_TOKEN,
  InMemoryTicketSourceProvider,
  InMemoryTracker,
} from "../ticket-sources/providers/in-memory.provider.fixture";
import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import type { TicketSyncContext } from "../ticket-sources/ticket-source.provider";
import { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import type { SyncSource } from "../ticket-sources/ticket-sources.repository";
import { PR_SYNC_ERRORS } from "./pr-sync.errors";
import type { MirroredPr, PrMirrorStore, PrSyncOutcome, PrSyncWrite } from "./pr-sync.repository";
import { PrSyncService, type PrSourceOpener } from "./pr-sync.service";
import { mirroredState } from "./pr-sync.state";

/**
 * The PR sync over a recorded store and the in-memory git host
 * (AX.1, [#357](https://github.com/NobuData/ouroboros/issues/357)) — what it asks the provider, and
 * what it hands the store. The statements themselves are `pr-sync.integration-spec.ts`'s.
 */

/** The workspace. */
const ORG = "org-357";

/** The source. */
const SOURCE: SyncSource = {
  sourceId: "b0570000-0000-4000-8000-000000000357",
  organizationId: ORG,
  kind: "custom",
  displayName: "Sandbox host",
  config: { project: IN_MEMORY_PROJECT },
  cursor: null,
  syncedAt: null,
};

/** A store that keeps what it was asked to write, and answers the mirror from it. */
class RecordedStore implements PrMirrorStore {
  /** Every write, in order. */
  readonly writes: PrSyncWrite[] = [];

  /** The revisions recorded, by head sha, in order. */
  private readonly heads: string[] = [];

  /** @inheritdoc */
  source(organizationId: string, sourceId: string): Promise<SyncSource | undefined> {
    return Promise.resolve(
      organizationId === ORG && sourceId === SOURCE.sourceId ? SOURCE : undefined,
    );
  }

  /** @inheritdoc */
  mirrored(): Promise<MirroredPr | undefined> {
    return Promise.resolve(
      this.writes.length === 0
        ? undefined
        : { id: "pr-1", state: "open", headSha: this.heads.at(-1) ?? null },
    );
  }

  /** @inheritdoc */
  applySync(write: PrSyncWrite): Promise<PrSyncOutcome> {
    this.writes.push(write);

    if (write.revision !== null && !this.heads.includes(write.revision.headSha)) {
      this.heads.push(write.revision.headSha);
    }

    return Promise.resolve({
      prId: "pr-1",
      state: mirroredState(null, write.snapshot.state),
      revisionSeq: this.heads.length === 0 ? null : this.heads.length,
      newRevision: write.revision !== null,
      created: this.writes.length === 1,
    });
  }
}

/** Opens nothing: hands the provider the fake's token, and records that it was asked. */
class Opener implements PrSourceOpener {
  /** How often a credential was opened. */
  opened = 0;

  /** @inheritdoc */
  withCredentials<T>(
    source: SyncSource,
    run: (context: TicketSyncContext) => Promise<T>,
  ): Promise<T> {
    this.opened += 1;

    return run({
      sourceId: source.sourceId,
      organizationId: source.organizationId,
      config: source.config,
      credentials: IN_MEMORY_TOKEN,
    });
  }
}

/**
 * A service over the in-memory host with one open PR.
 *
 * @returns The service, its collaborators and the PR's number.
 */
function build(): {
  service: PrSyncService;
  store: RecordedStore;
  opener: Opener;
  host: InMemoryPrHost;
  prNumber: number;
} {
  const host = new InMemoryPrHost();
  const store = new RecordedStore();
  const opener = new Opener();

  host.push("loop/482-canbus-flake", FIRST_PUSH);

  const prNumber = host.open(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, {
    branch: "loop/482-canbus-flake",
    base: IN_MEMORY_DEFAULT_BRANCH,
    title: "can: fix flaky telemetry frame order",
    body: null,
  }).number;
  const registry = new TicketSourceRegistry([
    new InMemoryPrTicketSourceProvider(new InMemoryTracker(), host),
  ]);

  return { service: new PrSyncService(store, registry, opener), store, opener, host, prNumber };
}

describe("PrSyncService", () => {
  it("records revision 1, nothing on an unchanged head, and revision 2 after a push", async () => {
    const { service, store, host, prNumber } = build();
    const first = await service.sync(ORG, SOURCE.sourceId, prNumber);
    const unchanged = await service.sync(ORG, SOURCE.sourceId, prNumber);

    host.push("loop/482-canbus-flake", SECOND_PUSH);

    const second = await service.sync(ORG, SOURCE.sourceId, prNumber);

    expect(
      [first, unchanged, second].map((outcome) => [outcome.revisionSeq, outcome.newRevision]),
    ).toEqual([
      [1, true],
      [1, false],
      [2, true],
    ]);
    expect(store.writes[2].revision?.files).toHaveLength(3);
    expect(store.writes[2].snapshot).toMatchObject({
      additions: 68,
      deletions: 15,
      changedFiles: 3,
    });
  });

  it("hands the provider the mirror's latest head, so detection is by sha", async () => {
    const { service, store, prNumber } = build();

    await service.sync(ORG, SOURCE.sourceId, prNumber);
    await service.sync(ORG, SOURCE.sourceId, prNumber);

    expect(store.writes[1].revision).toBeNull();
    expect(store.writes[1].snapshot.headSha).toBe(store.writes[0].revision?.headSha);
  });

  it("refuses a source the workspace does not have, before opening anything", async () => {
    const { service, opener, prNumber } = build();

    for (const [org, source] of [
      ["org-other", SOURCE.sourceId],
      [ORG, "b0570000-0000-4000-8000-000000000000"],
    ]) {
      const refused = await service.sync(org, source, prNumber).catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(NotFoundError);
      expect((refused as NotFoundError).code).toBe(PR_SYNC_ERRORS.sourceNotFound);
    }

    expect(opener.opened).toBe(0);
  });

  it("refuses a source whose provider has no pull requests, or none registered", async () => {
    const store = new RecordedStore();
    const opener = new Opener();

    for (const registry of [
      new TicketSourceRegistry([new InMemoryTicketSourceProvider(new InMemoryTracker())]),
      new TicketSourceRegistry([]),
    ]) {
      const refused = await new PrSyncService(store, registry, opener)
        .sync(ORG, SOURCE.sourceId, 1)
        .catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(ConflictError);
      expect((refused as ConflictError).code).toBe(PR_SYNC_ERRORS.noPullRequests);
    }

    expect(opener.opened).toBe(0);
  });

  it("lets the host's refusal through, classified, and writes nothing", async () => {
    const { service, store, host, prNumber } = build();

    host.refuse("rate_limit", new Date("2026-09-24T14:20:00.000Z"));

    const refused = await service
      .sync(ORG, SOURCE.sourceId, prNumber)
      .catch((error: unknown) => error);

    expect(TicketSourceError.is(refused)).toBe(true);
    expect((refused as TicketSourceError).errorClass).toBe("rate_limit");
    expect(store.writes).toEqual([]);
  });
});
