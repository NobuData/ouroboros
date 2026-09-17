/**
 * `SourcesService` — the source-management operations behind `/api/v1/sources`
 * (Q.4, [#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * ```
 * list · read · catalog                 the view, and the registry
 * add · update                          the schema check, then the row
 * setCredentials                        the schema's secret field, then the vault, then the row
 * test                                  open the credential, ask the provider, answer — write nothing
 * sync                                  three guards, then hand the source to the loop
 * status                                the row, and the loop's memory
 * ```
 *
 * ---------------------------------------------------------------------------
 * **There is no `kind` anywhere in this file, and `sources.catalog.spec.ts` checks.** Every
 * question a tracker differs by is asked of the provider the registry resolves — its schema,
 * its validation — and a `switch (kind)` here would be decision **P5** decaying in the layer
 * that exists to serve it.
 *
 * **The credential is opened for one call and is never anywhere else.** {@link test} is the
 * one operation here that decrypts: the sealed column is read by the loop's own
 * `sealedCredential` — the single statement in this service that selects it — opened by
 * `VaultService`, handed to `validateConfig`, and dropped. Nothing here logs a submission, a
 * configuration or a credential; `sources.service.spec.ts` asserts that against a captured
 * transcript with a credential-shaped fixture.
 *
 * **A test writes nothing.** `provider-connections` writes a test's result to the connection's
 * status because that status *is* the routing signal. Here `status` and V031's `status_reason`
 * belong to the loop — written by a sync, cleared by the next one that succeeds — and a test
 * that wrote `error` would stop the loop polling a source over a probe somebody pressed while
 * the tracker was down. What a test answers is the form's business; what the loop found is the
 * row's.
 *
 * **A change is a reason to try again.** New settings, a new credential and an explicit
 * `status: "active"` all move an `error` source back to `active` with its reason cleared. The
 * loop's own filter is `active`, so a source that failed is not polled again until somebody
 * acts — and each of those three is somebody acting on exactly the thing that failed. A
 * `paused` source stays paused through a settings edit, because pausing was a choice too.
 */

import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import type { TicketSourcePublic } from "../db/schema";
import { MINIMUM_SYNC_INTERVAL_SECONDS, retryAfterSeconds } from "../backlog/debounce";
import { describeForLog } from "../errors/failure";
import { fieldViolations } from "../provider-connections/config.validation";
import { UNIQUE_VIOLATION, isDatabaseFailure } from "../tenancy/constraints";
import { windowOf } from "../tenancy/pagination";
import { AppConfigService } from "../config/config.service";
import { VaultService } from "../vault/vault.service";
import { sourceCatalog } from "./sources.catalog";
import type {
  CreateSourceDto,
  ListSourcesQuery,
  SetCredentialsDto,
  UpdateSourceDto,
} from "./sources.dto";
import {
  sourceConfigInvalid,
  sourceCredentialsUnsupported,
  sourceNameTaken,
  sourceNotFound,
  sourcePaused,
  sourceSyncRunning,
  sourceSyncTooSoon,
} from "./sources.errors";
import { SourcesRepository } from "./sources.repository";
import {
  maskOf,
  sourceResource,
  statusResource,
  testResource,
  type TicketSourceCatalogResource,
  type TicketSourcePageResource,
  type TicketSourceResource,
  type TicketSourceStatusResource,
  type TicketSourceTestResource,
} from "./sources.resources";
import {
  partitionSourceSubmission,
  sourceConfigViolations,
  sourceSecretField,
  storedSourceSchema,
  type TicketSourceConfigSchema,
} from "./ticket-source.config";
import { TicketSourceRegistry } from "./ticket-source.registry";
import { TicketSourcesRepository, type SyncSource } from "./ticket-sources.repository";
import { TicketSourcesService } from "./ticket-sources.service";

/** V030's unique constraint on `(organization_id, display_name)`, by the name the migration gave it. */
export const DISPLAY_NAME_KEY = "ticket_sources_organization_name_key";

@Injectable()
export class SourcesService {
  /** Where an accepted manual sync and an unopenable credential are reported. */
  private readonly logger = new Logger(SourcesService.name);

  /**
   * @param sources - The request-scoped statements.
   * @param loop - The loop's statements — for the one statement that reads a sealed credential.
   * @param sync - The loop itself: what a manual sync hands a source to, and what a status
   *   report reads its process half from.
   * @param registry - Where a provider comes from, and the only thing here that knows a kind.
   * @param vault - What seals a credential and, for a test, opens one.
   * @param config - The deployment's settings. Only the sync cadence is read here, and only so
   *   the listing can publish it (#285).
   */
  constructor(
    private readonly sources: SourcesRepository,
    private readonly loop: TicketSourcesRepository,
    private readonly sync: TicketSourcesService,
    private readonly registry: TicketSourceRegistry,
    private readonly vault: VaultService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * The kinds this build can connect, each with its form.
   *
   * @returns The catalog — see `sources.catalog.ts`.
   */
  catalog(): TicketSourceCatalogResource {
    return sourceCatalog(this.registry);
  }

  /**
   * One page of a workspace's sources.
   *
   * @param organizationId - The workspace.
   * @param query - The window.
   * @returns The page, by display name.
   */
  async list(organizationId: string, query: ListSourcesQuery): Promise<TicketSourcePageResource> {
    const page = await this.sources.list(organizationId, windowOf(query));
    const ids = page.items.map((row) => row.id);

    // Two aggregates over one page, asked together: neither depends on the other, and a
    // workspace's sources are few enough that the page is one round trip's worth either way.
    const [presence, openTickets] = await Promise.all([
      this.sources.credentialPresence(organizationId, ids),
      this.sources.openTicketCounts(organizationId, ids),
    ]);

    return {
      ...page,
      items: page.items.map((row) =>
        sourceResource(row, presence.get(row.id) ?? false, openTickets.get(row.id) ?? 0),
      ),
      pollIntervalSeconds: this.config.backlogSyncIntervalSeconds,
    };
  }

  /**
   * One source.
   *
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @returns The resource.
   * @throws {NotFoundError} `ticket_source_not_found` — for a source this workspace does not
   *   have, whether or not another does.
   */
  async read(organizationId: string, sourceId: string): Promise<TicketSourceResource> {
    const row = await this.require(organizationId, sourceId);
    const [hasCredential, openTickets] = await Promise.all([
      this.hasCredential(organizationId, sourceId),
      this.openTicketCount(organizationId, sourceId),
    ]);

    return sourceResource(row, hasCredential, openTickets);
  }

  /**
   * How many of one source's canonical tickets are open.
   *
   * The batch read asked for a single id — one method rather than two spellings of one count,
   * so a per-source read and a page can never disagree.
   *
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @returns The count. Zero for a source that has brought in nothing.
   */
  private async openTicketCount(organizationId: string, sourceId: string): Promise<number> {
    const counts = await this.sources.openTicketCounts(organizationId, [sourceId]);

    return counts.get(sourceId) ?? 0;
  }

  /**
   * Add a source.
   *
   * The submission is judged against the provider's **full** schema — secret field included —
   * so a provider that requires a credential gets one on the first write, and the secret is
   * sealed against the row's own id, which is why the id is minted here rather than by the
   * column's default.
   *
   * @param organizationId - The workspace.
   * @param body - The validated request.
   * @returns The source as stored. `credentialMask` echoes the submitted credential's suffix.
   * @throws {NotImplementedError} `ticket_source_kind_unsupported` — no provider for the kind.
   * @throws {InvalidRequestError} `ticket_source_config_invalid` — the schema refused it.
   * @throws {ConflictError} `ticket_source_name_taken` — the name is in use.
   */
  async add(organizationId: string, body: CreateSourceDto): Promise<TicketSourceResource> {
    const schema = this.registry.get(body.kind).configSchema();

    this.refuseBadConfig(schema, body.config);

    const submission = partitionSourceSubmission(schema, body.config);
    const sourceId = randomUUID();

    await this.storing(body.displayName, async () =>
      this.sources.insert({
        id: sourceId,
        organizationId,
        kind: body.kind,
        displayName: body.displayName,
        config: submission.config,
        credentialsEncrypted:
          submission.secret === null
            ? null
            : await this.vault.encryptText(organizationId, sourceId, submission.secret),
      }),
    );

    const row = await this.require(organizationId, sourceId);

    return sourceResource(
      row,
      submission.secret !== null,
      // A source minted one statement ago: nothing can reference it yet, so the count is zero
      // by construction rather than by a query nobody needs.
      0,
      submission.secret === null ? undefined : maskOf(submission.secret),
    );
  }

  /**
   * Change a source's name, settings or status.
   *
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @param body - What changes.
   * @returns The source after the change.
   * @throws {NotFoundError} `ticket_source_not_found`.
   * @throws {InvalidRequestError} `ticket_source_config_invalid` — new settings the stored
   *   schema refuses.
   * @throws {ConflictError} `ticket_source_name_taken`.
   */
  async update(
    organizationId: string,
    sourceId: string,
    body: UpdateSourceDto,
  ): Promise<TicketSourceResource> {
    const row = await this.require(organizationId, sourceId);

    let config: Readonly<Record<string, unknown>> | undefined;

    if (body.config !== undefined) {
      // The stored schema: an edit does not resubmit the credential, and holding it to a
      // required secret would make every source whose provider needs one un-editable.
      const schema = storedSourceSchema(this.registry.get(row.kind).configSchema());

      this.refuseBadConfig(schema, body.config);
      config = partitionSourceSubmission(schema, body.config).config;
    }

    // A change somebody makes is a reason to try again — see this file's header. An explicit
    // status wins; otherwise new settings on a failed source resume it, and a paused source
    // stays paused through an edit.
    const status =
      body.status ?? (config !== undefined && row.status === "error" ? "active" : undefined);

    await this.storing(body.displayName ?? row.display_name, async () =>
      this.sources.update(organizationId, sourceId, {
        displayName: body.displayName,
        config,
        status,
        ...(status === "active" ? { statusReason: null } : {}),
      }),
    );

    return this.read(organizationId, sourceId);
  }

  /**
   * Store a credential — write-only, answered with a masked echo.
   *
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @param body - The credential.
   * @returns The source, with `credentialMask` echoing the new credential's suffix.
   * @throws {NotFoundError} `ticket_source_not_found`.
   * @throws {ConflictError} `ticket_source_credentials_unsupported` — the provider declares no
   *   secret field.
   * @throws {InvalidRequestError} `ticket_source_config_invalid` — the secret field's own
   *   rules refused it, under `details.fields.<field>`.
   */
  async setCredentials(
    organizationId: string,
    sourceId: string,
    body: SetCredentialsDto,
  ): Promise<TicketSourceResource> {
    const row = await this.require(organizationId, sourceId);
    const schema = this.registry.get(row.kind).configSchema();
    const field = sourceSecretField(schema);

    if (field === null) {
      throw sourceCredentialsUnsupported(row.kind);
    }

    const rules = schema.properties[field];
    const messages =
      rules === undefined || rules.type === "array" ? [] : fieldViolations(rules, body.secret);

    if (messages.length > 0) {
      throw sourceConfigInvalid({ [field]: messages });
    }

    await this.sources.setCredential(
      organizationId,
      sourceId,
      await this.vault.encryptText(organizationId, sourceId, body.secret),
    );

    // A new credential is a fix for the one class of failure a person can fix by rotating —
    // and, honestly, for none of the others; the next sync says which. See this file's header.
    if (row.status === "error") {
      await this.sources.update(organizationId, sourceId, { status: "active", statusReason: null });
    }

    const stored = await this.require(organizationId, sourceId);

    return sourceResource(
      stored,
      true,
      await this.openTicketCount(organizationId, sourceId),
      maskOf(body.secret),
    );
  }

  /**
   * Ask the provider whether this source's settings and credential work — **Test connection**.
   *
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @param now - The clock.
   * @returns What the provider found. **A tracker that refused is a `200`** — the refusal is in
   *   the resource, as `status: "failed"` with its class, because a failed test is what the
   *   form exists to render.
   * @throws {NotFoundError} `ticket_source_not_found`.
   * @throws {NotImplementedError} `ticket_source_kind_unsupported`.
   */
  async test(
    organizationId: string,
    sourceId: string,
    now: Date = new Date(),
  ): Promise<TicketSourceTestResource> {
    const row = await this.require(organizationId, sourceId);
    const provider = this.registry.get(row.kind);
    const sealed = await this.loop.sealedCredential(sourceId);

    let credentials: string | null = null;

    if (sealed !== null) {
      try {
        credentials = await this.vault.decryptText(organizationId, sourceId, sealed);
      } catch (error) {
        // The loop's own reading of this case, answered as a result rather than thrown: from
        // the form's side an envelope that will not open is indistinguishable from a credential
        // that no longer works, and it is fixed in the same place — by storing a new one.
        this.logger.error(
          `${row.display_name}: the stored credential could not be opened for a test.`,
          describeForLog(error),
        );

        return testResource(
          sourceId,
          {
            status: "failed",
            errorClass: "auth",
            detail: "the stored credential could not be opened; store it again",
          },
          now,
        );
      }
    }

    return testResource(sourceId, await provider.validateConfig(row.config, credentials), now);
  }

  /**
   * Sync one source now.
   *
   * Three refusals, in the order a person would want to hear them: the source is paused (a
   * choice, and this would override it), a sync is already running (watch it), one ran a moment
   * ago (wait this long). Then the source is handed to the loop and the request answers before
   * the sync does — `202`, and `syncedAt` advancing on the status endpoint is what a client
   * watches for.
   *
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @param now - The clock.
   * @returns The status as it stood the moment the sync started, with `running: true`.
   * @throws {NotFoundError} `ticket_source_not_found`.
   * @throws {NotImplementedError} `ticket_source_kind_unsupported`.
   * @throws {ConflictError} `ticket_source_paused`, `ticket_source_sync_running` or
   *   `ticket_source_sync_too_soon` — see `sources.errors.ts`.
   */
  async syncNow(
    organizationId: string,
    sourceId: string,
    now: Date = new Date(),
  ): Promise<TicketSourceStatusResource> {
    const row = await this.require(organizationId, sourceId);

    // Resolved before any guard, so a source of a kind this build cannot reach is a `501`
    // naming what it can rather than a `202` for a sync that would skip it.
    this.registry.get(row.kind);

    if (row.status === "paused") {
      throw sourcePaused(sourceId);
    }

    if (this.sync.isSyncing(sourceId)) {
      throw sourceSyncRunning(sourceId);
    }

    const wait = retryAfterSeconds(this.sync.lastStartedAt(sourceId), now);

    if (wait !== undefined) {
      throw sourceSyncTooSoon(wait);
    }

    // Read **before** the sync starts, so the answer is a snapshot rather than a race with the
    // writes it is about to cause.
    const accepted = this.statusOf(row, now);
    const started = this.sync.syncSource(syncSourceOf(row));

    if (started === undefined) {
      // Lost the start to a cycle that reached this source in the same tick. The refusal is
      // the one above's, because that is what happened.
      throw sourceSyncRunning(sourceId);
    }

    // Not awaited, and not left floating either: the sync outlives this request by design, and
    // `syncSource` never rejects.
    void started;

    this.logger.log(`${row.display_name}: manual sync triggered.`);

    return {
      ...accepted,
      running: true,
      retryAfterSeconds: MINIMUM_SYNC_INTERVAL_SECONDS,
    };
  }

  /**
   * How a source's sync stands: the row, and the loop's memory of it.
   *
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @param now - The clock, for the retry hint.
   * @returns The report.
   * @throws {NotFoundError} `ticket_source_not_found`.
   */
  async status(
    organizationId: string,
    sourceId: string,
    now: Date = new Date(),
  ): Promise<TicketSourceStatusResource> {
    return this.statusOf(await this.require(organizationId, sourceId), now);
  }

  /**
   * The status report for a row already read.
   *
   * @param row - The row.
   * @param now - The clock.
   * @returns The report.
   */
  private statusOf(row: TicketSourcePublic, now: Date): TicketSourceStatusResource {
    return statusResource(
      row,
      this.sync.isSyncing(row.id),
      retryAfterSeconds(this.sync.lastStartedAt(row.id), now),
      this.sync.lastOutcome(row.id),
      this.sync.lastStartedAt(row.id),
    );
  }

  /**
   * Refuse a submission the schema does not accept.
   *
   * @param schema - The schema to judge by.
   * @param values - The submission.
   * @throws {InvalidRequestError} `ticket_source_config_invalid`, naming every field at once.
   */
  private refuseBadConfig(
    schema: TicketSourceConfigSchema,
    values: Readonly<Record<string, unknown>>,
  ): void {
    const violations = sourceConfigViolations(schema, values);

    if (Object.keys(violations).length > 0) {
      throw sourceConfigInvalid(violations);
    }
  }

  /**
   * Run a write, turning V030's name uniqueness into the `409` it means.
   *
   * @param displayName - The name the write carries, for the refusal.
   * @param write - The statement.
   * @returns Whatever the write returned.
   * @throws {ConflictError} `ticket_source_name_taken`, for that one constraint. Anything else
   *   the driver threw is rethrown untouched, for the error filter to answer as it does every
   *   unexpected failure.
   */
  private async storing<T>(displayName: string, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (
        isDatabaseFailure(error) &&
        error.code === UNIQUE_VIOLATION &&
        error.constraint === DISPLAY_NAME_KEY
      ) {
        throw sourceNameTaken(displayName);
      }

      throw error;
    }
  }

  /**
   * Whether a source has a credential stored.
   *
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @returns `true` when the sealed column is set.
   */
  private async hasCredential(organizationId: string, sourceId: string): Promise<boolean> {
    return (
      (await this.sources.credentialPresence(organizationId, [sourceId])).get(sourceId) ?? false
    );
  }

  /**
   * The row, or the `404`.
   *
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @returns The row.
   * @throws {NotFoundError} `ticket_source_not_found`.
   */
  private async require(organizationId: string, sourceId: string): Promise<TicketSourcePublic> {
    const row = await this.sources.find(organizationId, sourceId);

    if (row === undefined) {
      throw sourceNotFound(sourceId);
    }

    return row;
  }
}

/**
 * A row, in the shape the loop syncs.
 *
 * @param row - The row, through the view.
 * @returns What `TicketSourcesService.syncSource` takes — the same seven fields the loop's own
 *   cross-workspace read produces.
 */
export function syncSourceOf(row: TicketSourcePublic): SyncSource {
  return {
    sourceId: row.id,
    organizationId: row.organization_id,
    kind: row.kind,
    displayName: row.display_name,
    config: row.config,
    cursor: row.sync_cursor,
    syncedAt: row.synced_at,
  };
}
