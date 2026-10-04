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
import { Logger } from "@nestjs/common";

import { DecisionSourceWatcher } from "../decisions/decision.watchers";

import type { FactCommitObserver } from "../facts/facts.observer";
import type { CalibrationMergeObserver } from "../insights/calibration.observer";
import type { GateEvidenceEvent, GateEvidenceSink } from "./gates/gate.evidence";
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
      newlyMerged:
        write.snapshot.state === "merged" &&
        !this.writes.slice(0, -1).some((earlier) => earlier.snapshot.state === "merged"),
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

/** A gate sink that keeps what it was told. */
class RecordedGates implements GateEvidenceSink {
  /** Every notification, in order. */
  readonly events: [string, GateEvidenceEvent][] = [];

  /** @inheritdoc */
  notify(organizationId: string, event: GateEvidenceEvent): Promise<void> {
    this.events.push([organizationId, event]);
    return Promise.resolve();
  }
}

/** A fact sweep that keeps the merges it was told about. */
class RecordedFacts implements FactCommitObserver {
  /** Every merge, in order. */
  readonly merges: [string, string][] = [];

  /** @inheritdoc */
  mergeObserved(organizationId: string, prId: string): Promise<void> {
    this.merges.push([organizationId, prId]);
    return Promise.resolve();
  }
}

/**
 * A service over the in-memory host with one open PR.
 *
 * @param gates - The gate engine's sink, when the case listens to it.
 * @param facts - The fact staleness sweep, when the case listens to it.
 * @param calibration - The estimator calibration fill, when the case listens to it.
 * @param decisions - The Needs-You watcher (#461), when the case listens to it.
 * @returns The service, its collaborators and the PR's number.
 */
function build(
  gates?: GateEvidenceSink,
  facts?: FactCommitObserver,
  calibration?: CalibrationMergeObserver,
  decisions?: DecisionSourceWatcher,
): {
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

  return {
    service: new PrSyncService(
      store,
      registry,
      opener,
      gates,
      facts,
      undefined,
      calibration,
      undefined,
      decisions,
    ),
    store,
    opener,
    host,
    prNumber,
  };
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

  it("tells the gate engine about every sync — a push as revision_pushed, else pr_synced", async () => {
    const gates = new RecordedGates();
    const { service, host, prNumber } = build(gates);

    await service.sync(ORG, SOURCE.sourceId, prNumber);
    await service.sync(ORG, SOURCE.sourceId, prNumber);
    host.push("loop/482-canbus-flake", SECOND_PUSH);
    await service.sync(ORG, SOURCE.sourceId, prNumber);

    expect(gates.events).toEqual([
      [ORG, { kind: "revision_pushed", prId: "pr-1" }],
      [ORG, { kind: "pr_synced", prId: "pr-1" }],
      [ORG, { kind: "revision_pushed", prId: "pr-1" }],
    ]);
  });

  it("tells the fact sweep about a merge once — the sync that first sees it merged", async () => {
    const facts = new RecordedFacts();
    const { service, host, prNumber } = build(undefined, facts);

    const open = await service.sync(ORG, SOURCE.sourceId, prNumber);
    host.merge(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, prNumber, "squash", "can: fix frame order");
    const merged = await service.sync(ORG, SOURCE.sourceId, prNumber);
    const again = await service.sync(ORG, SOURCE.sourceId, prNumber);

    expect([open.newlyMerged, merged.newlyMerged, again.newlyMerged]).toEqual([false, true, false]);
    expect(facts.merges).toEqual([[ORG, "pr-1"]]);
  });

  it("sweeps the workspace's Needs-You cards on every sync that sees the PR ended — PR merged out of band (#461)", async () => {
    const sweep = jest.fn().mockResolvedValue(1);
    const { service, host, prNumber } = build(undefined, undefined, undefined, {
      sweep,
    } as unknown as DecisionSourceWatcher);

    await service.sync(ORG, SOURCE.sourceId, prNumber);
    expect(sweep).not.toHaveBeenCalled();

    host.merge(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, prNumber, "squash", "can: fix frame order");
    await service.sync(ORG, SOURCE.sourceId, prNumber);

    expect(sweep).toHaveBeenCalledWith(ORG);
  });

  it("keeps the sync's outcome when the fact sweep fails, and logs it", async () => {
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const failing: FactCommitObserver = {
      mergeObserved: () => Promise.reject(new Error("sweep down")),
    };
    const { service, host, prNumber } = build(undefined, failing);

    host.merge(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, prNumber, "squash", "can: fix frame order");

    await expect(service.sync(ORG, SOURCE.sourceId, prNumber)).resolves.toMatchObject({
      state: "merged",
      newlyMerged: true,
    });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("tells the calibration fill about a merge once — the sync that first sees it merged", async () => {
    const calibration = new RecordedFacts();
    const { service, host, prNumber } = build(undefined, undefined, calibration);

    await service.sync(ORG, SOURCE.sourceId, prNumber);
    host.merge(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, prNumber, "squash", "can: fix frame order");
    await service.sync(ORG, SOURCE.sourceId, prNumber);
    await service.sync(ORG, SOURCE.sourceId, prNumber);

    expect(calibration.merges).toEqual([[ORG, "pr-1"]]);
  });

  it("still grades the merge when the fact sweep fails, and keeps the sync when grading fails", async () => {
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const calibration = new RecordedFacts();
    const failingFacts: FactCommitObserver = {
      mergeObserved: () => Promise.reject(new Error("sweep down")),
    };
    const failingCalibration: CalibrationMergeObserver = {
      mergeObserved: () => Promise.reject(new Error("calibration down")),
    };
    const graded = build(undefined, failingFacts, calibration);
    const ungraded = build(undefined, undefined, failingCalibration);

    for (const { host, prNumber } of [graded, ungraded]) {
      host.merge(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, prNumber, "squash", "can: fix frame order");
    }

    await graded.service.sync(ORG, SOURCE.sourceId, graded.prNumber);
    await expect(
      ungraded.service.sync(ORG, SOURCE.sourceId, ungraded.prNumber),
    ).resolves.toMatchObject({ state: "merged", newlyMerged: true });
    expect(calibration.merges).toEqual([[ORG, "pr-1"]]);
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("tells the gate engine nothing when the host refused", async () => {
    const gates = new RecordedGates();
    const { service, host, prNumber } = build(gates);

    host.refuse("rate_limit", new Date("2026-09-24T14:20:00.000Z"));
    await service.sync(ORG, SOURCE.sourceId, prNumber).catch(() => undefined);

    expect(gates.events).toEqual([]);
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

describe("PrSyncService.comment", () => {
  it("posts once, then edits the same comment under the same key (decision V9)", async () => {
    const { service, opener, host, prNumber } = build();
    const input = { key: "criterion.c1", body: "**Acceptance criterion waived**" };
    const first = await service.comment(ORG, SOURCE.sourceId, prNumber, input);
    const again = await service.comment(ORG, SOURCE.sourceId, prNumber, {
      ...input,
      body: "**Acceptance criterion waived** — reworded",
    });

    expect(first.mode).toBe("created");
    expect(again).toEqual({ commentId: first.commentId, url: first.url, mode: "edited" });
    expect(first.url).toMatch(/#comment-/);
    expect(host.ledger().comments.filter(([number]) => number === prNumber)).toHaveLength(1);
    expect(opener.opened).toBe(2);
  });

  it("refuses an unknown source or a tracker without PRs before opening anything", async () => {
    const { service, opener, prNumber } = build();
    const unknown = await service
      .comment("org-other", SOURCE.sourceId, prNumber, { key: "k", body: "b" })
      .catch((error: unknown) => error);
    const tracker = await new PrSyncService(
      new RecordedStore(),
      new TicketSourceRegistry([new InMemoryTicketSourceProvider(new InMemoryTracker())]),
      opener,
    )
      .comment(ORG, SOURCE.sourceId, prNumber, { key: "k", body: "b" })
      .catch((error: unknown) => error);

    expect((unknown as NotFoundError).code).toBe(PR_SYNC_ERRORS.sourceNotFound);
    expect((tracker as ConflictError).code).toBe(PR_SYNC_ERRORS.noPullRequests);
    expect(opener.opened).toBe(0);
  });

  it("lets the host's refusal through, classified", async () => {
    const { service, host, prNumber } = build();

    host.refuse("permission");

    const refused = await service
      .comment(ORG, SOURCE.sourceId, prNumber, { key: "k", body: "b" })
      .catch((error: unknown) => error);

    expect((refused as TicketSourceError).errorClass).toBe("permission");
  });
});

describe("PrSyncService.create — the dry-run policy's first enforcement point (BA.3, #382)", () => {
  /** A policy reader answering `active`, counting its uncached reads. */
  function policy(active: boolean) {
    return {
      reads: 0,
      dryRun: () => Promise.resolve(active),
      dryRunNow(): Promise<boolean> {
        this.reads += 1;
        return Promise.resolve(active);
      },
    };
  }

  /**
   * A service whose host has a pushed branch and no PR for it.
   *
   * @param reader - The policy reader, or undefined for a context without one.
   * @returns The service and host.
   */
  function opening(reader?: ReturnType<typeof policy>) {
    const built = build();

    built.host.push("loop/483-dry-run", FIRST_PUSH);

    return {
      ...built,
      service: new PrSyncService(
        built.store,
        new TicketSourceRegistry([
          new InMemoryPrTicketSourceProvider(new InMemoryTracker(), built.host),
        ]),
        built.opener,
        undefined,
        undefined,
        reader,
      ),
    };
  }

  const INPUT = {
    branch: "loop/483-dry-run",
    base: IN_MEMORY_DEFAULT_BRANCH,
    title: "can: fix frame order",
    body: null,
  };

  it("forces a draft while dry-run is active, even when the caller asked for a ready PR", async () => {
    const reader = policy(true);
    const { service } = opening(reader);

    await expect(
      service.create(ORG, SOURCE.sourceId, { ...INPUT, draft: false }),
    ).resolves.toMatchObject({ draft: true });
    // Read uncached — opening a PR is a write.
    expect(reader.reads).toBe(1);
  });

  it("opens what the caller asked once dry-run is off", async () => {
    await expect(
      opening(policy(false)).service.create(ORG, SOURCE.sourceId, INPUT),
    ).resolves.toMatchObject({ draft: false });
    await expect(
      opening(policy(false)).service.create(ORG, SOURCE.sourceId, { ...INPUT, draft: true }),
    ).resolves.toMatchObject({ draft: true });
  });

  it("opens a draft in a context that wired no policy — the safe direction", async () => {
    await expect(opening().service.create(ORG, SOURCE.sourceId, INPUT)).resolves.toMatchObject({
      draft: true,
    });
  });

  it("refuses a source the workspace does not have before reading the host", async () => {
    await expect(
      opening(policy(true)).service.create(ORG, "src-nowhere", INPUT),
    ).rejects.toMatchObject({ response: { code: "pr_source_not_found" } });
  });
});
