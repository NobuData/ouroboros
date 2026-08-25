"use server";

/**
 * The server hops for the add-provider dialog
 * ([#231](https://github.com/NobuData/ouroboros/issues/231)) — the two calls its Client
 * Component cannot make itself.
 *
 * `app/api/server.ts` states the rule this exists under, and `app/providers/audit-actions.ts`
 * is the same seam for the sheet beside it: the browser cannot reach REST — `OURO_REST_URL`
 * has no `NEXT_PUBLIC_` prefix and the session cookie is `HttpOnly` — so a Client Component
 * that needs something from the API calls a Server Action that calls it.
 *
 * ### The catalog is read when the dialog opens
 *
 * Rather than with the page, for the reason `app/models/rule-actions.ts` gives for the
 * builder's registry read: the dialog is behind a button most visits never press, and a
 * `member` session — which has no dialog — would pay for a read nothing draws. The existing
 * connections are read in the same hop, for the duplicate warning; when that second read
 * fails the catalog is still answered and the warning simply has nothing to compare against,
 * because a warning is not a gate and a dialog that refused to open over it would be.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * The paragraph every action module in this product carries:
 *
 * - **There is no workspace in either call and no person.** A connection belongs to *the
 *   workspace the caller's own session is acting in*, resolved by `ouroboros-rest` from the
 *   cookie this request carries. There is nothing to forge and no way to point an add at
 *   somebody else's workspace.
 * - **The role gate is the service's, not this module's** — `owner` or `admin`, and nobody
 *   else (AD.2). The page draws its openers inert for a member, but that is *presentation*: a
 *   check made in the browser is a check anybody can skip, so the one that decides is behind
 *   the API, and a member who reaches {@link addProvider} anyway gets the service's `403` and
 *   writes nothing. This module hands that refusal back as a value and duplicates no rule.
 * - **What is sent is what was typed.** {@link addProvider} forwards the body the dialog
 *   composed; the schema check, the live validation and the split of the credential from the
 *   settings are all the service's, and the answer is the service's own envelope so the
 *   dialog can put the adapter's designed error under the field it is about.
 *
 * ### Failure posture: a value, not a throw
 *
 * A refusal comes back as a value. The dialog is opened *over* a page the reader is still
 * entitled to be on, and a rejected action would replace it with an error screen — which is
 * the wrong outcome for "the provider did not accept that key". The one throw that must
 * travel is Next.js's redirect signal, for a session that expired since the page rendered.
 */

import { isApiError } from "@/app/api/errors";
import { providers, type ProviderConnectionCreate } from "@/app/api/providers";
import type { ProviderCatalogEntry } from "@/app/api/providers";

import { type ApiRefusal, CATALOG_UNAVAILABLE, type ExistingConnection } from "./catalog";

/**
 * **Every value this module needs is imported rather than declared.** A `"use server"`
 * module may export nothing but async functions — a `const` beside them is a build error,
 * and the whole module is treated as exporting nothing — so the sentences and the result
 * types live in `app/providers/catalog.ts` with the rest of the dialog's decisions.
 */

/** What one open of the dialog read. */
export type CatalogReading =
  /** The catalog, and what the workspace already has. */
  | {
      readonly ok: true;
      readonly entries: readonly ProviderCatalogEntry[];
      readonly existing: readonly ExistingConnection[];
    }
  /** Why not — a sentence already written for a reader. */
  | { readonly ok: false; readonly reason: string };

/** What one add produced. */
export type AddOutcome =
  /** The connection, as stored — enough of it for the done step. */
  | {
      readonly ok: true;
      readonly connection: { readonly id: string; readonly displayName: string };
    }
  /** The service's refusal, for `catalog.ts`'s `addFailure` to turn into a sentence. */
  | { readonly ok: false; readonly refusal: ApiRefusal };

/**
 * Read the catalog, and what this workspace has already connected.
 *
 * @returns The entries and the existing connections, or the sentence to show instead. The
 *   listing failing on its own does not fail the reading — see this file's header.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function readCatalog(): Promise<CatalogReading> {
  try {
    const [catalog, existing] = await Promise.all([providers.catalog(), existingConnections()]);

    return { ok: true, entries: catalog.kinds, existing };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: CATALOG_UNAVAILABLE };
  }
}

/**
 * The workspace's connections, slimmed to what the duplicate warning compares.
 *
 * @returns The connections, or none when the listing could not be read — an `ApiError` here
 *   is absorbed, because a warning with nothing to compare against is a dialog that opens,
 *   and a dialog that would not is worse than a warning that did not fire.
 * @throws Whatever is not an `ApiError`.
 */
async function existingConnections(): Promise<readonly ExistingConnection[]> {
  try {
    const page = await providers.list();

    return page.items.map(({ id, kind, displayName, baseUrl }) => ({
      id,
      kind,
      displayName,
      baseUrl,
    }));
  } catch (error) {
    if (!isApiError(error)) throw error;

    return [];
  }
}

/**
 * Connect a provider.
 *
 * @param body The kind, the heading, and the settings keyed by the catalog's field names —
 *   composed by the dialog from `catalog.ts`'s `configOf`, and forwarded as it is.
 * @returns The stored connection's id and heading, or the service's refusal. **A refusal
 *   means nothing was stored** — the service asks the provider before it writes, and the
 *   dialog's job is to say so and keep the form open.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function addProvider(body: ProviderConnectionCreate): Promise<AddOutcome> {
  try {
    const connection = await providers.add(body);

    return { ok: true, connection: { id: connection.id, displayName: connection.displayName } };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      refusal: { code: error.code, message: error.message, details: error.details },
    };
  }
}
