/**
 * The model registry — what mockup 21's `/models/registry` reads and writes through
 * `ouroboros-rest`.
 *
 * One read and one write today. The read is CH.5's composed payload
 * ([#588](https://github.com/NobuData/ouroboros/issues/588)), which is every cell of the
 * allowed-models table already decided — the binding and its monogram letters, the raw model
 * id, CH.2's param chips, the derived health cell, CH.3's price with its provenance, the
 * `Used by` count and the referrers behind it, and the switch. The write is the one CI.2
 * ([#592](https://github.com/NobuData/ouroboros/issues/592)) makes: the **On** switch, which
 * is CH.1's `PATCH` ([#584](https://github.com/NobuData/ouroboros/issues/584)) carrying
 * `{ enabled }` and nothing else.
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
};
