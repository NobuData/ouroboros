import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { AppConfigService } from "../config/config.service";
import { SCHEMA_NAME } from "../db/schema";
import { ConflictError, type ErrorEnvelope } from "../errors/error.envelope";
import { httpError } from "../github/github.fixture";
import { GithubRateLimiter } from "../github/github.rate-limit";
import { SUFFIX_LENGTH } from "../provider-connections/masking";
import { ADMINISTRATORS } from "../tenancy/roles.guard";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { VaultService } from "../vault/vault.service";
import { GithubTicketSourceProvider } from "./providers/github.provider";
import {
  SOURCE_LOGIN,
  SOURCE_REPO,
  issuePayload,
  recordingFactory,
  scriptedOctokit,
  type OctokitScript,
} from "./providers/github.provider.fixture";
import { TICKET_SOURCE_ERRORS } from "./sources.errors";
import { SourcesRepository } from "./sources.repository";
import type {
  TicketSourceCatalogResource,
  TicketSourceResource,
  TicketSourceStatusResource,
  TicketSourceTestResource,
} from "./sources.resources";
import { SourcesService } from "./sources.service";
import { TicketSourceRegistry } from "./ticket-source.registry";
import { TicketSourcesRepository } from "./ticket-sources.repository";
import { TicketSourcesService } from "./ticket-sources.service";

/**
 * The source-management API against a migrated database
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * The acceptance criteria, in the issue's words, and where each is held:
 *
 *   * **Add a GitHub source → test connection → sync → tickets appear.** The add and the
 *     credential go through HTTP into V030's columns, sealed by the real vault; the test and
 *     the sync run through `SourcesService` over the **real** GitHub provider against a
 *     scripted GitHub — the same double `ticket-sources.integration-spec.ts` drives the loop
 *     with — and the tickets are read back out of `tickets`.
 *   * **Credentials are never echoed by any endpoint.** Every body a token could reach is
 *     searched for the token, every five-character window of it, and the vault's envelope
 *     prefix.
 *   * **A member sees the surface read-only; owner/admin can write.** The role matrix, with
 *     the does-not-write half asserted on the table.
 *   * **Sync trigger is debounced; a status shows the honest pause reason.** A second sync
 *     inside the interval is the `409` with its wait; a paused source is refused before
 *     anything is spent; a failure lands in V031's column and the status reads it back.
 *
 * The test and the sync are driven through a service built here rather than through the
 * running application's, for the reason the loop's own integration spec gives: the harness
 * boots the real module with the real provider, and a real provider over a real network is
 * not what a suite should depend on. What the HTTP layer adds to those two operations — the
 * role gate, the `404`, the `501`, the `409` for a paused source — is asserted over HTTP, where
 * none of it reaches a tracker.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

const SOURCES = "/api/v1/sources";
// Letters chosen so no five-character window of it is a word the catalog's own prose could
// contain — "integration" carries "ation", which "organization" does too.
const TOKEN = "ghp_q4zX7vK2mN9bL5tR8wY1cF3hJ6pS0uD4gE";

/** Every window of the token a suffix-shaped leak could show. */
const TOKEN_WINDOWS: string[] = Array.from(
  { length: TOKEN.length - SUFFIX_LENGTH },
  (_value, start) => TOKEN.slice(start, start + SUFFIX_LENGTH + 1),
);

/** A GitHub source's add body, as the settings form sends it. */
function githubBody(displayName = "GitHub · acme-robotics") {
  return {
    kind: "github",
    displayName,
    config: { login: SOURCE_LOGIN, repos: [SOURCE_REPO], token: TOKEN },
  };
}

/** What a source's row holds, straight from the table. */
interface StoredSource {
  status: string;
  status_reason: string | null;
  credentials_encrypted: string | null;
  config: Record<string, unknown>;
  synced_at: Date | null;
}

describe("the source-management API, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    // A day, so the application's own loop cannot fire a cycle in the middle of a test.
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());

  afterEach(() => api.truncate());

  /** An owner and their workspace. */
  async function owned(): Promise<{ owner: Person; workspace: Workspace }> {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);

    return { owner, workspace };
  }

  /** The row, from the table. */
  async function stored(sourceId: string): Promise<StoredSource> {
    const { rows } = await api.sql.query<StoredSource>(
      `select status, status_reason, credentials_encrypted, config, synced_at
         from ${SCHEMA_NAME}.ticket_sources where id = $1`,
      [sourceId],
    );

    return rows[0];
  }

  /** Add a GitHub source over HTTP, as the owner. */
  async function added(
    owner: Person,
    workspace: Workspace,
    displayName?: string,
  ): Promise<TicketSourceResource> {
    return bodyOf<TicketSourceResource>(
      await api
        .as(owner)("post", SOURCES)
        .set(TENANT_HEADER, workspace.slug)
        .send(githubBody(displayName))
        .expect(201),
    );
  }

  /**
   * The management service over the real GitHub provider and a scripted GitHub.
   *
   * @param script - What each repository answers.
   * @returns The service, and the loop it hands syncs to — so a spec can wait for one.
   */
  function serviceOver(script: OctokitScript): {
    service: SourcesService;
    loop: TicketSourcesService;
  } {
    const provider = new GithubTicketSourceProvider(
      recordingFactory(scriptedOctokit(script)).factory,
      new GithubRateLimiter(),
    );
    const registry = new TicketSourceRegistry([provider]);
    const loop = new TicketSourcesService(
      api.nest.get(TicketSourcesRepository),
      registry,
      api.nest.get(VaultService),
      { accept: () => Promise.resolve() },
    );
    const service = new SourcesService(
      api.nest.get(SourcesRepository),
      api.nest.get(TicketSourcesRepository),
      loop,
      registry,
      api.nest.get(VaultService),
      api.nest.get(AppConfigService),
    );

    return { service, loop };
  }

  /** Wait for a manual sync of one source to settle. */
  async function settled(loop: TicketSourcesService, sourceId: string): Promise<void> {
    for (let attempt = 0; attempt < 100 && loop.isSyncing(sourceId); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(loop.isSyncing(sourceId)).toBe(false);
  }

  /** Assert a payload carries no trace of the token or of a sealed envelope. */
  function expectNoSecretIn(payload: unknown): void {
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain("ouro.v1.");

    for (const window of TOKEN_WINDOWS) {
      expect(serialized).not.toContain(window);
    }
  }

  describe("who may ask", () => {
    it("refuses a stranger", async () => {
      await api.anonymous("get", SOURCES).expect(401);
      await api.anonymous("post", SOURCES).expect(401);
      await api.anonymous("get", `${SOURCES}/catalog`).expect(401);
    });

    it("asks a session acting in no workspace to choose one", async () => {
      const nomad = await api.signIn();

      const response = await api.as(nomad)("get", SOURCES).expect(400);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("organization_required");
    });
  });

  describe("the role matrix", () => {
    it("lets a viewer read the list, the catalog, a source and its status", async () => {
      const { owner, workspace } = await owned();
      const source = await added(owner, workspace);
      const viewer = await api.signIn();
      await api.join(workspace.id, viewer, "viewer");
      const as = api.as(viewer);

      const listed = bodyOf<{ items: TicketSourceResource[] }>(
        await as("get", SOURCES).set(TENANT_HEADER, workspace.slug).expect(200),
      );
      const catalog = bodyOf<TicketSourceCatalogResource>(
        await as("get", `${SOURCES}/catalog`).set(TENANT_HEADER, workspace.slug).expect(200),
      );
      const status = bodyOf<TicketSourceStatusResource>(
        await as("get", `${SOURCES}/${source.id}/status`)
          .set(TENANT_HEADER, workspace.slug)
          .expect(200),
      );

      await as("get", `${SOURCES}/${source.id}`).set(TENANT_HEADER, workspace.slug).expect(200);

      expect(listed.items.map((item) => item.id)).toStrictEqual([source.id]);
      expect(catalog.kinds.map((entry) => entry.kind)).toStrictEqual(["github"]);
      expect(status).toMatchObject({ sourceId: source.id, status: "active", running: false });
    });

    it("refuses a member every write with the API's one 403, and writes nothing", async () => {
      const { owner, workspace } = await owned();
      const source = await added(owner, workspace);
      const member = await api.signIn();
      await api.join(workspace.id, member, "member");
      const as = api.as(member);
      const before = await stored(source.id);

      for (const [method, path, body] of [
        ["post", SOURCES, githubBody("Second")],
        ["patch", `${SOURCES}/${source.id}`, { status: "paused" }],
        ["post", `${SOURCES}/${source.id}/credentials`, { secret: "ghp_other" }],
        ["post", `${SOURCES}/${source.id}/test`, undefined],
        ["post", `${SOURCES}/${source.id}/sync`, undefined],
      ] as const) {
        const response = await as(method, path)
          .set(TENANT_HEADER, workspace.slug)
          .send(body)
          .expect(403);

        expect(bodyOf<ErrorEnvelope>(response)).toMatchObject({
          code: "forbidden",
          details: { role: "member", required: [...ADMINISTRATORS] },
        });
      }

      expect(await stored(source.id)).toStrictEqual(before);

      const { rows } = await api.sql.query<{ count: string }>(
        `select count(*) from ${SCHEMA_NAME}.ticket_sources where organization_id = $1`,
        [workspace.id],
      );

      expect(rows[0]?.count).toBe("1");
    });

    it("lets an admin write as an owner does", async () => {
      const { owner, workspace } = await owned();
      const admin = await api.signIn();
      await api.join(workspace.id, admin, "admin");

      const source = await added(admin, workspace);

      await api
        .as(admin)("patch", `${SOURCES}/${source.id}`)
        .set(TENANT_HEADER, workspace.slug)
        .send({ status: "paused" })
        .expect(200);

      expect((await stored(source.id)).status).toBe("paused");
      void owner;
    });
  });

  describe("adding a source", () => {
    it("stores the settings without the token, seals the token against the row, and echoes a mask", async () => {
      const { owner, workspace } = await owned();

      const source = await added(owner, workspace);
      const row = await stored(source.id);

      expect(source).toMatchObject({
        kind: "github",
        displayName: "GitHub · acme-robotics",
        config: { login: SOURCE_LOGIN, repos: [SOURCE_REPO] },
        status: "active",
        statusReason: null,
        credentialMask: `••••${TOKEN.slice(-SUFFIX_LENGTH)}`,
        syncedAt: null,
      });
      expect(row.config).toStrictEqual({ login: SOURCE_LOGIN, repos: [SOURCE_REPO] });
      expect(row.credentials_encrypted).toMatch(/^ouro\.v1\.\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      // Sealed against *this* row: the vault binds the record id into the AAD, so the loop's
      // own open — with the source id — is what proves the pair.
      await expect(
        api.nest.get(VaultService).decryptText(workspace.id, source.id, row.credentials_encrypted!),
      ).resolves.toBe(TOKEN);
    });

    it("refuses what the provider's schema refuses, naming every field, and stores nothing", async () => {
      const { owner, workspace } = await owned();

      const response = await api
        .as(owner)("post", SOURCES)
        .set(TENANT_HEADER, workspace.slug)
        .send({
          kind: "github",
          displayName: "Broken",
          config: { login: "acme/robotics", repos: [], token: "" },
        })
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(response)).toMatchObject({
        code: TICKET_SOURCE_ERRORS.configInvalid,
        details: {
          fields: {
            login: ["GitHub account is not in the expected format"],
            repos: ["Repositories is required"],
            token: ["Personal access token is required"],
          },
        },
      });

      const { rows } = await api.sql.query(
        `select 1 from ${SCHEMA_NAME}.ticket_sources where organization_id = $1`,
        [workspace.id],
      );

      expect(rows).toHaveLength(0);
    });

    it("refuses a kind this build has no provider for, with the 501 naming what it has", async () => {
      const { owner, workspace } = await owned();

      const response = await api
        .as(owner)("post", SOURCES)
        .set(TENANT_HEADER, workspace.slug)
        .send({ kind: "jira", displayName: "Jira · PROJ", config: { project_keys: ["PROJ"] } })
        .expect(501);

      expect(bodyOf<ErrorEnvelope>(response)).toMatchObject({
        code: "ticket_source_kind_unsupported",
        details: { kind: "jira", registered: ["github"] },
      });
    });

    it("refuses a second source with the same name, through V030's own constraint", async () => {
      const { owner, workspace } = await owned();
      await added(owner, workspace, "Twice");

      const response = await api
        .as(owner)("post", SOURCES)
        .set(TENANT_HEADER, workspace.slug)
        .send(githubBody("Twice"))
        .expect(409);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe(TICKET_SOURCE_ERRORS.nameTaken);
    });
  });

  describe("the credential", () => {
    it("is echoed by no endpoint, in any form", async () => {
      const { owner, workspace } = await owned();
      const as = api.as(owner);
      const source = await added(owner, workspace);

      const bodies = await Promise.all([
        as("get", SOURCES).set(TENANT_HEADER, workspace.slug).expect(200),
        as("get", `${SOURCES}/${source.id}`).set(TENANT_HEADER, workspace.slug).expect(200),
        as("get", `${SOURCES}/${source.id}/status`).set(TENANT_HEADER, workspace.slug).expect(200),
        as("get", `${SOURCES}/catalog`).set(TENANT_HEADER, workspace.slug).expect(200),
      ]);

      for (const response of bodies) {
        expectNoSecretIn(response.body);
      }

      // The add's own answer carries the four-character suffix and nothing longer.
      expect(JSON.stringify(source)).not.toContain(TOKEN);
      expect(JSON.stringify(source)).not.toContain(TOKEN.slice(-(SUFFIX_LENGTH + 1)));
      expect(bodyOf<TicketSourceResource>(bodies[1]).credentialMask).toBe("••••");
    });

    it("is replaced write-only, sealed against the row, with a masked echo", async () => {
      const { owner, workspace } = await owned();
      const source = await added(owner, workspace);
      const replacement = "ghp_r2pL8vN4kQ7mX1zB6tW9yC3fH5jS0uG2dE";

      const response = await api
        .as(owner)("post", `${SOURCES}/${source.id}/credentials`)
        .set(TENANT_HEADER, workspace.slug)
        .send({ secret: replacement })
        .expect(200);
      const echoed = bodyOf<TicketSourceResource>(response);

      expect(echoed.credentialMask).toBe(`••••${replacement.slice(-SUFFIX_LENGTH)}`);
      expect(JSON.stringify(echoed)).not.toContain(replacement);
      await expect(
        api.nest
          .get(VaultService)
          .decryptText(workspace.id, source.id, (await stored(source.id)).credentials_encrypted!),
      ).resolves.toBe(replacement);
    });

    it("resumes a failed source, because a new token is somebody acting", async () => {
      const { owner, workspace } = await owned();
      const source = await added(owner, workspace);

      await api.sql.query(
        `update ${SCHEMA_NAME}.ticket_sources
            set status = 'error', status_reason = 'credentials rejected (401)' where id = $1`,
        [source.id],
      );

      await api
        .as(owner)("post", `${SOURCES}/${source.id}/credentials`)
        .set(TENANT_HEADER, workspace.slug)
        .send({ secret: "ghp_t3kM9vB2nQ6xL1zR8wP4yF7cH0jS5uD3gE" })
        .expect(200);

      expect(await stored(source.id)).toMatchObject({ status: "active", status_reason: null });
    });
  });

  describe("configuring and pausing", () => {
    it("pauses, and the loop's own read no longer lists the source", async () => {
      const { owner, workspace } = await owned();
      const source = await added(owner, workspace);

      const paused = bodyOf<TicketSourceResource>(
        await api
          .as(owner)("patch", `${SOURCES}/${source.id}`)
          .set(TENANT_HEADER, workspace.slug)
          .send({ status: "paused" })
          .expect(200),
      );

      expect(paused.status).toBe("paused");
      expect(
        (await api.nest.get(TicketSourcesRepository).activeSources()).map((row) => row.sourceId),
      ).not.toContain(source.id);
    });

    it("replaces the settings whole, judged without the token, and resumes a failed source", async () => {
      const { owner, workspace } = await owned();
      const source = await added(owner, workspace);

      await api.sql.query(
        `update ${SCHEMA_NAME}.ticket_sources
            set status = 'error', status_reason = 'project or repository not found' where id = $1`,
        [source.id],
      );

      const updated = bodyOf<TicketSourceResource>(
        await api
          .as(owner)("patch", `${SOURCES}/${source.id}`)
          .set(TENANT_HEADER, workspace.slug)
          .send({ config: { login: SOURCE_LOGIN, repos: [SOURCE_REPO, "helios-console"] } })
          .expect(200),
      );

      expect(updated.config).toStrictEqual({
        login: SOURCE_LOGIN,
        repos: [SOURCE_REPO, "helios-console"],
      });
      expect(updated.status).toBe("active");
      expect(updated.statusReason).toBeNull();
      // The token survived an edit that did not carry it.
      expect((await stored(source.id)).credentials_encrypted).not.toBeNull();
    });

    it("answers another workspace's source as not found, never as forbidden", async () => {
      const { owner, workspace } = await owned();
      const source = await added(owner, workspace);
      const { owner: other, workspace: elsewhere } = await owned();

      for (const [method, path] of [
        ["get", `${SOURCES}/${source.id}`],
        ["get", `${SOURCES}/${source.id}/status`],
        ["patch", `${SOURCES}/${source.id}`],
        ["post", `${SOURCES}/${source.id}/sync`],
      ] as const) {
        const response = await api
          .as(other)(method, path)
          .set(TENANT_HEADER, elsewhere.slug)
          .send(method === "patch" ? { status: "paused" } : undefined)
          .expect(404);

        expect(bodyOf<ErrorEnvelope>(response).code).toBe(TICKET_SOURCE_ERRORS.notFound);
      }
    });
  });

  describe("the manual sync, over HTTP", () => {
    it("refuses a paused source before anything is spent", async () => {
      const { owner, workspace } = await owned();
      const source = await added(owner, workspace);

      await api
        .as(owner)("patch", `${SOURCES}/${source.id}`)
        .set(TENANT_HEADER, workspace.slug)
        .send({ status: "paused" })
        .expect(200);

      const response = await api
        .as(owner)("post", `${SOURCES}/${source.id}/sync`)
        .set(TENANT_HEADER, workspace.slug)
        .expect(409);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe(TICKET_SOURCE_ERRORS.paused);
    });

    it("refuses a kind this build has no provider for, as a 501 rather than an accepted no-op", async () => {
      const { owner, workspace } = await owned();
      const { rows } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
         values ($1, 'jira', 'Jira · PROJ', '{"project_keys": ["PROJ"]}'::jsonb) returning id`,
        [workspace.id],
      );

      for (const path of [`${SOURCES}/${rows[0].id}/sync`, `${SOURCES}/${rows[0].id}/test`]) {
        await api.as(owner)("post", path).set(TENANT_HEADER, workspace.slug).expect(501);
      }
    });
  });

  describe("add → test → sync → tickets appear", () => {
    it("holds, through the real GitHub provider over a scripted GitHub", async () => {
      const { owner, workspace } = await owned();
      const source = await added(owner, workspace);
      const { service, loop } = serviceOver({
        repos: { [SOURCE_REPO]: true },
        issues: {
          [SOURCE_REPO]: [[issuePayload({ number: 1 }), issuePayload({ number: 3 })]],
        },
      });

      // Test: the token the add sealed reaches the provider opened, and the probe passes.
      const tested = await service.test(workspace.id, source.id);

      expect(tested).toMatchObject({
        sourceId: source.id,
        status: "ok",
        errorClass: null,
        detail: `${SOURCE_LOGIN} · 1 repository`,
        reason: null,
      });
      expectNoSecretIn(tested);

      // Sync: accepted at once, and the tickets are in V030's table when it settles.
      const accepted = await service.syncNow(workspace.id, source.id);

      expect(accepted).toMatchObject({ sourceId: source.id, running: true, retryAfterSeconds: 30 });

      await settled(loop, source.id);

      const { rows: tickets } = await api.sql.query<{ external_key: string }>(
        `select external_key from ${SCHEMA_NAME}.tickets where source_id = $1 order by external_id`,
        [source.id],
      );

      expect(tickets.map((ticket) => ticket.external_key)).toStrictEqual(["#1", "#3"]);
      expect((await stored(source.id)).synced_at).not.toBeNull();

      // Status: the row's half and the loop's half, over the same instance that synced.
      const status = await service.status(workspace.id, source.id);

      expect(status).toMatchObject({
        status: "active",
        statusReason: null,
        running: false,
        lastSync: { outcome: "synced", imported: 2, errorClass: null },
      });
      expect(status.syncedAt).not.toBeNull();
      expect(status.retryAfterSeconds).toBeGreaterThan(0);

      // And the listing now counts those two open tickets against this source, and publishes
      // the deployment's own poll cadence beside them (#285).
      const page = await service.list(workspace.id, {});

      expect(page.items.find((item) => item.id === source.id)?.openTicketCount).toBe(2);
      expect(page.pollIntervalSeconds).toBe(
        api.nest.get(AppConfigService).backlogSyncIntervalSeconds,
      );
      // A single read agrees with the page — one count, not two spellings of it.
      expect((await service.read(workspace.id, source.id)).openTicketCount).toBe(2);
    });

    it("counts a source that has synced nothing as zero, not as unknown (#285)", async () => {
      const { owner, workspace } = await owned();
      const source = await added(owner, workspace);
      const { service } = serviceOver({ issues: { [SOURCE_REPO]: [[]] } });

      const page = await service.list(workspace.id, {});

      expect(page.items.find((item) => item.id === source.id)?.openTicketCount).toBe(0);
    });

    it("is debounced: a second sync inside the interval is refused with the wait", async () => {
      const { owner, workspace } = await owned();
      const source = await added(owner, workspace);
      const { service, loop } = serviceOver({ issues: { [SOURCE_REPO]: [[]] } });

      await service.syncNow(workspace.id, source.id);
      await settled(loop, source.id);

      const refusal = await service
        .syncNow(workspace.id, source.id)
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(ConflictError);

      const envelope = (refusal as ConflictError).envelope();

      expect(envelope.code).toBe(TICKET_SOURCE_ERRORS.syncTooSoon);
      expect(envelope.details.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("shows the honest reason when the tracker refuses, and a failed test says the same", async () => {
      const { owner, workspace } = await owned();
      const source = await added(owner, workspace);
      const refused = httpError(401);
      const { service, loop } = serviceOver({
        repos: { [SOURCE_REPO]: refused },
        issuesFail: { [SOURCE_REPO]: refused },
      });

      const tested = await service.test(workspace.id, source.id);

      expect(tested).toMatchObject({
        status: "failed",
        errorClass: "auth",
        reason: "credentials rejected",
      });
      expectNoSecretIn(tested);

      await service.syncNow(workspace.id, source.id);
      await settled(loop, source.id);

      // The row carries V031's sentence, `synced_at` was never stamped, and the status
      // endpoint reads both halves back.
      expect(await stored(source.id)).toMatchObject({
        status: "error",
        status_reason: expect.stringMatching(/^credentials rejected/) as string,
        synced_at: null,
      });

      const status = bodyOf<TicketSourceStatusResource>(
        await api
          .as(owner)("get", `${SOURCES}/${source.id}/status`)
          .set(TENANT_HEADER, workspace.slug)
          .expect(200),
      );

      expect(status).toMatchObject({
        status: "error",
        statusReason: expect.stringMatching(/^credentials rejected/) as string,
        syncedAt: null,
        running: false,
        // The application's own loop synced nothing: this instance's memory is honestly empty.
        lastSync: null,
      });
      expect(await service.status(workspace.id, source.id)).toMatchObject({
        lastSync: {
          outcome: "failed",
          errorClass: "auth",
          reason: expect.stringMatching(/^credentials rejected/) as string,
        },
      });
    });

    it("syncs a failed source on demand, and a success clears the error", async () => {
      const { owner, workspace } = await owned();
      const source = await added(owner, workspace);

      await api.sql.query(
        `update ${SCHEMA_NAME}.ticket_sources
            set status = 'error', status_reason = 'tracker unavailable (503)' where id = $1`,
        [source.id],
      );

      const { service, loop } = serviceOver({
        issues: { [SOURCE_REPO]: [[issuePayload({ number: 7 })]] },
      });

      await service.syncNow(workspace.id, source.id);
      await settled(loop, source.id);

      expect(await stored(source.id)).toMatchObject({ status: "active", status_reason: null });
    });
  });

  describe("a test result over HTTP", () => {
    it("answers as a resource the contract describes, for a source with no token", async () => {
      // Through the running application's own provider: with no credential stored, the GitHub
      // provider answers `auth` without a request, so nothing here reaches a tracker.
      const { owner, workspace } = await owned();
      const { rows } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
         values ($1, 'github', 'GitHub · untokened', $2::jsonb) returning id`,
        [workspace.id, JSON.stringify({ login: SOURCE_LOGIN, repos: [SOURCE_REPO] })],
      );

      const tested = bodyOf<TicketSourceTestResource>(
        await api
          .as(owner)("post", `${SOURCES}/${rows[0].id}/test`)
          .set(TENANT_HEADER, workspace.slug)
          .expect(200),
      );

      expect(tested).toMatchObject({
        sourceId: rows[0].id,
        status: "failed",
        errorClass: "auth",
        reason: "credentials rejected",
      });
      expect(tested.detail).toContain("no GitHub token");
      // A test writes nothing.
      expect(await stored(rows[0].id)).toMatchObject({ status: "active", status_reason: null });
    });
  });
});
