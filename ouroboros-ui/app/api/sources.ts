import "server-only";

/**
 * The ticket sources — the settings surface's whole surface on this side of the wire
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * Nine operations, and they are the page's: the **catalog** the add dialog draws its tiles
 * from and the rows read their field labels from, the **listing** the rows are drawn from,
 * the **add** itself, one source's **read**, the **edits** a row makes — its settings, its
 * name, and the pause — the write-only **credential**, and the three live surfaces:
 * **test**, **sync** and **status**. One page's calls to one tag, kept together.
 *
 * ### The form is the provider's, crossing the wire
 *
 * `ouroboros-rest`'s provider registry is what decides which trackers this build can connect
 * (decision **P5**), and this module talks to that service and to nothing else — so the
 * registry has to be *read*, not known. {@link sources.catalog} is that read, and the shape it
 * answers is already a form: each entry's `fields` are derived once, in the service, from the
 * provider's own `configSchema()`, so nothing here decides which widget a field takes or
 * which field is the credential. `app/sources/catalog.ts` iterates it; `app/ui/schema-form.tsx`
 * draws it.
 *
 * ### The credential is never read back
 *
 * No call here answers with a stored credential, because no operation in the contract does.
 * {@link sources.setCredentials} sends one and receives the source with a masked echo —
 * `••••` and the last four characters of what was sent, composed from the request and
 * nothing stored — and every read answers `••••` or `null`.
 *
 * ### The workspace is the session's
 *
 * There is no workspace in any of these paths. The listing, the catalog, a read and a status
 * are open to every member; every write is `owner` or `admin`, and a `403` reaching this layer
 * is a state the page renders rather than a bug — `app/sources/catalog.ts` carries the
 * sentences.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** One configured tracker, credential masked — `openapi.yaml` § `TicketSource`. */
export type TicketSource = components["schemas"]["TicketSource"];

/** Which tracker a source is — V030's five spellings. */
export type TicketSourceKind = components["schemas"]["TicketSourceKind"];

/** `active`, `paused` or `error`. */
export type TicketSourceStatus = components["schemas"]["TicketSourceStatus"];

/** The four words a provider may fail in. */
export type TicketSourceErrorClass = components["schemas"]["TicketSourceErrorClass"];

/** Every kind this build can connect, each with its form. */
export type TicketSourceCatalog = components["schemas"]["TicketSourceCatalog"];

/** One connectable kind: a tile, and the form behind it. */
export type TicketSourceCatalogEntry = components["schemas"]["TicketSourceCatalogEntry"];

/**
 * One field of the settings form, as the service derived it from the provider's schema.
 *
 * Every optional keyword is an explicit `null`, which is what lets a renderer consume it
 * without a list of defaults of its own; the two list bounds are the ones a provider-connection
 * field does not carry.
 */
export type TicketSourceFormField = components["schemas"]["TicketSourceFormField"];

/** What the provider can do — its own three flags, copied onto its catalog entry unchanged. */
export type TicketSourceCapabilities = components["schemas"]["TicketSourceCapabilities"];

/** One page of sources. */
export type TicketSourcePage = components["schemas"]["TicketSourcePage"];

/** What an add sends: the kind, the list's heading, and the provider's own settings. */
export type TicketSourceCreate = components["schemas"]["TicketSourceCreate"];

/** What a row may change: the name, the settings whole, or the pause. */
export type TicketSourcePatch = components["schemas"]["TicketSourcePatch"];

/** A submission's settings, keyed by the catalog's field names — strings and lists of them. */
export type TicketSourceConfigSubmission = components["schemas"]["TicketSourceConfigSubmission"];

/** What **Test connection** found. */
export type TicketSourceTest = components["schemas"]["TicketSourceTest"];

/** How one source's sync stands: the row's half and the loop's half. */
export type TicketSourceStatusReport = components["schemas"]["TicketSourceStatusReport"];

/** What one completed sync did. */
export type TicketSourceSyncResult = components["schemas"]["TicketSourceSyncResult"];

/**
 * How many sources one listing asks for — the service's own ceiling.
 *
 * A workspace's sources are a handful; a hundred is the most the contract allows in one page
 * and more than mockup 17's list imagines has.
 */
export const LIST_PAGE_SIZE = 100;

/** The ticket sources, as `ouroboros-rest` serves them. */
export const sources = {
  /**
   * The kinds this build can connect, each with the form its provider declares.
   *
   * @param client The client to call through. Defaults to the server-side one; tests pass one
   *   over a stub `fetch`.
   * @returns The catalog, in the order the service lists it. Empty only in a build that
   *   registers no provider.
   * @throws {ApiError} What the service answered. A `401` redirects to login before this
   *   rejects.
   */
  async catalog(client: ApiClient = api()): Promise<TicketSourceCatalog> {
    return unwrap(await client.GET("/api/v1/sources/catalog"));
  },

  /**
   * This workspace's sources, credentials masked.
   *
   * @param client The client to call through.
   * @returns One page of up to {@link LIST_PAGE_SIZE}, by display name. A workspace that has
   *   configured nothing answers an empty `items` — the guidance state, not a failure.
   * @throws {ApiError} What the service answered.
   */
  async list(client: ApiClient = api()): Promise<TicketSourcePage> {
    return unwrap(
      await client.GET("/api/v1/sources", { params: { query: { limit: LIST_PAGE_SIZE } } }),
    );
  },

  /**
   * One source.
   *
   * @param id The source.
   * @param client The client to call through.
   * @returns The source, credential masked.
   * @throws {ApiError} `404 ticket_source_not_found` for a source this workspace does not have.
   */
  async read(id: string, client: ApiClient = api()): Promise<TicketSource> {
    return unwrap(await client.GET("/api/v1/sources/{id}", { params: { path: { id } } }));
  },

  /**
   * Add a source.
   *
   * The service judges the settings against the provider's own schema and stores what was
   * typed; nothing is asked of the tracker — **Test connection** is the round-trip, and a
   * separate step so a source can be configured before its token exists.
   *
   * @param body The kind, the heading, and the settings keyed by the catalog's field names —
   *   the credential among them, which the service routes to the vault.
   * @param client The client to call through.
   * @returns The source as stored, with a masked echo of the credential's suffix.
   * @throws {ApiError} What the service answered: `403 forbidden` for a role that may not
   *   add, `422 ticket_source_config_invalid` with `details.fields` keyed by field name, `409
   *   ticket_source_name_taken`, or a `501` for a kind this build has no provider for.
   */
  async add(body: TicketSourceCreate, client: ApiClient = api()): Promise<TicketSource> {
    return unwrap(await client.POST("/api/v1/sources", { body }));
  },

  /**
   * Change a source's name, settings or status.
   *
   * A `PATCH` carrying only what changes. `config` is replaced whole and judged without the
   * credential; `status` takes `active` or `paused`.
   *
   * @param id The source.
   * @param patch What changes.
   * @param client The client to call through.
   * @returns The source as stored.
   * @throws {ApiError} `403 forbidden`, `404 ticket_source_not_found`,
   *   `422 ticket_source_config_invalid`, `409 ticket_source_name_taken`.
   */
  async update(
    id: string,
    patch: TicketSourcePatch,
    client: ApiClient = api(),
  ): Promise<TicketSource> {
    return unwrap(
      await client.PATCH("/api/v1/sources/{id}", { params: { path: { id } }, body: patch }),
    );
  },

  /**
   * Store a credential — write-only.
   *
   * @param id The source.
   * @param secret The credential, exactly as typed: the service trims nothing.
   * @param client The client to call through.
   * @returns The source, with `credentialMask` echoing the new credential's suffix.
   * @throws {ApiError} `409 ticket_source_credentials_unsupported` for a provider that takes
   *   none, `422 ticket_source_config_invalid` under `details.fields.<field>` when the secret
   *   field's own rules refused it, `403 forbidden`, `404 ticket_source_not_found`.
   */
  async setCredentials(
    id: string,
    secret: string,
    client: ApiClient = api(),
  ): Promise<TicketSource> {
    return unwrap(
      await client.POST("/api/v1/sources/{id}/credentials", {
        params: { path: { id } },
        body: { secret },
      }),
    );
  },

  /**
   * Ask the provider whether a source works, and read what it said.
   *
   * A `POST` with no body. **A tracker that refused is a `200`** — the refusal is in the
   * resource, as `status: "failed"` with its class, never as an `ApiError`. Nothing is written.
   *
   * @param id The source.
   * @param client The client to call through.
   * @returns What the provider found.
   * @throws {ApiError} What the service answered about the *request* — `403 forbidden`,
   *   `404 ticket_source_not_found`, `501 ticket_source_kind_unsupported`.
   */
  async test(id: string, client: ApiClient = api()): Promise<TicketSourceTest> {
    return unwrap(await client.POST("/api/v1/sources/{id}/test", { params: { path: { id } } }));
  },

  /**
   * Sync a source now.
   *
   * Answers at once with the status at acceptance — `running: true`, and a `syncedAt` the sync
   * has not moved yet. `syncedAt` advancing on {@link sources.status} is what a row watches for.
   *
   * @param id The source.
   * @param client The client to call through.
   * @returns The status at acceptance.
   * @throws {ApiError} `409 ticket_source_paused`, `409 ticket_source_sync_running`, or
   *   `409 ticket_source_sync_too_soon` with `details.retryAfterSeconds`; `403`, `404`, `501`
   *   about the request.
   */
  async sync(id: string, client: ApiClient = api()): Promise<TicketSourceStatusReport> {
    return unwrap(await client.POST("/api/v1/sources/{id}/sync", { params: { path: { id } } }));
  },

  /**
   * How a source's sync stands.
   *
   * @param id The source.
   * @param client The client to call through.
   * @returns The report: the row's `status`, `statusReason` and `syncedAt`, and the loop's
   *   `running`, `retryAfterSeconds` and `lastSync`.
   * @throws {ApiError} `404 ticket_source_not_found`.
   */
  async status(id: string, client: ApiClient = api()): Promise<TicketSourceStatusReport> {
    return unwrap(
      await client.GET("/api/v1/sources/{id}/status", { params: { path: { id } } }),
    );
  },
};
