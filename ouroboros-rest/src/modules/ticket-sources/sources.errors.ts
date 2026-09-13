/**
 * Every way the source-management API refuses a request, and the words for each.
 *
 * Q.4 ([#141](https://github.com/NobuData/ouroboros/issues/141)). The shape is
 * `provider-connections.errors.ts`'s and `backlog/sync.errors.ts`'s: one `as const` object of
 * codes that `sources.errors.spec.ts` holds to `openapi.yaml`, and one factory per code so a
 * refusal reads the same wherever it is raised.
 *
 * ---------------------------------------------------------------------------
 * **A source that is not yours is a `404`, never a `403`.** The rule every workspace-scoped
 * read in this API keeps: confirming that an identifier names something real is the whole of
 * what enumerating identifiers is for, and a source row carries a sealed credential. The one
 * `403` this API answers is the roles guard's, for a member who *may* see a source and may not
 * change it.
 *
 * **Two `409`s for the manual sync, and the difference is the reader's next move.** Exactly
 * `backlog/sync.errors.ts`'s argument: *already running* means watch it, *too soon* means wait
 * `details.retryAfterSeconds`, and one `sync_refused` would leave a client unable to tell which.
 * A third `409` — `paused` — is the one that is new here: a paused source is somebody's
 * choice, and syncing it on a click would be the loop overriding that choice with less
 * ceremony than the pause took. Resume it first.
 *
 * **`ticket_source_kind_unsupported` is the registry's**, raised by `TicketSourceRegistry.get`
 * and documented against the operations here that can reach it — the `501` `ticket-source
 * .registry.ts` argued for, now published because a route can finally answer it.
 */

import type { TicketSourceKind } from "../db/schema";
import { MINIMUM_SYNC_INTERVAL_SECONDS } from "../backlog/debounce";
import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";

/**
 * The codes, as one object.
 *
 * `as const` so each value is its own literal type, and the spec holds every one to the
 * document — the document is the registry a client reads, so a code that is not in it is a
 * code nobody can look up.
 */
export const TICKET_SOURCE_ERRORS = {
  /** `404` — no source with that id in this workspace. */
  notFound: "ticket_source_not_found",
  /** `422` — a submitted configuration the provider's schema refuses. `details.fields` says which. */
  configInvalid: "ticket_source_config_invalid",
  /** `409` — another source in this workspace already has that display name. */
  nameTaken: "ticket_source_name_taken",
  /** `409` — the source is paused, and a manual sync would override a person's choice. */
  paused: "ticket_source_paused",
  /** `409` — a sync of this source is in flight. Watch the status endpoint. */
  syncRunning: "ticket_source_sync_running",
  /** `409` — this source was synced a moment ago. `details.retryAfterSeconds` says how long to wait. */
  syncTooSoon: "ticket_source_sync_too_soon",
  /** `409` — this source's provider declares no credential, so there is nothing to store one as. */
  credentialsUnsupported: "ticket_source_credentials_unsupported",
} as const;

/** One of {@link TICKET_SOURCE_ERRORS}' values. */
export type TicketSourceErrorCode =
  (typeof TICKET_SOURCE_ERRORS)[keyof typeof TICKET_SOURCE_ERRORS];

/**
 * `404` — there is no such source in this workspace.
 *
 * @param sourceId - What was asked for. Echoed in `details` because the caller sent it and a
 *   `404` naming nothing is a `404` somebody has to reproduce to understand.
 * @returns The error to throw.
 */
export function sourceNotFound(sourceId: string): NotFoundError {
  return new NotFoundError(TICKET_SOURCE_ERRORS.notFound, "No such ticket source.", {
    sourceId,
  });
}

/**
 * `422` — the configuration does not satisfy the provider's own schema.
 *
 * @param fields - Field name to the sentences about it, as `sourceConfigViolations` reported
 *   them. Never empty: an empty map means the configuration was fine and this must not be
 *   thrown.
 * @returns The error to throw, with `details.fields` in the same `{field: [sentences]}` shape
 *   `errors/validation.ts` produces — so a form has one renderer for both.
 */
export function sourceConfigInvalid(
  fields: Readonly<Record<string, string[]>>,
): InvalidRequestError {
  return new InvalidRequestError(
    TICKET_SOURCE_ERRORS.configInvalid,
    "The configuration does not satisfy this provider's schema. See `details.fields`.",
    { fields },
  );
}

/**
 * `409` — the workspace already has a source with that display name.
 *
 * V030's `ticket_sources_organization_name_key`, as an answer: two sources called *GitHub* in
 * one workspace is a settings list nobody can read.
 *
 * @param displayName - The name that was taken.
 * @returns The error to throw.
 */
export function sourceNameTaken(displayName: string): ConflictError {
  return new ConflictError(
    TICKET_SOURCE_ERRORS.nameTaken,
    "This workspace already has a ticket source with that name.",
    { displayName },
  );
}

/**
 * `409` — the source is paused.
 *
 * @param sourceId - The source.
 * @returns The error to throw.
 */
export function sourcePaused(sourceId: string): ConflictError {
  return new ConflictError(
    TICKET_SOURCE_ERRORS.paused,
    "This source is paused. Resume it before syncing it.",
    { sourceId },
  );
}

/**
 * `409` — a sync of this source is already running.
 *
 * Carries no `retryAfterSeconds`, for `backlog/sync.errors.ts`'s reason: how long a sync takes
 * depends on the tracker, and a number invented here would be rendered as a countdown that
 * means nothing. `GET /api/v1/sources/{id}/status`'s `running` is the actual signal.
 *
 * @param sourceId - The source.
 * @returns The error to throw.
 */
export function sourceSyncRunning(sourceId: string): ConflictError {
  return new ConflictError(
    TICKET_SOURCE_ERRORS.syncRunning,
    "A sync of this source is already running. It will finish on its own.",
    { sourceId },
  );
}

/**
 * `409` — this source was synced too recently for another sync to be worth its requests.
 *
 * @param retryAfterSeconds - Whole seconds until a trigger would be accepted, from
 *   `backlog/debounce.ts`'s `retryAfterSeconds` — rounded up and never below one.
 * @returns The error to throw.
 */
export function sourceSyncTooSoon(retryAfterSeconds: number): ConflictError {
  return new ConflictError(
    TICKET_SOURCE_ERRORS.syncTooSoon,
    `This source was synced less than ${String(MINIMUM_SYNC_INTERVAL_SECONDS)} seconds ago. ` +
      "Try again shortly.",
    { retryAfterSeconds },
  );
}

/**
 * `409` — this source's provider declares no credential field.
 *
 * A `409` rather than a `422`: the body was fine, and what refuses it is the state of the
 * source — its kind's schema has nowhere for a credential to go.
 *
 * @param kind - The source's kind, for the sentence.
 * @returns The error to throw.
 */
export function sourceCredentialsUnsupported(kind: TicketSourceKind): ConflictError {
  return new ConflictError(
    TICKET_SOURCE_ERRORS.credentialsUnsupported,
    "This source's provider takes no credential.",
    { kind },
  );
}
