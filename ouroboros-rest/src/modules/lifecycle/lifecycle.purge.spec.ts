import { Logger } from "@nestjs/common";

import type { DatabaseService } from "../db/db.service";
import type { ArtifactStore } from "../farm/artifacts/artifact.store";
import type { VaultService } from "../vault/vault.service";
import { LifecyclePurge } from "./lifecycle.purge";
import type { DuePurge, LifecycleRepository } from "./lifecycle.repository";

const WORKSPACE = "org-acme";
const NOW = new Date("2026-11-02T12:00:00Z");
const DUE: DuePurge = {
  organizationId: WORKSPACE,
  requestedBy: "user-owner",
  requestedAt: new Date("2026-10-03T12:00:00Z"),
};

/** A purge over recording doubles; `calls` is the order things happened in. */
function harness(options: { residual?: number; refs?: unknown[]; gone?: boolean } = {}) {
  const calls: string[] = [];
  const tombstones: unknown[] = [];
  const outbox: { eventType: string; payload: Record<string, unknown> }[] = [];
  const repository = {
    due: jest.fn(() => Promise.resolve([DUE])),
    identity: jest.fn(() =>
      Promise.resolve(options.gone === true ? undefined : { name: "acme-robotics", slug: "acme" }),
    ),
    artifactRefs: jest.fn(() =>
      Promise.resolve(
        options.refs ?? [
          { driver: "local", key: "org-acme/job-1/a.log" },
          { driver: "local", key: "org-acme/job-1/b.bin" },
        ],
      ),
    ),
    clearOutbox: jest.fn(() => {
      calls.push("clearOutbox");
      return Promise.resolve();
    }),
    residualRows: jest.fn(() => Promise.resolve(options.residual ?? 0)),
    tombstone: jest.fn((tombstone: unknown) => {
      calls.push("tombstone");
      tombstones.push(tombstone);
      return Promise.resolve();
    }),
    enqueue: jest.fn(
      (_db: unknown, _org: string, types: string[], payload: Record<string, unknown>) => {
        calls.push("enqueue");
        for (const eventType of types) outbox.push({ eventType, payload });
        return Promise.resolve();
      },
    ),
  };
  const vault = {
    destroy: jest.fn(() => {
      calls.push("destroyDek");
      return Promise.resolve(2);
    }),
  };
  const store = {
    driver: "local",
    delete: jest.fn((key: string) => {
      calls.push(`deleteArtifact:${key}`);
      return Promise.resolve();
    }),
  };
  const auth = {
    revokeSessions: jest.fn(),
    removeOrganization: jest.fn(() => {
      calls.push("removeOrganization");
      return Promise.resolve();
    }),
  };
  const purge = new LifecyclePurge(
    repository as unknown as LifecycleRepository,
    { db: {} } as DatabaseService,
    vault as unknown as VaultService,
    store as unknown as ArtifactStore,
    auth,
  );

  return { calls, tombstones, outbox, repository, vault, store, auth, purge };
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

  it("destroys the DEK before it removes anything else, and tombstones last", async () => {
    const { calls, purge } = harness();

    await purge.purge(DUE, NOW);

    expect(calls).toEqual([
      "destroyDek",
      "deleteArtifact:org-acme/job-1/a.log",
      "deleteArtifact:org-acme/job-1/b.bin",
      "clearOutbox",
      "removeOrganization",
      "tombstone",
      "enqueue",
    ]);
  });

  it("records what it did in the tombstone and the system's purge event", async () => {
    const { tombstones, outbox, purge } = harness();

    const report = await purge.purge(DUE, NOW);

    expect(report).toEqual({
      organizationId: WORKSPACE,
      dekVersionsDestroyed: 2,
      artifactsDeleted: 2,
      artifactsFailed: 0,
      rowsRemaining: 0,
    });
    expect(tombstones).toEqual([
      {
        organizationId: WORKSPACE,
        identity: { name: "acme-robotics", slug: "acme" },
        requestedBy: "user-owner",
        requestedAt: DUE.requestedAt,
        purgedAt: NOW,
        dekVersionsDestroyed: 2,
        artifactsDeleted: 2,
        rowsRemaining: 0,
      },
    ]);
    expect(outbox).toEqual([
      {
        eventType: "audit.workspace.purged",
        payload: expect.objectContaining({
          actorId: null,
          actor: "system",
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

  it("does nothing for a workspace that is already gone", async () => {
    const { vault, auth, purge } = harness({ gone: true });

    await expect(purge.purge(DUE, NOW)).resolves.toBeUndefined();
    expect(vault.destroy).not.toHaveBeenCalled();
    expect(auth.removeOrganization).not.toHaveBeenCalled();
  });

  it("sweeps every due workspace, and keeps going past one that fails", async () => {
    const { repository, vault, purge } = harness();
    repository.due.mockResolvedValueOnce([DUE, { ...DUE, organizationId: "org-two" }]);
    repository.identity.mockResolvedValueOnce({ name: "acme-robotics", slug: "acme" });
    vault.destroy.mockRejectedValueOnce(new Error("kms down"));

    const reports = await purge.sweep(NOW);

    expect(repository.due).toHaveBeenCalledWith(NOW);
    expect(reports.map((report) => report.organizationId)).toEqual(["org-two"]);
  });
});
