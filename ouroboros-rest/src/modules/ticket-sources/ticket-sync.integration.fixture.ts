/**
 * What the ticket-source loop's database suites share: a source row, a cycle over chosen providers,
 * and the two reads their assertions make.
 *
 * Q.5 ([#142](https://github.com/NobuData/ouroboros/issues/142)) split the loop's integration
 * suite in two. `ticket-sources.integration-spec.ts` is the loop on the in-memory provider — the
 * core intake harness, with no Octokit anywhere in it — and
 * `providers/github.provider.integration-spec.ts` is GitHub end to end, beside the provider it is
 * about. These are the helpers both halves had, kept in one place so the two cannot drift about what
 * a stored row looks like.
 *
 * No provider is named here, and `.dependency-cruiser.cjs`'s `ticket-source-core-tests-run-on-the-fake`
 * keeps it that way.
 */

import type { ApiHarness } from "../../testing/harness.fixture";
import { SCHEMA_NAME, type TicketSourceKind } from "../db/schema";
import { VaultService } from "../vault/vault.service";
import type { SyncCycleReport } from "./sync.report";
import type { TicketSourceProvider } from "./ticket-source.provider";
import { TicketSourceRegistry } from "./ticket-source.registry";
import { TicketSourcesRepository } from "./ticket-sources.repository";
import { TicketSourcesService } from "./ticket-sources.service";

/** One canonical row, as an assertion reads it. */
export interface StoredTicketRow {
  external_id: string;
  external_key: string;
  external_url: string;
  title: string;
  body: string | null;
  state: string;
  labels: string[];
  author: string | null;
  meta: Record<string, unknown>;
  sizing_status: string;
  synced_at: Date;
  updated_at: Date;
}

/** A source's own columns, after a cycle. */
export interface StoredSourceRow {
  status: string;
  status_reason: string | null;
  sync_cursor: string | null;
  synced_at: Date | null;
}

/** What a source row is written with. */
export interface SourceRowOptions {
  /** Which tracker. */
  readonly kind: TicketSourceKind;
  /** `ticket_sources.config`, in the provider's own grammar. */
  readonly config: unknown;
  /** The name a person reads. `<kind> · harness` unless given. */
  readonly displayName?: string;
  /** A credential to seal with the real vault against the new row's id, or nothing. */
  readonly credential?: string;
  /**
   * A stored cursor, for a source that has synced before — written with a `synced_at`, because
   * `ticket_sources_cursor_after_sync` refuses a cursor on a source that never synced.
   */
  readonly cursor?: string;
}

/** A source the harness wrote. */
export interface InsertedSource {
  /** The workspace it belongs to. */
  readonly organizationId: string;
  /** Its row id. */
  readonly sourceId: string;
}

/**
 * A workspace with one source in it.
 *
 * Written directly rather than through `/api/v1/sources`: what is under test here is the loop and
 * the schema under it, and the management API's own suite is `sources.integration-spec.ts`.
 *
 * @param api - The running harness.
 * @param options - What the row holds.
 * @returns The workspace and the source.
 */
export async function insertSource(
  api: ApiHarness,
  options: SourceRowOptions,
): Promise<InsertedSource> {
  const owner = await api.signIn();
  const workspace = await api.workspace(owner);

  const { rows } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.ticket_sources
       (organization_id, kind, display_name, config, sync_cursor, synced_at)
     values ($1, $2, $3, $4::jsonb, $5, $6)
     returning id`,
    [
      workspace.id,
      options.kind,
      options.displayName ?? `${options.kind} · harness`,
      JSON.stringify(options.config),
      options.cursor ?? null,
      options.cursor === undefined ? null : new Date(),
    ],
  );
  const sourceId = rows[0].id;

  if (options.credential !== undefined) {
    // Sealed against this row's id, which is what the vault binds into the AAD — so the loop's
    // opening it is also proof the two agree on the pair.
    const sealed = await api.nest
      .get(VaultService)
      .encryptText(workspace.id, sourceId, options.credential);

    await api.sql.query(
      `update ${SCHEMA_NAME}.ticket_sources set credentials_encrypted = $2 where id = $1`,
      [sourceId, sealed],
    );
  }

  return { organizationId: workspace.id, sourceId };
}

/**
 * Run one cycle with these providers registered.
 *
 * The registry is built here rather than overridden in the module, because the providers differ per
 * case and a Nest override is per application. The intake port is a no-op: the handoff's own
 * behaviour is `ticket-sources.service.spec.ts`'s.
 *
 * @param api - The running harness.
 * @param providers - What to register.
 * @returns The cycle's report.
 */
export async function cycleWith(
  api: ApiHarness,
  providers: readonly TicketSourceProvider[],
): Promise<SyncCycleReport> {
  const service = new TicketSourcesService(
    api.nest.get(TicketSourcesRepository),
    new TicketSourceRegistry(providers),
    api.nest.get(VaultService),
    { accept: () => Promise.resolve() },
  );

  return service.cycle();
}

/**
 * Every ticket stored for one source.
 *
 * @param api - The running harness.
 * @param sourceId - The source.
 * @returns The rows, by external id.
 */
export async function ticketsOf(api: ApiHarness, sourceId: string): Promise<StoredTicketRow[]> {
  const { rows } = await api.sql.query<StoredTicketRow>(
    `select external_id, external_key, external_url, title, body, state, labels, author,
            meta, sizing_status, synced_at, updated_at
       from ${SCHEMA_NAME}.tickets where source_id = $1 order by external_id`,
    [sourceId],
  );

  return rows;
}

/**
 * A source's own columns, read through the view a read path uses.
 *
 * @param api - The running harness.
 * @param sourceId - The source.
 * @returns The row.
 */
export async function sourceRow(api: ApiHarness, sourceId: string): Promise<StoredSourceRow> {
  const { rows } = await api.sql.query<StoredSourceRow>(
    `select status, status_reason, sync_cursor, synced_at
       from ${SCHEMA_NAME}.ticket_sources_public where id = $1`,
    [sourceId],
  );

  return rows[0];
}
