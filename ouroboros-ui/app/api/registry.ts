/**
 * The model registry — what mockup 21's `/models/registry` reads and writes through
 * `ouroboros-rest`.
 *
 * The page's read is CH.5's composed payload
 * ([#588](https://github.com/NobuData/ouroboros/issues/588)), which is every cell of the
 * allowed-models table already decided — the binding and its monogram letters, the raw model
 * id, CH.2's param chips, the derived health cell, CH.3's price with its provenance, the
 * `Used by` count and the referrers behind it, and the switch. The table's one write is CI.2's
 * ([#592](https://github.com/NobuData/ouroboros/issues/592)) **On** switch, which is CH.1's
 * `PATCH` ([#584](https://github.com/NobuData/ouroboros/issues/584)) carrying `{ enabled }`
 * and nothing else.
 *
 * ### The two ways a name enters the registry (CI.4)
 *
 * CI.4 ([#594](https://github.com/NobuData/ouroboros/issues/594)) adds the calls behind the
 * head's two actions, and they are deliberately **five small operations rather than one
 * flow-shaped endpoint**:
 *
 * | Call | What it answers | Whose ticket |
 * |---|---|---|
 * | `POST /registry/aliases` | one curated alias, bound or unbound | CH.1 (#584) |
 * | `GET /registry/aliases/model-options` | the model select, *live from the provider* | CH.1 (#584) |
 * | `GET /registry/param-schema` | which parameters that model even has | CH.2 (#585) |
 * | `GET /registry/import/{id}/candidates` | what a connection has to import, annotated | CH.4 (#587) |
 * | `POST /registry/import` | the ticked rows, as one transaction | CH.4 (#587) |
 *
 * Three of them are read as the reader moves through a dialog — a connection is chosen, then a
 * model, then its parameters — so each is its own request rather than a payload the page pays
 * for on every visit. The two writes are the two paths: one alias at a time, or a reviewed
 * batch, and **the batch is all-or-nothing** so an operator never has to work out what landed.
 *
 * ### The table is one request, and the cells are served rather than derived
 *
 * `GET /api/v1/registry` joins five subsystems in one payload, and the contract is explicit
 * about why: a page that read aliases, then health, then prices would render a row nobody's
 * database was ever in. The same payload feeds the alias inspector's prefill (CI.3,
 * [#593](https://github.com/NobuData/ouroboros/issues/593)) and routing's swap menus, so the
 * three surfaces cannot disagree. Nothing in `app/registry/` re-derives a chip, a price string
 * or a health state from the structured fields beside them — the one thing a client must not
 * invent is the value for *there is nothing here*, and the payload carries that itself.
 *
 * ### The write sends the position asked for, and only that
 *
 * A `PATCH` of `{ enabled }`: the switch never resends a name, a binding or a params document
 * it does not own. The service answers with the alias as re-read and, when a referenced alias
 * was switched off, the hops the next resolution will drop — which is why the table asks
 * *before* the write rather than reporting after it.
 *
 * ### The workspace is the session's
 *
 * There is no workspace in these paths and this client sends no `X-Ouro-Tenant`
 * (`app/api/server.ts` says why). Any member may read the registry; the write is the
 * service's to gate, and `app/registry/switch-actions.ts` says what a member who reaches it
 * anyway is told.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/**
 * One row of the allowed-models table, every cell composed.
 *
 * `binding` is **`null`** for an unbound alias — mockup 21's *no provider* row — and the row
 * is served anyway: hiding an alias because nothing resolves through it would hide the very
 * row the page's orphan treatment exists to draw.
 */
export type RegistryAlias = components["schemas"]["RegistryAlias"];

/**
 * Where an alias resolves: the connection, what mockup 07 calls it, and the square's letters,
 * computed server-side so this page and the provider cards cannot pick different letters for
 * one connection.
 */
export type RegistryBinding = components["schemas"]["RegistryBinding"];

/**
 * The `Health` cell — **derived, never probed** (decision **R8**).
 *
 * Six state words and a note; no colour, no severity and no tone, deliberately. Mapping a
 * state to a dot is `app/registry/table.ts`'s work, in the surface that owns the classes.
 */
export type AliasHealth = components["schemas"]["AliasHealth"];

/**
 * The six states the health cell can be in.
 *
 * Named separately because the table maps every one of them to a treatment, so a seventh
 * state added to the service is a build error in the page rather than a row that silently
 * draws as healthy — decision **M8** on this side of the wire: `unknown` is a state, and it is
 * never rendered as green.
 */
export type AliasHealthState = AliasHealth["state"];

/**
 * What one model costs this workspace — CH.3's resolution
 * ([#586](https://github.com/NobuData/ouroboros/issues/586)), rendered.
 *
 * `display` is the cell, already a string in one of the four shapes; `price` is the resolved
 * pair with its provenance, or **`null`** for a model the catalog does not cover. Null and
 * `"—"` are the same fact said twice, and neither is `$0`.
 */
export type ModelPrice = components["schemas"]["ModelPrice"];

/** Where a price came from — the vendored snapshot, or this workspace's own override. */
export type ModelPriceProvenance = components["schemas"]["ModelPriceProvenance"];

/** One thing that references an alias — one `Used by` chip, and one line of a confirmation. */
export type ModelAliasReference = components["schemas"]["ModelAliasReference"];

/** The whole page, in one payload. */
export type RegistryReadModel = components["schemas"]["RegistryReadModel"];

/**
 * What the switch sends: `{ enabled }` and nothing else. The other fields are the inspector's
 * (CI.3) and the contract writes only the fields present.
 */
export type UpdateModelAlias = components["schemas"]["UpdateModelAlias"];

/**
 * What a write answers with: the alias as stored, the revision it left (or `null` for a body
 * that changed nothing), any warnings, and — after switching a referenced alias off — the
 * references whose hops the next resolution will drop.
 */
export type ModelAliasChange = components["schemas"]["ModelAliasChange"];

/**
 * What **+ New alias** sends ([#584](https://github.com/NobuData/ouroboros/issues/584)) — in
 * either of its two modes, because the two are one body.
 *
 * `connectionId` absent (or `null`) *is* the bind-later mode: the name is stored ahead of its
 * key, forced off whatever `enabled` said, and answered with an `alias_unbound` warning. There
 * is no second endpoint and no `mode` field, which is what keeps the create dialog's toggle a
 * decision about **one** request rather than a fork in the client.
 */
export type CreateModelAlias = components["schemas"]["CreateModelAlias"];

/**
 * A connection as the registry's own payloads echo it — the id, the kind and the display name,
 * and no credential.
 *
 * Named here because three of CI.4's answers carry one (`ModelOptionList`, `ImportCandidateList`
 * and `ImportResult`), each saying *this is the connection you asked about*, so a stale answer
 * to a superseded question is recognisable rather than merely late.
 */
export type ModelAliasConnection = components["schemas"]["ModelAliasConnection"];

/** One model a connection has, as discovery reported it — an entry of the model select. */
export type ModelOption = components["schemas"]["ModelOption"];

/**
 * The model select's whole answer — *listed live from the provider*, as mockup 21's hint says.
 *
 * **Empty when discovery has not run**, which is an honest empty select rather than a failure:
 * the alias may still be created by typing the model, and the create answers with a
 * `model_not_discovered` warning rather than a refusal.
 */
export type ModelOptionList = components["schemas"]["ModelOptionList"];

/**
 * What one model can be tuned with, and what this workspace allows the alias to be used for —
 * CH.2's merged schema ([#585](https://github.com/NobuData/ouroboros/issues/585)).
 *
 * Two sections, both in one dialect, so one renderer draws both — and a `422` naming
 * `params.thinking` or `restrictions.batch_ok` maps back to a field of the section it came
 * from without a lookup table.
 */
export type ModelParamSchemaResponse = components["schemas"]["ModelParamSchemaResponse"];

/** One half of a parameter answer — a schema, and the ordered fields it renders as. */
export type ModelParamSection = components["schemas"]["ModelParamSection"];

/**
 * One parameter, already derived into what a form draws.
 *
 * Derived **by the service**, deliberately: which widget a field gets and what its bounds are
 * is a decision made once, so a client that wants the schema has it and a client that wants a
 * form has one, and the two cannot disagree because the second is computed from the first.
 */
export type ModelParamFormField = components["schemas"]["ModelParamFormField"];

/**
 * Why a params section offers nothing, or `null` when it offers something.
 *
 * Named separately because the create dialog maps every one of them to a sentence, so a fourth
 * code added to the service is a build error here rather than an empty form that says nothing.
 */
export type ModelParamReason = ModelParamSchemaResponse["reason"];

/** What a model can be tuned with and how much it holds, in the facts a list row has space for. */
export type ModelCapabilitySummary = components["schemas"]["ModelCapabilitySummary"];

/** An alias that already names a discovered model — what marks a candidate row. */
export type ImportCandidateAlias = components["schemas"]["ImportCandidateAlias"];

/**
 * One discovered model, annotated with everything the import wizard's row draws — CH.4's
 * ([#587](https://github.com/NobuData/ouroboros/issues/587)) candidate.
 *
 * `suggestedName` may be **`null`**, which is honest rather than empty: no name could be made
 * to fit, and the row arrives with a cell for somebody to fill in. `selected` is the server's
 * answer to *should the wizard start with this row ticked*, and it is false for an
 * already-aliased model and for one with no suggestion.
 */
export type ImportCandidate = components["schemas"]["ImportCandidate"];

/** Why the wizard has nothing to show, when it has nothing to show. */
export type ImportEmpty = components["schemas"]["ImportEmpty"];

/** The import wizard's whole state for one connection. */
export type ImportCandidateList = components["schemas"]["ImportCandidateList"];

/** One row the operator left ticked — a model, the name to give it, and its params. */
export type ImportModelAliasItem = components["schemas"]["ImportModelAliasItem"];

/** What the wizard's **Create** sends: one connection, and the rows ticked under it. */
export type ImportModelAliases = components["schemas"]["ImportModelAliases"];

/** One alias an import created. */
export type ImportedAlias = components["schemas"]["ImportedAlias"];

/** One item the import passed over for already having an alias — the idempotency, reported. */
export type SkippedImport = components["schemas"]["SkippedImport"];

/**
 * What a batch did — what it created, and what it deliberately did not.
 *
 * There is no partial state to report: the batch either created everything it was asked for
 * that was not skipped, or created nothing and answered `model_import_invalid`.
 */
export type ImportResult = components["schemas"]["ImportResult"];

/** The model registry, as `ouroboros-rest` serves it. */
export const registry = {
  /**
   * The allowed-models table, composed — every alias in the workspace with every cell decided.
   *
   * @param client The client to call through. Defaults to the server-side one; tests pass
   *   one over a stub `fetch`.
   * @returns The payload. A workspace with no aliases answers an empty array — the page's
   *   empty state, not a failure.
   * @throws {ApiError} What the service answered. A `401` redirects to login before this
   *   rejects.
   */
  async read(client: ApiClient = api()): Promise<RegistryReadModel> {
    return unwrap(await client.GET("/api/v1/registry", {}));
  },

  /**
   * Change one alias — the table's **On** switch, in practice.
   *
   * A `PATCH` carrying only what changes, so a switch never resends a binding or a params
   * document. Enabling an unbound alias is the service's refusal (`model_alias_unbound`), not
   * a state this client has to reason about first: the switch is inert on that row, and the
   * refusal is what a stale render is told.
   *
   * @param id The alias's id.
   * @param change What changes. `{ enabled }` is the whole of what the switch sends.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The alias as it now stands, and what the write did.
   * @throws {ApiError} What the service answered — `403 forbidden` for a role that may read
   *   the table and not write to it, `404 model_alias_not_found` for an alias somebody else
   *   removed, `422 model_alias_unbound` for a switch-on the binding does not allow.
   */
  async update(
    id: string,
    change: UpdateModelAlias,
    client: ApiClient = api(),
  ): Promise<ModelAliasChange> {
    return unwrap(
      await client.PATCH("/api/v1/registry/aliases/{id}", {
        params: { path: { id } },
        body: change,
      }),
    );
  },

  /**
   * Create one alias — the **+ New alias** dialog's write, in either of its two modes
   * ([#594](https://github.com/NobuData/ouroboros/issues/594)).
   *
   * **One call for both modes.** A body with a `connectionId` binds now; a body without one is
   * the create-ahead-of-a-key path, stored switched off whatever it asked for and answered
   * with an `alias_unbound` warning. The dialog's toggle therefore decides what goes *in* the
   * body rather than which endpoint is called, which is why there is no second method here.
   *
   * @param body The name, the model, and — for a bound alias — the connection and its params.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The alias as stored, re-read after the commit, with its revision and any
   *   warnings.
   * @throws {ApiError} What the service answered — `403 forbidden` for a member,
   *   `404 provider_connection_not_found` for a connection this workspace does not have,
   *   `422 model_alias_name_taken` for a name it already uses, and
   *   `422 model_alias_params_invalid` for a param the bound model cannot honour (or any param
   *   at all on an unbound alias).
   */
  async create(body: CreateModelAlias, client: ApiClient = api()): Promise<ModelAliasChange> {
    return unwrap(await client.POST("/api/v1/registry/aliases", { body }));
  },

  /**
   * The models one connection has — mockup 21's model select, *listed live from the provider*.
   *
   * @param connectionId The connection to list, in this workspace.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The connection and its models, ordered by id. **Empty when discovery has not
   *   run**, which is an honest empty select and not a failure — the dialog then takes the
   *   model id as text and the create answers with a `model_not_discovered` warning.
   * @throws {ApiError} What the service answered — `404 provider_connection_not_found` for a
   *   connection this workspace does not have.
   */
  async modelOptions(connectionId: string, client: ApiClient = api()): Promise<ModelOptionList> {
    return unwrap(
      await client.GET("/api/v1/registry/aliases/model-options", {
        params: { query: { connection: connectionId } },
      }),
    );
  },

  /**
   * What one model can be tuned with — CH.2's merged schema
   * ([#585](https://github.com/NobuData/ouroboros/issues/585)), which the dialog's parameter
   * fields are drawn from and every write to them is validated against.
   *
   * @param modelId The model, **in the provider's own spelling** and unfolded — the service
   *   normalises nothing, and neither does this.
   * @param connectionId The connection the alias binds to, or `null` to ask about an unbound
   *   one. Omitting it is a *question* rather than a mistake: there is no adapter to ask, so
   *   the answer is an empty params section whose `description` says why, and the registry
   *   restrictions in full — those are true whether or not anything is on the other end.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns Both sections, the fields they render as, and where each bound came from.
   * @throws {ApiError} What the service answered.
   */
  async paramSchema(
    modelId: string,
    connectionId: string | null = null,
    client: ApiClient = api(),
  ): Promise<ModelParamSchemaResponse> {
    return unwrap(
      await client.GET("/api/v1/registry/param-schema", {
        params: {
          // Absent rather than null: the parameter is optional in the contract, and a
          // `connection=` with nothing after it is a malformed uuid rather than a question
          // about an unbound alias.
          query: connectionId === null ? { model: modelId } : { model: modelId, connection: connectionId },
        },
      }),
    );
  },

  /**
   * What one connection has to import, annotated — CH.4's candidate table
   * ([#587](https://github.com/NobuData/ouroboros/issues/587)).
   *
   * **The rows are discovery's, and only discovery's** (decision **R7**): there is no way to
   * import a model a connection has not reported, here or on {@link registry.importAliases}.
   *
   * @param connectionId The connection to import from, in this workspace.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The connection, its candidates ordered by model id, and `empty` — non-null
   *   **exactly** when there are none, so a wizard that opens on nothing can say which
   *   connection reported nothing and where to test it.
   * @throws {ApiError} What the service answered — `403 forbidden` for a member, because this
   *   is the first half of a write.
   */
  async candidates(
    connectionId: string,
    client: ApiClient = api(),
  ): Promise<ImportCandidateList> {
    return unwrap(
      await client.GET("/api/v1/registry/import/{connectionId}/candidates", {
        params: { path: { connectionId } },
      }),
    );
  },

  /**
   * Create the rows the operator ticked, **as one transaction**.
   *
   * All of them or none of them: a batch with anything wrong in it is a `422` describing every
   * offending item with nothing created, which is what lets the wizard put each error back on
   * the row it belongs to and promise that nothing landed. A model that already has an alias
   * on the connection is **skipped rather than refused**, so re-running an import after a
   * discovery refresh is safe.
   *
   * @param body The connection, and the items — each a model discovery reported and the name
   *   to give it.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns What was created and what was skipped, both in the order the items arrived.
   *   A re-run that skips everything creates nothing and still succeeds.
   * @throws {ApiError} What the service answered — `422 model_import_invalid` with
   *   `details.items` keyed by each item's position in the request.
   */
  async importAliases(
    body: ImportModelAliases,
    client: ApiClient = api(),
  ): Promise<ImportResult> {
    return unwrap(await client.POST("/api/v1/registry/import", { body }));
  },
};
