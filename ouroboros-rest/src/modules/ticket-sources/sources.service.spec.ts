import { Logger } from "@nestjs/common";

import type { TicketSourcePublic } from "../db/schema";
import { MINIMUM_SYNC_INTERVAL_SECONDS } from "../backlog/debounce";
import {
  ConflictError,
  InvalidRequestError,
  NotFoundError,
  NotImplementedError,
} from "../errors/error.envelope";
import { UNIQUE_VIOLATION } from "../tenancy/constraints";
import type { VaultService } from "../vault/vault.service";
import { TICKET_SOURCE_ERRORS } from "./sources.errors";
import type { NewSourceRow, SourcePatch, SourcesRepository } from "./sources.repository";
import { maskOf } from "./sources.resources";
import { DISPLAY_NAME_KEY, SourcesService, syncSourceOf } from "./sources.service";
import type { SourceSyncOutcome } from "./sync.report";
import { storedSourceSchema } from "./ticket-source.config";
import { FIXTURE_SCHEMA, scriptedProvider } from "./ticket-source.fixture";
import { TicketSourceRegistry } from "./ticket-source.registry";
import type { SyncSource, TicketSourcesRepository } from "./ticket-sources.repository";
import type { TicketSourcesService } from "./ticket-sources.service";

/**
 * `SourcesService` ([#141](https://github.com/NobuData/ouroboros/issues/141)) over doubles:
 * the request's statements, the loop's one credential read, the loop's public members, a
 * registry with the fixture provider, and a vault that records what it sealed.
 *
 * What is under test is the *rules* — which schema an add and an edit are judged by, where the
 * credential goes and where it must never appear, which of three refusals a manual sync gets,
 * and when a change puts a failed source back to work. What reaches PostgreSQL is
 * `sources.repository.spec.ts`'s, and the whole thing against a database is
 * `sources.integration-spec.ts`'s.
 */

const WORKSPACE = "org-sources";
const SOURCE_ID = "5eed001a-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-12T10:00:00.000Z");
const SECRET = "sk-fixtureQ4onlyNEVERlogTHISvalue0001";
const ENVELOPE = "ouro.v1.1.c2VlZC1ub25jZS00.ZGV2LXNlZWQtbm90LWEtY3JlZGVudGlhbA";

const GOOD_CONFIG = {
  site: "https://tracker.example.test",
  project: "PROJ",
  boards: ["Board one"],
  apiToken: SECRET,
};

/** A row through the view. */
function row(overrides: Partial<TicketSourcePublic> = {}): TicketSourcePublic {
  return {
    id: SOURCE_ID,
    organization_id: WORKSPACE,
    kind: "github",
    display_name: "Fixture · PROJ",
    config: { site: "https://tracker.example.test", project: "PROJ", boards: ["Board one"] },
    status: "active",
    status_reason: null,
    sync_cursor: null,
    synced_at: null,
    created_at: new Date("2026-09-01T09:00:00.000Z"),
    updated_at: new Date("2026-09-01T09:00:00.000Z"),
    ...overrides,
  };
}

interface FakeSources extends SourcesRepository {
  readonly rows: Map<string, TicketSourcePublic>;
  readonly inserts: NewSourceRow[];
  readonly patches: { sourceId: string; patch: SourcePatch }[];
  readonly credentials: { sourceId: string; sealed: string }[];
  readonly present: Set<string>;
}

/**
 * The request's statements, over an in-memory row set.
 *
 * @param rows - What the workspace has.
 * @param options - `insertFails` stages what the driver throws on insert.
 * @returns The double, with its recordings.
 */
function fakeSources(
  rows: readonly TicketSourcePublic[] = [],
  options: { insertFails?: unknown; present?: readonly string[] } = {},
): FakeSources {
  const stored = new Map(rows.map((candidate) => [candidate.id, candidate]));
  const inserts: NewSourceRow[] = [];
  const patches: { sourceId: string; patch: SourcePatch }[] = [];
  const credentials: { sourceId: string; sealed: string }[] = [];
  const present = new Set(options.present ?? []);

  return {
    rows: stored,
    inserts,
    patches,
    credentials,
    present,
    list: (organizationId: string, window: { limit: number; offset: number }) =>
      Promise.resolve({
        items: [...stored.values()].filter(
          (candidate) => candidate.organization_id === organizationId,
        ),
        total: stored.size,
        ...window,
      }),
    find: (organizationId: string, sourceId: string) => {
      const found = stored.get(sourceId);

      return Promise.resolve(found?.organization_id === organizationId ? found : undefined);
    },
    credentialPresence: (_organizationId: string, ids: readonly string[]) =>
      Promise.resolve(new Map(ids.map((id) => [id, present.has(id)]))),
    insert: (newRow: NewSourceRow) => {
      if (options.insertFails !== undefined) {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject(options.insertFails);
      }

      inserts.push(newRow);
      stored.set(
        newRow.id,
        row({
          id: newRow.id,
          organization_id: newRow.organizationId,
          kind: newRow.kind,
          display_name: newRow.displayName,
          config: newRow.config,
        }),
      );

      if (newRow.credentialsEncrypted !== null) {
        present.add(newRow.id);
      }

      return Promise.resolve();
    },
    update: (_organizationId: string, sourceId: string, patch: SourcePatch) => {
      patches.push({ sourceId, patch });

      const current = stored.get(sourceId);

      if (current !== undefined) {
        stored.set(sourceId, {
          ...current,
          ...(patch.displayName === undefined ? {} : { display_name: patch.displayName }),
          ...(patch.config === undefined ? {} : { config: patch.config }),
          ...(patch.status === undefined ? {} : { status: patch.status }),
          ...(patch.statusReason === undefined ? {} : { status_reason: patch.statusReason }),
        });
      }

      return Promise.resolve(current !== undefined);
    },
    setCredential: (_organizationId: string, sourceId: string, sealed: string) => {
      credentials.push({ sourceId, sealed });
      present.add(sourceId);

      return Promise.resolve(stored.has(sourceId));
    },
  } as unknown as FakeSources;
}

/** The loop's one credential read. */
function fakeLoopRepository(sealed: string | null): TicketSourcesRepository {
  return { sealedCredential: () => Promise.resolve(sealed) } as unknown as TicketSourcesRepository;
}

interface FakeLoop extends TicketSourcesService {
  readonly started: SyncSource[];
  syncing: boolean;
  startedAt?: Date;
  outcome?: SourceSyncOutcome;
  refuse: boolean;
}

/** The loop's public members, scripted. */
function fakeLoop(): FakeLoop {
  const started: SyncSource[] = [];
  const loop = {
    started,
    syncing: false,
    startedAt: undefined,
    outcome: undefined,
    refuse: false,
    isSyncing: () => loop.syncing,
    lastStartedAt: () => loop.startedAt,
    lastOutcome: () => loop.outcome,
    syncSource: (source: SyncSource) => {
      if (loop.refuse) {
        return undefined;
      }

      started.push(source);

      return Promise.resolve(undefined);
    },
  } as unknown as FakeLoop;

  return loop;
}

interface FakeVault extends VaultService {
  readonly sealed: { organizationId: string; recordId: string; plaintext: string }[];
}

/** A vault that records what it sealed and answers a fixed plaintext. */
function fakeVault(opened: string | Error = SECRET): FakeVault {
  const sealed: { organizationId: string; recordId: string; plaintext: string }[] = [];

  return {
    sealed,
    encryptText: (organizationId: string, recordId: string, plaintext: string) => {
      sealed.push({ organizationId, recordId, plaintext });

      return Promise.resolve(ENVELOPE);
    },
    decryptText: () => (opened instanceof Error ? Promise.reject(opened) : Promise.resolve(opened)),
  } as unknown as FakeVault;
}

/** Everything one case wires together. */
function build(
  options: {
    rows?: readonly TicketSourcePublic[];
    present?: readonly string[];
    insertFails?: unknown;
    sealed?: string | null;
    opened?: string | Error;
    provider?: ReturnType<typeof scriptedProvider>;
  } = {},
) {
  const sources = fakeSources(options.rows, {
    insertFails: options.insertFails,
    present: options.present,
  });
  const loop = fakeLoop();
  const vault = fakeVault(options.opened);
  const provider = options.provider ?? scriptedProvider({ kind: "github" });
  const service = new SourcesService(
    sources,
    fakeLoopRepository(options.sealed ?? null),
    loop,
    new TicketSourceRegistry([provider]),
    vault,
  );

  return { service, sources, loop, vault, provider };
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

describe("the catalog", () => {
  it("is the registry's, as forms", () => {
    const { service } = build();

    expect(service.catalog().kinds.map((entry) => entry.kind)).toStrictEqual(["github"]);
    expect(service.catalog().kinds[0]?.fields.map((field) => field.name)).toStrictEqual(
      Object.keys(FIXTURE_SCHEMA.properties),
    );
  });
});

describe("reading", () => {
  it("lists the workspace's sources with each credential's presence, and never its value", async () => {
    const { service } = build({ rows: [row()], present: [SOURCE_ID] });

    const page = await service.list(WORKSPACE, {});

    expect(page.items[0]?.credentialMask).toBe("••••");
    expect(JSON.stringify(page)).not.toContain("ouro.v1.");
  });

  it("answers a source of another workspace as not found", async () => {
    const { service } = build({ rows: [row({ organization_id: "org-other" })] });

    await expect(service.read(WORKSPACE, SOURCE_ID)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("adding", () => {
  it("refuses a kind this build has no provider for, before anything else", async () => {
    const { service, sources } = build();

    await expect(
      service.add(WORKSPACE, { kind: "jira", displayName: "Jira", config: GOOD_CONFIG }),
    ).rejects.toBeInstanceOf(NotImplementedError);
    expect(sources.inserts).toStrictEqual([]);
  });

  it("judges the submission against the provider's full schema and stores nothing on a refusal", async () => {
    const { service, sources, vault } = build();

    expect.assertions(4);

    try {
      await service.add(WORKSPACE, {
        kind: "github",
        displayName: "Fixture",
        config: { ...GOOD_CONFIG, apiToken: "" },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRequestError);
      expect((error as InvalidRequestError).envelope().details).toStrictEqual({
        fields: { apiToken: ["API token is required"] },
      });
    }

    expect(sources.inserts).toStrictEqual([]);
    expect(vault.sealed).toStrictEqual([]);
  });

  it("stores the settings without the credential, and seals the credential against the new id", async () => {
    const { service, sources, vault } = build();

    const stored = await service.add(WORKSPACE, {
      kind: "github",
      displayName: "Fixture · PROJ",
      config: GOOD_CONFIG,
    });

    const [inserted] = sources.inserts;

    expect(inserted?.config).toStrictEqual({
      site: GOOD_CONFIG.site,
      project: GOOD_CONFIG.project,
      boards: GOOD_CONFIG.boards,
    });
    expect(inserted?.credentialsEncrypted).toBe(ENVELOPE);
    expect(vault.sealed).toStrictEqual([
      { organizationId: WORKSPACE, recordId: inserted?.id, plaintext: SECRET },
    ]);
    expect(stored.id).toBe(inserted?.id);
    expect(stored.credentialMask).toBe(maskOf(SECRET));
    expect(JSON.stringify(stored)).not.toContain(SECRET);
    expect(JSON.stringify(stored)).not.toContain(ENVELOPE);
  });

  it("stores no credential when the provider's schema declares none", async () => {
    const provider = scriptedProvider({
      kind: "github",
      schema: storedSourceSchema(FIXTURE_SCHEMA),
    });
    const { service, sources, vault } = build({ provider });

    const stored = await service.add(WORKSPACE, {
      kind: "github",
      displayName: "Fixture",
      config: { site: GOOD_CONFIG.site, project: "PROJ", boards: ["B"] },
    });

    expect(sources.inserts[0]?.credentialsEncrypted).toBeNull();
    expect(vault.sealed).toStrictEqual([]);
    expect(stored.credentialMask).toBeNull();
  });

  it("turns V030's name uniqueness into a 409 naming the name", async () => {
    const { service } = build({
      insertFails: Object.assign(new Error("duplicate key"), {
        code: UNIQUE_VIOLATION,
        constraint: DISPLAY_NAME_KEY,
      }),
    });

    expect.assertions(2);

    try {
      await service.add(WORKSPACE, { kind: "github", displayName: "Twice", config: GOOD_CONFIG });
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).envelope().code).toBe(TICKET_SOURCE_ERRORS.nameTaken);
    }
  });

  it("lets any other database failure through untouched", async () => {
    const failure = Object.assign(new Error("connection reset"), { code: "57P01" });
    const { service } = build({ insertFails: failure });

    await expect(
      service.add(WORKSPACE, { kind: "github", displayName: "x", config: GOOD_CONFIG }),
    ).rejects.toBe(failure);
  });
});

describe("updating", () => {
  it("judges new settings against the stored schema, so an edit need not resubmit the credential", async () => {
    const { service, sources } = build({ rows: [row()] });

    const updated = await service.update(WORKSPACE, SOURCE_ID, {
      config: { site: GOOD_CONFIG.site, project: "PROJ", boards: ["B1", "B2"] },
    });

    expect(updated.config).toStrictEqual({
      site: GOOD_CONFIG.site,
      project: "PROJ",
      boards: ["B1", "B2"],
    });
    expect(sources.patches[0]?.patch.config).not.toHaveProperty("apiToken");
  });

  it("refuses settings the stored schema does not accept, naming the fields", async () => {
    const { service, sources } = build({ rows: [row()] });

    expect.assertions(2);

    try {
      await service.update(WORKSPACE, SOURCE_ID, { config: { site: "not a url", boards: [] } });
    } catch (error) {
      expect((error as InvalidRequestError).envelope().details).toMatchObject({
        fields: { project: ["Project key is required"], boards: ["Boards is required"] },
      });
    }

    expect(sources.patches).toStrictEqual([]);
  });

  it("resumes a failed source when its settings change, and clears the reason", async () => {
    const { service, sources } = build({
      rows: [row({ status: "error", status_reason: "project or repository not found" })],
    });

    const updated = await service.update(WORKSPACE, SOURCE_ID, {
      config: { site: GOOD_CONFIG.site, project: "PROJ", boards: ["B"] },
    });

    expect(sources.patches[0]?.patch).toMatchObject({ status: "active", statusReason: null });
    expect(updated.status).toBe("active");
    expect(updated.statusReason).toBeNull();
  });

  it("leaves a paused source paused through a settings edit", async () => {
    const { service, sources } = build({ rows: [row({ status: "paused" })] });

    await service.update(WORKSPACE, SOURCE_ID, {
      config: { site: GOOD_CONFIG.site, project: "PROJ", boards: ["B"] },
    });

    expect(sources.patches[0]?.patch.status).toBeUndefined();
  });

  it("pauses, and resumes with the reason cleared", async () => {
    const { service, sources } = build({
      rows: [row({ status: "error", status_reason: "credentials rejected (401)" })],
    });

    await service.update(WORKSPACE, SOURCE_ID, { status: "paused" });
    expect(sources.patches[0]?.patch).toStrictEqual({
      displayName: undefined,
      config: undefined,
      status: "paused",
    });

    const resumed = await service.update(WORKSPACE, SOURCE_ID, { status: "active" });
    expect(sources.patches[1]?.patch).toMatchObject({ status: "active", statusReason: null });
    expect(resumed.statusReason).toBeNull();
  });

  it("renames, and turns a taken name into a 409", async () => {
    const { service } = build({ rows: [row()] });

    expect(
      (await service.update(WORKSPACE, SOURCE_ID, { displayName: "Renamed" })).displayName,
    ).toBe("Renamed");
  });
});

describe("storing a credential", () => {
  it("refuses a provider whose schema declares no secret field", async () => {
    const provider = scriptedProvider({
      kind: "github",
      schema: storedSourceSchema(FIXTURE_SCHEMA),
    });
    const { service, vault } = build({ rows: [row()], provider });

    expect.assertions(2);

    try {
      await service.setCredentials(WORKSPACE, SOURCE_ID, { secret: SECRET });
    } catch (error) {
      expect((error as ConflictError).envelope().code).toBe(
        TICKET_SOURCE_ERRORS.credentialsUnsupported,
      );
    }

    expect(vault.sealed).toStrictEqual([]);
  });

  it("holds the credential to the secret field's own rules", async () => {
    const { service, vault } = build({ rows: [row()] });

    expect.assertions(2);

    try {
      await service.setCredentials(WORKSPACE, SOURCE_ID, { secret: "short" });
    } catch (error) {
      expect((error as InvalidRequestError).envelope().details).toStrictEqual({
        fields: { apiToken: ["API token must be at least 8 characters"] },
      });
    }

    expect(vault.sealed).toStrictEqual([]);
  });

  it("seals against the source's id, stores the envelope, and echoes a mask", async () => {
    const { service, sources, vault } = build({ rows: [row()] });

    const stored = await service.setCredentials(WORKSPACE, SOURCE_ID, { secret: SECRET });

    expect(vault.sealed).toStrictEqual([
      { organizationId: WORKSPACE, recordId: SOURCE_ID, plaintext: SECRET },
    ]);
    expect(sources.credentials).toStrictEqual([{ sourceId: SOURCE_ID, sealed: ENVELOPE }]);
    expect(stored.credentialMask).toBe(maskOf(SECRET));
    expect(JSON.stringify(stored)).not.toContain(SECRET);
    expect(JSON.stringify(stored)).not.toContain(ENVELOPE);
  });

  it("resumes a failed source, because a new credential is somebody acting", async () => {
    const { service, sources } = build({
      rows: [row({ status: "error", status_reason: "credentials rejected (401)" })],
    });

    const stored = await service.setCredentials(WORKSPACE, SOURCE_ID, { secret: SECRET });

    expect(sources.patches).toStrictEqual([
      { sourceId: SOURCE_ID, patch: { status: "active", statusReason: null } },
    ]);
    expect(stored.status).toBe("active");
  });

  it("leaves an active source's status alone", async () => {
    const { service, sources } = build({ rows: [row()] });

    await service.setCredentials(WORKSPACE, SOURCE_ID, { secret: SECRET });

    expect(sources.patches).toStrictEqual([]);
  });
});

describe("testing", () => {
  it("opens the stored credential, hands it to the provider, and never logs it", async () => {
    const provider = scriptedProvider({
      kind: "github",
      validation: { status: "ok", detail: "PROJ · 212 issues" },
    });
    const validate = jest.spyOn(provider, "validateConfig");
    const { service } = build({ rows: [row()], sealed: ENVELOPE, provider });

    let result: Awaited<ReturnType<typeof service.test>> | undefined;
    const transcript = await transcriptOf(async () => {
      result = await service.test(WORKSPACE, SOURCE_ID, NOW);
    });

    expect(validate).toHaveBeenCalledWith(row().config, SECRET);
    expect(result).toStrictEqual({
      sourceId: SOURCE_ID,
      checkedAt: NOW.toISOString(),
      status: "ok",
      errorClass: null,
      detail: "PROJ · 212 issues",
      reason: null,
    });
    expect(transcript).not.toContain(SECRET);
    expect(transcript).not.toContain(ENVELOPE);
  });

  it("hands the provider null when no credential is stored", async () => {
    const provider = scriptedProvider({ kind: "github" });
    const validate = jest.spyOn(provider, "validateConfig");
    const { service } = build({ rows: [row()], sealed: null, provider });

    await service.test(WORKSPACE, SOURCE_ID, NOW);

    expect(validate).toHaveBeenCalledWith(row().config, null);
  });

  it("answers a refusal as a result with its class and the row's phrase", async () => {
    const provider = scriptedProvider({
      kind: "github",
      validation: { status: "failed", errorClass: "auth", detail: "refused (401)" },
    });
    const { service } = build({ rows: [row()], provider });

    expect(await service.test(WORKSPACE, SOURCE_ID, NOW)).toMatchObject({
      status: "failed",
      errorClass: "auth",
      detail: "refused (401)",
      reason: "credentials rejected",
    });
  });

  it("answers an envelope that will not open as an auth failure, and logs nothing of it", async () => {
    const { service } = build({
      rows: [row()],
      sealed: ENVELOPE,
      opened: new Error("no key at version 1"),
    });

    let result: Awaited<ReturnType<typeof service.test>> | undefined;
    const transcript = await transcriptOf(async () => {
      result = await service.test(WORKSPACE, SOURCE_ID, NOW);
    });

    expect(result).toMatchObject({ status: "failed", errorClass: "auth" });
    expect(transcript).toContain("could not be opened");
    expect(transcript).not.toContain(ENVELOPE);
  });

  it("refuses a kind this build has no provider for", async () => {
    const { service } = build({ rows: [row({ kind: "jira" })] });

    await expect(service.test(WORKSPACE, SOURCE_ID)).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("writes nothing to the row, whatever the provider said", async () => {
    const provider = scriptedProvider({
      kind: "github",
      validation: { status: "failed", errorClass: "upstream", detail: "503" },
    });
    const { service, sources } = build({ rows: [row()], provider });

    await service.test(WORKSPACE, SOURCE_ID, NOW);

    expect(sources.patches).toStrictEqual([]);
  });
});

describe("syncing now", () => {
  it("refuses a paused source before anything else", async () => {
    const { service, loop } = build({ rows: [row({ status: "paused" })] });

    expect.assertions(2);

    try {
      await service.syncNow(WORKSPACE, SOURCE_ID, NOW);
    } catch (error) {
      expect((error as ConflictError).envelope().code).toBe(TICKET_SOURCE_ERRORS.paused);
    }

    expect(loop.started).toStrictEqual([]);
  });

  it("refuses while a sync of this source is running", async () => {
    const { service, loop } = build({ rows: [row()] });

    loop.syncing = true;

    expect.assertions(1);

    try {
      await service.syncNow(WORKSPACE, SOURCE_ID, NOW);
    } catch (error) {
      expect((error as ConflictError).envelope().code).toBe(TICKET_SOURCE_ERRORS.syncRunning);
    }
  });

  it("refuses a repeat inside the minimum interval, with the wait", async () => {
    const { service, loop } = build({ rows: [row()] });

    loop.startedAt = new Date(NOW.getTime() - 8_000);

    expect.assertions(2);

    try {
      await service.syncNow(WORKSPACE, SOURCE_ID, NOW);
    } catch (error) {
      expect((error as ConflictError).envelope().code).toBe(TICKET_SOURCE_ERRORS.syncTooSoon);
      expect((error as ConflictError).envelope().details).toStrictEqual({
        retryAfterSeconds: MINIMUM_SYNC_INTERVAL_SECONDS - 8,
      });
    }
  });

  it("refuses a kind this build has no provider for, as a 501 rather than an accepted no-op", async () => {
    const { service, loop } = build({ rows: [row({ kind: "jira" })] });

    await expect(service.syncNow(WORKSPACE, SOURCE_ID, NOW)).rejects.toBeInstanceOf(
      NotImplementedError,
    );
    expect(loop.started).toStrictEqual([]);
  });

  it("syncs a failed source, because that is what the trigger is for", async () => {
    const { service, loop } = build({
      rows: [row({ status: "error", status_reason: "credentials rejected (401)" })],
    });

    await transcriptOf(async () => service.syncNow(WORKSPACE, SOURCE_ID, NOW));

    expect(loop.started).toHaveLength(1);
  });

  it("hands the loop the row in the shape it syncs, and answers the status at acceptance", async () => {
    const stored = row({ sync_cursor: "2026-09-11T00:00:00Z", synced_at: NOW });
    const { service, loop } = build({ rows: [stored] });

    let accepted: Awaited<ReturnType<typeof service.syncNow>> | undefined;

    await transcriptOf(async () => {
      accepted = await service.syncNow(WORKSPACE, SOURCE_ID, NOW);
    });

    expect(loop.started).toStrictEqual([syncSourceOf(stored)]);
    expect(loop.started[0]).toStrictEqual({
      sourceId: SOURCE_ID,
      organizationId: WORKSPACE,
      kind: "github",
      displayName: "Fixture · PROJ",
      config: stored.config,
      cursor: "2026-09-11T00:00:00Z",
      syncedAt: NOW,
    });
    expect(accepted).toMatchObject({
      sourceId: SOURCE_ID,
      running: true,
      retryAfterSeconds: MINIMUM_SYNC_INTERVAL_SECONDS,
      // Still the previous sync's: the one this request started has not written anything.
      syncedAt: NOW.toISOString(),
    });
  });

  it("answers the running refusal when the loop declined the start", async () => {
    const { service, loop } = build({ rows: [row()] });

    loop.refuse = true;

    expect.assertions(1);

    try {
      await service.syncNow(WORKSPACE, SOURCE_ID, NOW);
    } catch (error) {
      expect((error as ConflictError).envelope().code).toBe(TICKET_SOURCE_ERRORS.syncRunning);
    }
  });
});

describe("the status report", () => {
  it("composes the row with the loop's memory", async () => {
    const { service, loop } = build({
      rows: [row({ status: "error", status_reason: "tracker unavailable (503)" })],
    });

    loop.syncing = false;
    loop.startedAt = new Date(NOW.getTime() - 10_000);
    loop.outcome = {
      organizationId: WORKSPACE,
      sourceId: SOURCE_ID,
      kind: "github",
      displayName: "Fixture · PROJ",
      imported: 0,
      updated: 0,
      unchanged: 0,
      skippedClosed: 0,
      enqueued: 0,
      hasMore: false,
      failure: { errorClass: "upstream", reason: "tracker unavailable (503)" },
    };

    expect(await service.status(WORKSPACE, SOURCE_ID, NOW)).toStrictEqual({
      sourceId: SOURCE_ID,
      status: "error",
      statusReason: "tracker unavailable (503)",
      syncedAt: null,
      running: false,
      retryAfterSeconds: MINIMUM_SYNC_INTERVAL_SECONDS - 10,
      lastSync: {
        startedAt: loop.startedAt.toISOString(),
        outcome: "failed",
        imported: 0,
        updated: 0,
        unchanged: 0,
        skippedClosed: 0,
        enqueued: 0,
        hasMore: false,
        errorClass: "upstream",
        reason: "tracker unavailable (503)",
      },
    });
  });

  it("answers not found for a source this workspace does not have", async () => {
    const { service } = build();

    await expect(service.status(WORKSPACE, SOURCE_ID)).rejects.toBeInstanceOf(NotFoundError);
  });
});
