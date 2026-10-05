import { Logger } from "@nestjs/common";

import type { ArtifactStore } from "../farm/artifacts/artifact.store";
import type { VaultService } from "../vault/vault.service";
import { LifecyclePurge } from "./lifecycle.purge";
import type { DuePurge, LifecycleRepository, PurgeRecord } from "./lifecycle.repository";

const WORKSPACE = "org-acme";
const NOW = new Date("2026-11-02T12:00:00Z");
const DUE: DuePurge = {
  organizationId: WORKSPACE,
  requestedBy: "user-owner",
  requestedAt: new Date("2026-10-03T12:00:00Z"),
};

/** The steps a fault can be injected at, in the order the purge takes them. */
type Step =
  "destroy" | "artifacts" | "clearOutbox" | "removeOrganization" | "residual" | "complete";

/**
 * A purge over recording doubles that keep state the way the database does: the organization
 * exists until it is removed, the keys until they are destroyed, and the tombstone from the
 * purge's start. `calls` is the order things happened in.
 */
function harness(
  options: {
    residual?: number;
    refs?: unknown[];
    gone?: boolean;
    restored?: boolean;
    keys?: number;
  } = {},
) {
  const calls: string[] = [];
  const outbox: { eventType: string; payload: Record<string, unknown> }[] = [];
  const state = {
    organization: options.gone !== true,
    keys: options.keys ?? 2,
    tombstone: undefined as PurgeRecord | undefined,
  };
  /** One step that throws once, for the next attempt only. */
  const faults = new Set<Step>();
  const fail = (step: Step): void => {
    if (faults.delete(step)) throw new Error(`injected failure at ${step}`);
  };

  const repository = {
    due: jest.fn(() => Promise.resolve([DUE])),
    purgeRecord: jest.fn(() => Promise.resolve(state.tombstone)),
    beginPurge: jest.fn((due: DuePurge, now: Date) => {
      if (!state.organization || options.restored === true) return Promise.resolve(undefined);
      calls.push("begin");
      state.tombstone = {
        organizationId: due.organizationId,
        identity: { name: "acme-robotics", slug: "acme" },
        requestedBy: due.requestedBy,
        requestedAt: due.requestedAt,
        startedAt: now,
        purgedAt: null,
        dekVersionsDestroyed: state.keys,
        artifactsDeleted: 0,
        rowsRemaining: 0,
      };
      return Promise.resolve(state.tombstone);
    }),
    identity: jest.fn(() =>
      Promise.resolve(state.organization ? { name: "acme-robotics", slug: "acme" } : undefined),
    ),
    artifactRefs: jest.fn(() =>
      Promise.resolve(
        state.organization
          ? (options.refs ?? [
              { driver: "local", key: "org-acme/job-1/a.log" },
              { driver: "local", key: "org-acme/job-1/b.bin" },
            ])
          : [],
      ),
    ),
    recordArtifacts: jest.fn((_org: string, deleted: number) => {
      if (state.tombstone !== undefined) {
        state.tombstone = {
          ...state.tombstone,
          artifactsDeleted: Math.max(state.tombstone.artifactsDeleted, deleted),
        };
      }
      return Promise.resolve();
    }),
    clearOutbox: jest.fn(() => {
      fail("clearOutbox");
      calls.push("clearOutbox");
      return Promise.resolve();
    }),
    residualRows: jest.fn(() => {
      fail("residual");
      return Promise.resolve(options.residual ?? 0);
    }),
    completePurge: jest.fn(
      (
        _org: string,
        completion: {
          now: Date;
          rowsRemaining: number;
          event: (record: PurgeRecord) => {
            types: readonly string[];
            payload: Record<string, unknown>;
          };
        },
      ) => {
        fail("complete");
        if (state.tombstone === undefined || state.tombstone.purgedAt !== null) {
          return Promise.resolve(undefined);
        }
        calls.push("complete");
        state.tombstone = {
          ...state.tombstone,
          purgedAt: completion.now,
          rowsRemaining: completion.rowsRemaining,
        };
        const { types, payload } = completion.event(state.tombstone);
        for (const eventType of types) outbox.push({ eventType, payload });
        return Promise.resolve(state.tombstone);
      },
    ),
  };
  const vault = {
    destroy: jest.fn(() => {
      fail("destroy");
      calls.push("destroyDek");
      const destroyed = state.keys;
      state.keys = 0;
      return Promise.resolve(destroyed);
    }),
  };
  const store = {
    driver: "local",
    delete: jest.fn((key: string) => {
      fail("artifacts");
      calls.push(`deleteArtifact:${key}`);
      return Promise.resolve();
    }),
  };
  const auth = {
    revokeSessions: jest.fn(),
    removeOrganization: jest.fn(() => {
      fail("removeOrganization");
      calls.push("removeOrganization");
      state.organization = false;
      return Promise.resolve();
    }),
  };
  const purge = new LifecyclePurge(
    repository as unknown as LifecycleRepository,
    vault as unknown as VaultService,
    store as unknown as ArtifactStore,
    auth,
  );

  return { calls, outbox, state, faults, repository, vault, store, auth, purge };
}

describe("the workspace purge (#489)", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("begins its tombstone, destroys the DEK before it removes anything else, and completes last", async () => {
    const { calls, purge } = harness();

    await purge.purge(DUE, NOW);

    expect(calls).toEqual([
      "begin",
      "destroyDek",
      "deleteArtifact:org-acme/job-1/a.log",
      "deleteArtifact:org-acme/job-1/b.bin",
      "clearOutbox",
      "removeOrganization",
      "complete",
    ]);
  });

  it("records what it did in the tombstone and the system's purge event", async () => {
    const { state, outbox, purge } = harness();

    const report = await purge.purge(DUE, NOW);

    expect(report).toEqual({
      organizationId: WORKSPACE,
      dekVersionsDestroyed: 2,
      artifactsDeleted: 2,
      artifactsFailed: 0,
      rowsRemaining: 0,
    });
    expect(state.tombstone).toEqual({
      organizationId: WORKSPACE,
      identity: { name: "acme-robotics", slug: "acme" },
      requestedBy: "user-owner",
      requestedAt: DUE.requestedAt,
      startedAt: NOW,
      purgedAt: NOW,
      dekVersionsDestroyed: 2,
      artifactsDeleted: 2,
      rowsRemaining: 0,
    });
    expect(outbox).toEqual([
      {
        eventType: "audit.workspace.purged",
        payload: expect.objectContaining({
          actorId: null,
          actor: "system",
          dek_versions_destroyed: 2,
          artifacts_deleted: 2,
          rows_remaining: 0,
        }) as unknown,
      },
    ]);
  });

  it("counts another driver's artifact as not removed, rather than hiding it", async () => {
    const { store, purge } = harness({ refs: [{ driver: "s3", key: "k" }] });

    const report = await purge.purge(DUE, NOW);

    expect(store.delete).not.toHaveBeenCalled();
    expect(report?.artifactsFailed).toBe(1);
  });

  it("reports rows left behind instead of claiming a clean purge", async () => {
    const { purge } = harness({ residual: 3 });

    await expect(purge.purge(DUE, NOW)).resolves.toMatchObject({ rowsRemaining: 3 });
  });

  it("does nothing for a workspace that is already gone with no purge begun", async () => {
    const { vault, auth, purge } = harness({ gone: true });

    await expect(purge.purge(DUE, NOW)).resolves.toBeUndefined();
    expect(vault.destroy).not.toHaveBeenCalled();
    expect(auth.removeOrganization).not.toHaveBeenCalled();
  });

  it("does nothing for a workspace restored before the purge could begin", async () => {
    const { vault, purge } = harness({ restored: true });

    await expect(purge.purge(DUE, NOW)).resolves.toBeUndefined();
    expect(vault.destroy).not.toHaveBeenCalled();
  });

  it("does nothing for a purge that already completed", async () => {
    const { vault, outbox, purge } = harness();

    await purge.purge(DUE, NOW);
    vault.destroy.mockClear();

    await expect(purge.purge(DUE, NOW)).resolves.toBeUndefined();
    expect(vault.destroy).not.toHaveBeenCalled();
    expect(outbox).toHaveLength(1);
  });

  // Not "artifacts": an object the store cannot delete is counted in `artifactsFailed`, not thrown.
  it.each<Step>(["destroy", "clearOutbox", "removeOrganization", "residual", "complete"])(
    "resumes a purge that failed at %s, recording the DEK count from before the shred and one event",
    async (step) => {
      const { faults, state, outbox, purge } = harness();

      faults.add(step);
      await expect(purge.purge(DUE, NOW)).rejects.toThrow(`injected failure at ${step}`);

      // The progress record exists and is unfinished — the next sweep's to find.
      expect(state.tombstone).toMatchObject({ purgedAt: null, dekVersionsDestroyed: 2 });

      const later = new Date(NOW.getTime() + 60_000);
      const report = await purge.purge(DUE, later);

      expect(report).toMatchObject({ dekVersionsDestroyed: 2, artifactsDeleted: 2 });
      expect(state).toMatchObject({ organization: false, keys: 0 });
      expect(state.tombstone).toMatchObject({ purgedAt: later, dekVersionsDestroyed: 2 });
      expect(outbox.map((event) => event.eventType)).toEqual(["audit.workspace.purged"]);
    },
  );

  it("sweeps every due workspace, and keeps going past one that fails", async () => {
    const { repository, vault, purge } = harness();
    repository.due.mockResolvedValueOnce([DUE, { ...DUE, organizationId: "org-two" }]);
    vault.destroy.mockRejectedValueOnce(new Error("kms down"));

    const reports = await purge.sweep(NOW);

    expect(repository.due).toHaveBeenCalledWith(NOW);
    expect(reports.map((report) => report.organizationId)).toEqual(["org-two"]);
  });
});
