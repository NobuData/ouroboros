/**
 * What the source-management API answers with, and how each answer is composed from a row
 * (Q.4, [#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * `openapi.yaml` § `TicketSource`, `TicketSourceStatusReport`, `TicketSourceTest`. Every
 * function here is pure, so the rules — what a mask looks like, which half of a status
 * survives a restart, what a failed test says — are unit tests on small objects rather than
 * assertions about a database.
 *
 * ---------------------------------------------------------------------------
 * **The credential is not in any of these, and cannot be.**
 *
 * The rows these are composed from come through `ticket_sources_public`, which has no
 * credential column — the secret is *absent* from the input, not merely unselected. What a
 * resource carries instead is {@link TicketSourceResource.credentialMask}: `••••` while a
 * credential is stored and `null` while none is. Reads never open the vault to compute a
 * suffix, because a list that decrypted every row to print four characters would be a list
 * that failed when a workspace's key was unreachable. The one place a suffix appears is the
 * answer to `POST /api/v1/sources/{id}/credentials`, composed from the plaintext that request
 * carried and nothing stored — a masked echo, so whoever pasted a token can see it took.
 *
 * ---------------------------------------------------------------------------
 * **A status has a durable half and a process half**, exactly as `backlog/sync.resources.ts`
 * argued. `status`, `statusReason` and `syncedAt` are columns and survive a restart; `running`,
 * `retryAfterSeconds` and `lastSync` are the loop's memory and do not. A fresh process reports
 * `lastSync: null` rather than inventing a result it never saw.
 */

import type { TicketSourceKind, TicketSourcePublic, TicketSourceStatus } from "../db/schema";
import { MASK_ONLY, maskCredential } from "../provider-connections/masking";
import { SOURCE_SKIP_MESSAGES, type SourceSyncOutcome } from "./sync.report";
import type { TicketSourceCapabilities, TicketSourceValidation } from "./ticket-source.provider";
import { TICKET_SOURCE_ERROR_REASONS, type TicketSourceErrorClass } from "./ticket-source.errors";
import type { TicketSourceFormField } from "./ticket-source.config";

/** One source, as the settings list draws it. */
export interface TicketSourceResource {
  /** `ticket_sources.id`. */
  readonly id: string;
  /** Which tracker. */
  readonly kind: TicketSourceKind;
  /** What the list calls it. */
  readonly displayName: string;
  /**
   * The provider's settings, minus the credential, as stored.
   *
   * An open object: its keys are the provider's schema's, and a client draws them from the
   * catalog's fields rather than from a shape written here.
   */
  readonly config: Readonly<Record<string, unknown>>;
  /** `active`, `paused` or `error`. */
  readonly status: TicketSourceStatus;
  /** Why it is `error`, in the loop's words — `rate limited until 14:20 UTC` — or null. */
  readonly statusReason: string | null;
  /** `••••` while a credential is stored; `null` while none is. See this file's header. */
  readonly credentialMask: string | null;
  /** When it was last synced successfully, ISO 8601, or null. */
  readonly syncedAt: string | null;
  /** When it was added. */
  readonly createdAt: string;
  /** When any of its columns last changed. */
  readonly updatedAt: string;
}

/** What one completed sync did, for the status report. */
export interface TicketSourceSyncResultResource {
  /** When it began. */
  readonly startedAt: string;
  /**
   * `synced` — the provider answered and the page was stored; `failed` — the provider reported
   * one of the four classes; `skipped` — the loop did not reach the provider at all.
   */
  readonly outcome: "synced" | "failed" | "skipped";
  /** Rows inserted. Zero on a failure or a skip. */
  readonly imported: number;
  /** Rows rewritten. */
  readonly updated: number;
  /** Rows the provider returned identical to what was stored. */
  readonly unchanged: number;
  /** Closed tickets this mirror had never seen, and did not store. */
  readonly skippedClosed: number;
  /** Tickets handed to the estimation pipeline. */
  readonly enqueued: number;
  /** Whether the provider said more is waiting. */
  readonly hasMore: boolean;
  /** Which of the four classes a failure was, or null. */
  readonly errorClass: TicketSourceErrorClass | null;
  /** The sentence a person reads — the failure's reason, the skip's message, or null. */
  readonly reason: string | null;
}

/** The sync, as the settings row needs to render it. */
export interface TicketSourceStatusResource {
  /** The source. */
  readonly sourceId: string;
  /** `active`, `paused` or `error` — the column. */
  readonly status: TicketSourceStatus;
  /** Why it is `error`, or null — the column. */
  readonly statusReason: string | null;
  /** When it was last synced successfully, or null — the column. */
  readonly syncedAt: string | null;
  /** Whether a sync is running right now. */
  readonly running: boolean;
  /**
   * Seconds until a manual sync would be accepted, or null when one would be accepted now.
   *
   * What lets a client draw **Sync now** as waiting rather than offer a press that will be
   * refused.
   */
  readonly retryAfterSeconds: number | null;
  /** What the most recent sync in this process did, or null when it has done none. */
  readonly lastSync: TicketSourceSyncResultResource | null;
}

/** What **Test connection** found. */
export interface TicketSourceTestResource {
  /** The source that was tested. */
  readonly sourceId: string;
  /** When the check finished. */
  readonly checkedAt: string;
  /** `ok` or `failed`. */
  readonly status: TicketSourceValidation["status"];
  /** Which of the four classes a failure was, or null on a pass. */
  readonly errorClass: TicketSourceErrorClass | null;
  /**
   * The provider's own words — `acme-robotics · 4 repositories`, or what went wrong. Never a
   * credential: the SPI holds every provider to that.
   */
  readonly detail: string;
  /**
   * The taxonomy's sentence for a failure — `credentials rejected` — or null on a pass. The
   * same phrase the row would carry had a sync failed this way, so the form and the list agree.
   */
  readonly reason: string | null;
}

/** One connectable kind — a tile in the add-source picker, and the form behind it. */
export interface TicketSourceCatalogEntryResource {
  /** The kind, as `POST /api/v1/sources` takes it back. */
  readonly kind: TicketSourceKind;
  /** The form's heading — the schema's own `title`. */
  readonly title: string;
  /** The fields, in the order the form renders them. */
  readonly fields: readonly TicketSourceFormField[];
  /** What the provider can do — its own three flags, unchanged. */
  readonly capabilities: TicketSourceCapabilities;
}

/** Every kind this build can reach, in V030's declaration order. */
export interface TicketSourceCatalogResource {
  /** The entries. Empty only in a build that registers no provider at all. */
  readonly kinds: readonly TicketSourceCatalogEntryResource[];
}

/**
 * One source, from its row.
 *
 * @param row - The row, through the view.
 * @param hasCredential - Whether the sealed column is set — asked of the table separately,
 *   because the view cannot say.
 * @param mask - The mask to publish while a credential is stored. {@link MASK_ONLY} on every
 *   read; a suffixed one on the answer to a credential write. Ignored when none is stored.
 * @returns The resource, JSON-safe.
 */
export function sourceResource(
  row: TicketSourcePublic,
  hasCredential: boolean,
  mask: string = MASK_ONLY,
): TicketSourceResource {
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    config: configOf(row.config),
    status: row.status,
    statusReason: row.status_reason,
    credentialMask: hasCredential ? mask : null,
    syncedAt: instant(row.synced_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * The mask a credential write answers with — `••••` and the last four characters.
 *
 * Composed from the plaintext the request carried, never from anything stored: see this file's
 * header.
 *
 * @param secret - The credential, as submitted.
 * @returns The masked echo.
 */
export function maskOf(secret: string): string {
  return maskCredential(Buffer.from(secret, "utf8"));
}

/**
 * The status report, from the row and the loop's memory.
 *
 * @param row - The row, through the view.
 * @param running - Whether a sync is in flight.
 * @param retryAfterSeconds - How long until a manual sync would be accepted, or `undefined`.
 * @param last - What the most recent sync did, or `undefined`.
 * @param startedAt - When that sync began, or `undefined`.
 * @returns The resource.
 */
export function statusResource(
  row: TicketSourcePublic,
  running: boolean,
  retryAfterSeconds: number | undefined,
  last: SourceSyncOutcome | undefined,
  startedAt: Date | undefined,
): TicketSourceStatusResource {
  return {
    sourceId: row.id,
    status: row.status,
    statusReason: row.status_reason,
    syncedAt: instant(row.synced_at),
    running,
    retryAfterSeconds: retryAfterSeconds ?? null,
    lastSync: last === undefined || startedAt === undefined ? null : syncResult(last, startedAt),
  };
}

/**
 * One completed sync, for the report.
 *
 * @param outcome - What the loop recorded.
 * @param startedAt - When it began.
 * @returns The result.
 */
export function syncResult(
  outcome: SourceSyncOutcome,
  startedAt: Date,
): TicketSourceSyncResultResource {
  return {
    startedAt: startedAt.toISOString(),
    outcome:
      outcome.failure !== undefined
        ? "failed"
        : outcome.skipped !== undefined
          ? "skipped"
          : "synced",
    imported: outcome.imported,
    updated: outcome.updated,
    unchanged: outcome.unchanged,
    skippedClosed: outcome.skippedClosed,
    enqueued: outcome.enqueued,
    hasMore: outcome.hasMore,
    errorClass: outcome.failure?.errorClass ?? null,
    reason:
      outcome.failure?.reason ??
      (outcome.skipped === undefined ? null : SOURCE_SKIP_MESSAGES[outcome.skipped]),
  };
}

/**
 * What a test found, for the form.
 *
 * @param sourceId - The source.
 * @param validation - What the provider answered.
 * @param at - When.
 * @returns The resource.
 */
export function testResource(
  sourceId: string,
  validation: TicketSourceValidation,
  at: Date,
): TicketSourceTestResource {
  return {
    sourceId,
    checkedAt: at.toISOString(),
    status: validation.status,
    errorClass: validation.status === "failed" ? validation.errorClass : null,
    detail: validation.detail,
    reason:
      validation.status === "failed" ? TICKET_SOURCE_ERROR_REASONS[validation.errorClass] : null,
  };
}

/**
 * The stored configuration, as an object.
 *
 * V030's `ticket_sources_config_shape` guarantees the column holds an object, so this narrows
 * rather than checks — and answers `{}` for anything else rather than throwing, because a
 * settings list is the wrong place to crash over a row a migration wrote by hand.
 *
 * @param config - The column, parsed.
 * @returns The object.
 */
function configOf(config: unknown): Readonly<Record<string, unknown>> {
  return typeof config === "object" && config !== null && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : {};
}

/**
 * A timestamp as the contract spells one.
 *
 * @param value - The column, or null.
 * @returns The ISO-8601 instant, or null.
 */
function instant(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}
