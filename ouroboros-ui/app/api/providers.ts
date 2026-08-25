import "server-only";

/**
 * The provider connections — mockup 07's cards
 * ([#228](https://github.com/NobuData/ouroboros/issues/228)), and the catalog that adds one
 * ([#231](https://github.com/NobuData/ouroboros/issues/231)).
 *
 * Ten operations, and they are the page's whole surface on this side of the wire: the
 * **catalog** the dialog draws its tiles from and the cards read their schemas from, the
 * **listing** the grid is drawn from, the **add** itself, the cards' **monthly spend**, the
 * **models** each card lists, the **edits** a card makes — its switch, and its address — and,
 * since AE.3 ([#229](https://github.com/NobuData/ouroboros/issues/229)), the key row's
 * **reveal** and **rotate**, the overflow menu's **remove**, and the **aliases** the delete
 * guard and the switch's confirmation name. One page's calls to one tag, kept together.
 *
 * ### The key row is not an exfiltration UI (decision P4)
 *
 * {@link providers.reveal} is the one call in this module that hands back a credential in
 * the clear, and everything about it is the service's rule rather than this file's: it is a
 * `POST` so a password can travel in a body, it costs a step-up the service answers as
 * `401 step_up_required` (which `app/api/errors.ts` deliberately does not read as a session
 * gone), it is rate-limited per person and per connection, it is audited whether it
 * succeeded or not, and it carries an `expiresAt` the key row stops displaying at.
 * {@link providers.rotate} verifies the new secret with the provider before one conditional
 * `UPDATE` retires the old one — a refusal leaves the old key live, which is the fact the
 * rotate dialog states rather than implies.
 *
 * ### The card is composed from two answers the wire now carries
 *
 * A card is drawn from the adapter's own `configSchema()` and `capabilities()` (AC.1), and
 * this module reaches neither: it reaches the catalog, whose entries carry the fields the
 * schema derives to *and* the four capability flags as the adapter answers them. Nothing here
 * — and nothing in `app/providers/cards.ts` — decides which field is the credential or
 * whether a kind can pull; both are read.
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

/** What an adapter can do — its own four flags, copied onto its catalog entry unchanged. */
export type ProviderCapabilities = components["schemas"]["ProviderCapabilities"];

/** What a card may change about a connection — the switch, the cap, the note, the address. */
export type ProviderConnectionPatch = components["schemas"]["ProviderConnectionPatch"];

/** The cards' meters: the UTC calendar month, and one row per kind with usage in it. */
export type ProviderMonthlySpend = components["schemas"]["ProviderMonthlySpend"];

/** One kind's month — what one card's meter is computed from. */
export type ProviderMonthlySpendRow = components["schemas"]["ProviderMonthlySpendRow"];

/** One model discovery reported on a connection — a chip, or a pull-list line. */
export type ModelOption = components["schemas"]["ModelOption"];

/** One page of them. */
export type ProviderConnectionPage = components["schemas"]["ProviderConnectionPage"];

/** What an add sends: the kind, the card's heading, and the adapter's own settings. */
export type ProviderConnectionCreate = components["schemas"]["ProviderConnectionCreate"];

/**
 * How a reveal steps up, if it does. `{}` is a legitimate body: a session created inside
 * the window is a re-authentication in itself.
 */
export type ProviderRevealRequest = components["schemas"]["ProviderRevealRequest"];

/** A credential in the clear, and the instant a client should stop showing it. */
export type ProviderRevealed = components["schemas"]["ProviderRevealed"];

/** The replacement credential a rotate sends. Live-validated before the old one is retired. */
export type ProviderRotateRequest = components["schemas"]["ProviderRotateRequest"];

/**
 * One alias of the registry — the thing that resolves *through* a connection, and therefore
 * what deleting or switching off a connection takes with it.
 */
export type ModelAlias = components["schemas"]["ModelAlias"];

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

  /**
   * This workspace's calendar-month spend, per provider kind — the cards' meters.
   *
   * Per *kind* rather than per connection, because that is what the ledger records
   * (`token_usage.provider`, decision **F8**): a card matches its own `kind` against the rows
   * and says so if two connections share one. The month is the UTC one, served with the
   * figures, and nothing in it is coalesced — an unpriced kind answers `spendCents: null`,
   * which the card renders as *no metered spend* and never as `$0.00`.
   *
   * @param client The client to call through.
   * @returns The month and its rows. Empty `providers` for a workspace that has spent nothing
   *   this month — every card's absence, not a failure.
   * @throws {ApiError} What the service answered.
   */
  async spend(client: ApiClient = api()): Promise<ProviderMonthlySpend> {
    return unwrap(await client.GET("/api/v1/providers/spend"));
  },

  /**
   * Change a connection's settings — the card's switch, in practice.
   *
   * A `PATCH` carrying only what changes, so a switch never resends an address. The service
   * writes the audit event; a body that changes nothing is answered with the connection
   * unchanged and writes none.
   *
   * @param id The connection.
   * @param patch What changes. `{ enabled }` is the whole of what the card sends today; the
   *   cap and the note are AE.6's ([#232](https://github.com/NobuData/ouroboros/issues/232)).
   * @param client The client to call through.
   * @returns The connection as stored, masked.
   * @throws {ApiError} What the service answered — `403 forbidden` for a role that may read
   *   the card and not write to it, `404 provider_connection_not_found` for a connection this
   *   workspace does not have.
   */
  async update(
    id: string,
    patch: ProviderConnectionPatch,
    client: ApiClient = api(),
  ): Promise<ProviderConnection> {
    return unwrap(
      await client.PATCH("/api/v1/providers/{id}", { params: { path: { id } }, body: patch }),
    );
  },

  /**
   * The models discovery has reported on one connection — the card's chips, or its pull-list.
   *
   * Read from the registry tag's `model-options`, which is where `provider_models` crosses
   * the wire for mockup 21's inspector as well: one read, so a chip on this page and an
   * option in that select cannot disagree about what a provider offers.
   *
   * @param connectionId The connection.
   * @param client The client to call through.
   * @returns The models, ordered by id. Empty when discovery has not run — an honest empty
   *   region, not a failure.
   * @throws {ApiError} What the service answered — `404 provider_connection_not_found` for a
   *   connection this workspace does not have.
   */
  async models(connectionId: string, client: ApiClient = api()): Promise<readonly ModelOption[]> {
    return unwrap(
      await client.GET("/api/v1/registry/aliases/model-options", {
        params: { query: { connection: connectionId } },
      }),
    ).models;
  },

  /**
   * Reveal a connection's credential, in the clear.
   *
   * The one call here that returns secret material, and the service prices it accordingly:
   * a step-up, a rate limit, and an audit row whether or not it succeeded. `expiresAt` in the
   * answer is the instant to stop displaying the value at — an instruction the key row keeps,
   * because a value handed to a browser is in the browser and no header takes it back.
   *
   * @param id The connection.
   * @param body How this reveal steps up: `{ password }` when the reader has just typed one,
   *   `{}` to lean on a session created inside the window.
   * @param client The client to call through.
   * @returns The credential, the connection it belongs to, and when to forget it.
   * @throws {ApiError} What the service answered: `401 step_up_required` with
   *   `details.methods` and `details.maxAgeSeconds` — the challenge, not a session gone;
   *   `429 provider_reveal_rate_limited` with `details.retryAfterSeconds`;
   *   `409 provider_credential_absent` for a connection that stores none; `403 forbidden`;
   *   `404 provider_connection_not_found`.
   */
  async reveal(
    id: string,
    body: ProviderRevealRequest,
    client: ApiClient = api(),
  ): Promise<ProviderRevealed> {
    return unwrap(
      await client.POST("/api/v1/providers/{id}/reveal", { params: { path: { id } }, body }),
    );
  },

  /**
   * Replace a connection's credential — verify, then retire.
   *
   * The service checks the new secret with the provider first and only then issues one
   * conditional `UPDATE`, so a refusal here means the old credential is still the one in
   * use and a success has no window in which neither was. The same call stores a *first*
   * key on a connection whose adapter declares the credential optional — the vLLM card's
   * **Save** — because storing one and replacing one are the same swap with nothing to
   * retire.
   *
   * @param id The connection.
   * @param secret The new credential, exactly as typed: the service trims nothing.
   * @param client The client to call through.
   * @returns The connection as stored, masked with the new credential's suffix.
   * @throws {ApiError} What the service answered: `422 provider_validation_failed` with the
   *   provider's own `details.detail` — **and the old key still live**;
   *   `409 provider_connection_changed` when the row was rewritten mid-check;
   *   `409 provider_credential_absent` for a kind that takes no credential; `403 forbidden`;
   *   `404 provider_connection_not_found`.
   */
  async rotate(id: string, secret: string, client: ApiClient = api()): Promise<ProviderConnection> {
    return unwrap(
      await client.POST("/api/v1/providers/{id}/rotate", {
        params: { path: { id } },
        body: { secret },
      }),
    );
  },

  /**
   * Disconnect a provider.
   *
   * The service refuses while any alias still resolves on the connection — Y.1's foreign
   * key, thrown at last — and names them, so the card can say which routes to repoint
   * first rather than that something, somewhere, depends on it.
   *
   * @param id The connection.
   * @param client The client to call through.
   * @returns Nothing: the contract's `204`.
   * @throws {ApiError} What the service answered: `409 provider_connection_in_use` with
   *   `details.aliases` — the dependent aliases' names, sorted; `403 forbidden`;
   *   `404 provider_connection_not_found`.
   */
  async remove(id: string, client: ApiClient = api()): Promise<void> {
    await client.DELETE("/api/v1/providers/{id}", { params: { path: { id } } });
  },

  /**
   * Every alias of the registry, with the connection each resolves through.
   *
   * Read from the registry tag for the same reason {@link providers.models} is: an alias is
   * the registry's row, and the one listing that names its connection is this one. The cards
   * need it for one question — *which routes does this card carry* — asked before a switch is
   * pressed off, because `PATCH { enabled: false }` has no guard of its own and a loop that
   * resolves through a switched-off provider fails exactly as it would through a deleted one.
   *
   * @param client The client to call through.
   * @returns The aliases, ordered by name. Empty for a workspace that has defined none.
   * @throws {ApiError} What the service answered.
   */
  async aliases(client: ApiClient = api()): Promise<readonly ModelAlias[]> {
    return unwrap(await client.GET("/api/v1/registry/aliases", {})).aliases;
  },
};
