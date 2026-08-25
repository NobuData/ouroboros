"use server";

/**
 * The server hops for the **+ New alias** dialog
 * ([#594](https://github.com/NobuData/ouroboros/issues/594)) — the three calls its Client
 * Component cannot make itself.
 *
 * `app/api/server.ts` states the rule this exists under, and `app/providers/add-actions.ts` is
 * the same seam for mockup 07's add-provider dialog: the browser cannot reach REST —
 * `OURO_REST_URL` has no `NEXT_PUBLIC_` prefix and the session cookie is `HttpOnly` — so a
 * Client Component that needs something from the API calls a Server Action that calls it.
 *
 * ### Three calls, made as the reader moves through the dialog
 *
 * The provider list is **not** here: the page has already read it for the import menu and
 * hands it to the dialog as a prop, so opening the dialog costs nothing. What is read on
 * demand is what depends on a choice the reader has just made — the models on the connection
 * they picked ({@link readModelOptions}), and the parameters of the model they picked after
 * that ({@link readParamSchema}). Reading either with the page would mean reading every
 * connection's models on every visit to a table most visits only scroll.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * The paragraph every action module in this product carries:
 *
 * - **There is no workspace in any of the three calls and no person.** An alias belongs to
 *   *the workspace the caller's own session is acting in*, resolved by `ouroboros-rest` from
 *   the cookie this request carries. There is nothing to forge and no way to point a create at
 *   somebody else's workspace; a `connectionId` from another workspace is the service's `404`,
 *   never a write.
 * - **The role gate is the service's, not this module's** — `owner` or `admin`, and nobody
 *   else (CH.1). The page draws **+ New alias** inert for a member, but that is *presentation*:
 *   a check made in the browser is a check anybody can skip, so the one that decides is behind
 *   the API, and a member who reaches {@link createAlias} anyway gets the service's `403` and
 *   writes nothing. Note that the two **reads** are deliberately open to any member — a model
 *   list and a parameter schema describe a provider's models rather than a workspace's data —
 *   so this module gates neither, exactly as the contract does not.
 * - **What is sent is what the dialog composed.** {@link createAlias} forwards the body as it
 *   is; the name's shape, the model's existence in discovery, and the parameters' fit to the
 *   model are all the service's checks, and the answer is the service's own envelope so the
 *   dialog can put each refusal under the field it is about.
 *
 * ### Failure posture: a value, not a throw
 *
 * A refusal comes back as a value. The dialog is opened *over* a page the reader is still
 * entitled to be on, and a rejected action would replace it with an error screen — which is
 * the wrong outcome for "that name is taken". The one throw that must travel is Next.js's
 * redirect signal, for a session that expired since the page rendered.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import { isApiError } from "@/app/api/errors";
import {
  type CreateModelAlias,
  type ModelOption,
  type ModelParamSchemaResponse,
  registry,
} from "@/app/api/registry";

import { MODELS_UNREADABLE, PARAMS_UNREADABLE } from "./create";

/**
 * **Every value this module needs is imported rather than declared.** A `"use server"` module
 * may export nothing but async functions — a `const` beside them is a build error, and the
 * whole module is then treated as exporting nothing — so the sentences live in
 * `app/registry/create.ts` with the rest of the dialog's decisions, and only types (which are
 * erased) are declared here.
 */

/** What one read of a connection's models produced. */
export type ModelsReading =
  /**
   * The models, in the service's order.
   *
   * **An empty list is a success**, and the dialog draws a text box instead of a select: the
   * contract is explicit that a model may still be typed and the create answers with a
   * `model_not_discovered` warning rather than a refusal.
   */
  | { readonly ok: true; readonly models: readonly ModelOption[] }
  /** Why not — a sentence already written for a reader. */
  | { readonly ok: false; readonly reason: string };

/** What one read of a model's parameter schema produced. */
export type ParamSchemaReading =
  /** The answer, both sections and the reason a section may be empty. */
  | { readonly ok: true; readonly schema: ModelParamSchemaResponse }
  /** Why not — a sentence already written for a reader. */
  | { readonly ok: false; readonly reason: string };

/** What one create produced. */
export type CreateOutcome =
  /** The alias, as stored — its name is what the page then selects. */
  | { readonly ok: true; readonly alias: string }
  /** The service's refusal, for `create.ts`'s `createFailure` to turn into sentences. */
  | { readonly ok: false; readonly refusal: ErrorEnvelope };

/**
 * The models one connection has — the dialog's model select, *listed live from the provider*.
 *
 * @param connectionId The connection the reader chose.
 * @returns The models, or the sentence to draw instead. An empty list is an answer and not a
 *   failure — see {@link ModelsReading}.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function readModelOptions(connectionId: string): Promise<ModelsReading> {
  try {
    const page = await registry.modelOptions(connectionId);

    return { ok: true, models: page.models };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: MODELS_UNREADABLE };
  }
}

/**
 * What one model can be tuned with — CH.2's merged schema, which the dialog's parameter fields
 * are drawn from.
 *
 * @param modelId The model, in the provider's own spelling.
 * @param connectionId The connection it is bound to, or `null` for an unbound alias — a
 *   question rather than a mistake, answered with an empty params section that says why.
 * @returns The schema, or the sentence to draw instead. **A refused read does not stop a
 *   create**: the alias can be made without parameters and tuned afterwards, which is what the
 *   sentence says.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function readParamSchema(
  modelId: string,
  connectionId: string | null = null,
): Promise<ParamSchemaReading> {
  try {
    return { ok: true, schema: await registry.paramSchema(modelId, connectionId) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: PARAMS_UNREADABLE };
  }
}

/**
 * Create one alias.
 *
 * @param body The name, the model, and — in the *bind now* mode — the connection and its
 *   parameters. Composed by the dialog from `create.ts`'s `createBody`, and forwarded as it is.
 * @returns The stored alias's name, or the service's refusal. **A refusal means nothing was
 *   created** — one `POST` writes one row inside one transaction, so there is no partial state
 *   to describe and the dialog says so.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function createAlias(body: CreateModelAlias): Promise<CreateOutcome> {
  try {
    const change = await registry.create(body);

    return { ok: true, alias: change.alias.alias };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      refusal: { code: error.code, message: error.message, details: error.details },
    };
  }
}
