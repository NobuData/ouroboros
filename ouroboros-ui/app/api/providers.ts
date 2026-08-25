import "server-only";

/**
 * The provider connections — mockup 07's cards, and the catalog that adds one
 * ([#231](https://github.com/NobuData/ouroboros/issues/231)).
 *
 * Three operations over the `providers` tag, and they are the add-provider flow's whole
 * surface on this side of the wire: the **catalog** the dialog draws its tiles from, the
 * **listing** the duplicate warning compares against, and the **add** itself. The rest of the
 * tag — reveal, rotate, edit, disconnect — is AE.3's ([#229](https://github.com/NobuData/ouroboros/issues/229))
 * and belongs beside these when it arrives, because they are one page's calls to one tag.
 *
 * What this adds over a raw call is what every resource file in this directory adds: a name,
 * the path written down once so a rename in the contract is a failed typecheck rather than a
 * `404` behind a button, and the body rather than the body-or-nothing.
 *
 * ### The catalog is the registry, crossing the wire
 *
 * `ouroboros-rest`'s adapter registry is what decides which providers this build can connect
 * (decision **P1**), and this module talks to that service and to nothing else — so the
 * registry has to be *read*, not known. {@link providers.catalog} is that read, and the shape
 * it answers is already a form: each entry's `fields` are derived once, in the service, from
 * the adapter's own `configSchema()`, so nothing here decides which widget a field takes or
 * which field is the credential. `app/providers/catalog.ts` iterates it; `app/ui/schema-form.tsx`
 * draws it.
 *
 * ### The workspace is the session's
 *
 * There is no workspace in any of these paths and this client sends no `X-Ouro-Tenant`
 * (`app/api/server.ts` says why). The listing and the catalog are open to every member; the
 * add is `owner` or `admin`, and a `403` reaching this layer is a state the dialog renders
 * rather than a bug — `app/providers/catalog.ts` carries the sentence.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** Every kind this build can connect, each with its form — `openapi.yaml` § `ProviderCatalog`. */
export type ProviderCatalog = components["schemas"]["ProviderCatalog"];

/** One connectable kind: a tile, and the form behind it. */
export type ProviderCatalogEntry = components["schemas"]["ProviderCatalogEntry"];

/**
 * One field of an add-form, as the service derived it from the adapter's schema.
 *
 * Every optional keyword is an explicit `null` rather than absent, which is what lets a
 * renderer consume it without a list of defaults of its own.
 */
export type ProviderFormField = components["schemas"]["ProviderFormField"];

/** Which adapter reaches a provider — V015's six spellings. */
export type ProviderConnectionKind = components["schemas"]["ProviderConnectionKind"];

/** One connection, credential masked — the card mockup 07 draws. */
export type ProviderConnection = components["schemas"]["ProviderConnection"];

/** One page of them. */
export type ProviderConnectionPage = components["schemas"]["ProviderConnectionPage"];

/** What an add sends: the kind, the card's heading, and the adapter's own settings. */
export type ProviderConnectionCreate = components["schemas"]["ProviderConnectionCreate"];

/**
 * How many connections one listing asks for — the service's own ceiling.
 *
 * The listing exists here for one purpose, the duplicate warning, and a warning that compared
 * against the first twenty-five of a workspace's connections would be silent about the
 * twenty-sixth. A hundred is the most the contract allows in one page and more than any
 * workspace mockup 07 imagines has.
 */
export const LIST_PAGE_SIZE = 100;

/** The provider connections, as `ouroboros-rest` serves them. */
export const providers = {
  /**
   * The kinds this build can connect, each with the form its adapter declares.
   *
   * @param client The client to call through. Defaults to the server-side one; tests pass one
   *   over a stub `fetch`.
   * @returns The catalog, in the order the service lists it. Empty only in a build that
   *   registers no adapter.
   * @throws {ApiError} What the service answered. A `401` redirects to login before this
   *   rejects.
   */
  async catalog(client: ApiClient = api()): Promise<ProviderCatalog> {
    return unwrap(await client.GET("/api/v1/providers/catalog"));
  },

  /**
   * This workspace's connections, credentials masked.
   *
   * @param client The client to call through.
   * @returns One page of up to {@link LIST_PAGE_SIZE}. A workspace that has connected nothing
   *   answers an empty `items` — the dashed card's state, not a failure.
   * @throws {ApiError} What the service answered.
   */
  async list(client: ApiClient = api()): Promise<ProviderConnectionPage> {
    return unwrap(
      await client.GET("/api/v1/providers", { params: { query: { limit: LIST_PAGE_SIZE } } }),
    );
  },

  /**
   * Connect a provider.
   *
   * The service checks the settings against the adapter's schema, asks the provider whether
   * they work, and only then stores anything — so a refusal here means nothing was written.
   *
   * @param body The kind, the heading, and the settings keyed by the catalog's field names —
   *   the credential among them, which the service routes to the vault.
   * @param client The client to call through.
   * @returns The connection as stored, masked.
   * @throws {ApiError} What the service answered: `403 forbidden` for a role that may not
   *   connect, `422 provider_config_invalid` with `details.fields` keyed by field name,
   *   `422 provider_validation_failed` with the provider's own `details.detail`, or a `501` for
   *   a kind this build has no adapter for.
   */
  async add(body: ProviderConnectionCreate, client: ApiClient = api()): Promise<ProviderConnection> {
    return unwrap(await client.POST("/api/v1/providers", { body }));
  },
};
