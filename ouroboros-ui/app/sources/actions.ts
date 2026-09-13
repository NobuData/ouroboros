"use server";

/**
 * The server hops for the ticket-sources page
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)) — the calls its Client
 * Components cannot make themselves.
 *
 * `app/api/server.ts` states the rule this exists under, and `app/providers/add-actions.ts`
 * is the same seam for the page beside it: the browser cannot reach REST — `OURO_REST_URL`
 * has no `NEXT_PUBLIC_` prefix and the session cookie is `HttpOnly` — so a Client Component
 * that needs something from the API calls a Server Action that calls it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in any call and no person.** A source belongs to *the workspace
 *   the caller's own session is acting in*, resolved by `ouroboros-rest` from the cookie this
 *   request carries. There is nothing to forge.
 * - **The role gate is the service's, not this module's** — `owner` or `admin`, and nobody
 *   else. The page draws a member's controls inert, but that is *presentation*: a check made
 *   in the browser is a check anybody can skip, so the one that decides is behind the API,
 *   and a member who reaches an action anyway gets the service's `403` and writes nothing.
 * - **What is sent is what was typed.** The schema check and the split of the credential
 *   from the settings are the service's, and the answer is the service's own envelope so the
 *   dialog can put the provider's sentence under the field it is about.
 *
 * ### Failure posture: a value, not a throw
 *
 * A refusal comes back as a value. Every action here is pressed *on* a page the reader is
 * still entitled to be on, and a rejected action would replace it with an error screen —
 * which is the wrong outcome for "the tracker refused the token". The one throw that must
 * travel is Next.js's redirect signal, for a session that expired since the page rendered.
 *
 * **Every value this module needs is imported rather than declared.** A `"use server"`
 * module may export nothing but async functions, so the result types and the sentences live
 * in `app/sources/catalog.ts` and `app/sources/view.ts`.
 */

import { type ApiError, isApiError } from "@/app/api/errors";
import {
  type TicketSource,
  type TicketSourceCatalogEntry,
  type TicketSourceConfigSubmission,
  type TicketSourceCreate,
  type TicketSourceStatusReport,
  type TicketSourceTest,
  sources,
} from "@/app/api/sources";

import {
  type ApiRefusal,
  CATALOG_UNAVAILABLE,
  CREDENTIALS_UNSUPPORTED,
  CREDENTIALS_UNSUPPORTED_CODE,
  FORBIDDEN_CODE,
  NOT_FOUND_CODE,
} from "./refusals";
import {
  CONFIGURE_READ_ONLY,
  PAUSE_FAILED,
  PAUSE_READ_ONLY,
  SOURCE_GONE,
  SYNC_FAILED,
  SYNC_READ_ONLY,
  SYNC_REFUSED_PAUSED,
  SYNC_RUNNING,
  TEST_FAILED,
  TEST_READ_ONLY,
  syncTooSoon,
} from "./view";

/** What one open of the add dialog read. */
export type CatalogReading =
  | { readonly ok: true; readonly entries: readonly TicketSourceCatalogEntry[] }
  | { readonly ok: false; readonly reason: string };

/** What one add produced. */
export type AddOutcome =
  | { readonly ok: true; readonly source: Pick<TicketSource, "id" | "displayName"> }
  | { readonly ok: false; readonly refusal: ApiRefusal };

/** What a settings edit or a credential store produced. */
export type ConfigureOutcome =
  | { readonly ok: true; readonly source: TicketSource }
  | { readonly ok: false; readonly refusal: ApiRefusal };

/** What a test produced: the provider's answer, or why the request could not run. */
export type TestOutcome =
  | { readonly ok: true; readonly result: TicketSourceTest }
  | { readonly ok: false; readonly reason: string };

/** What a sync trigger produced: the status at acceptance, or why not. */
export type SyncOutcome =
  | { readonly ok: true; readonly status: TicketSourceStatusReport }
  | { readonly ok: false; readonly reason: string };

/** One read of a source's status, for the row that is watching a sync land. */
export type StatusReading =
  | { readonly ok: true; readonly status: TicketSourceStatusReport }
  | { readonly ok: false; readonly reason: string };

/** What a pause or resume produced: the position the service now holds, or why not. */
export type StatusOutcome =
  | { readonly ok: true; readonly status: TicketSource["status"] }
  | { readonly ok: false; readonly reason: string };

/**
 * Read the catalog.
 *
 * @returns The entries, or the sentence to show instead.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function readSourceCatalog(): Promise<CatalogReading> {
  try {
    return { ok: true, entries: (await sources.catalog()).kinds };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: CATALOG_UNAVAILABLE };
  }
}

/**
 * Add a source.
 *
 * @param body The kind, the heading, and the settings keyed by the catalog's field names —
 *   composed by the dialog from `catalog.ts`'s `configOf`, and forwarded as it is.
 * @returns The stored source's id and heading, or the service's refusal. **A refusal means
 *   nothing was stored.**
 * @throws Whatever is not an `ApiError`.
 */
export async function addSource(body: TicketSourceCreate): Promise<AddOutcome> {
  try {
    const source = await sources.add(body);

    return { ok: true, source: { id: source.id, displayName: source.displayName } };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, refusal: refusalOf(error) };
  }
}

/**
 * Replace a source's settings.
 *
 * @param id The source.
 * @param config The settings, whole.
 * @returns The source as stored, or the refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function updateSourceConfig(
  id: string,
  config: TicketSourceConfigSubmission,
): Promise<ConfigureOutcome> {
  try {
    return { ok: true, source: await sources.update(id, { config }) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, refusal: refusalOf(error) };
  }
}

/**
 * Store a source's credential.
 *
 * @param id The source.
 * @param secret The credential, exactly as typed.
 * @returns The source with a masked echo, or the refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function setSourceCredentials(id: string, secret: string): Promise<ConfigureOutcome> {
  try {
    return { ok: true, source: await sources.setCredentials(id, secret) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    const refusal = refusalOf(error);

    return {
      ok: false,
      refusal:
        error.code === CREDENTIALS_UNSUPPORTED_CODE
          ? { ...refusal, message: CREDENTIALS_UNSUPPORTED }
          : error.code === FORBIDDEN_CODE
            ? { ...refusal, message: CONFIGURE_READ_ONLY }
            : refusal,
    };
  }
}

/**
 * Ask the provider whether a source works.
 *
 * @param id The source.
 * @returns What the provider found — a refused token is an `ok: true` with a failed result —
 *   or why the request itself could not run.
 * @throws Whatever is not an `ApiError`.
 */
export async function testSource(id: string): Promise<TestOutcome> {
  try {
    return { ok: true, result: await sources.test(id) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: refusalSentence(error, TEST_READ_ONLY, TEST_FAILED) };
  }
}

/**
 * Sync a source now.
 *
 * @param id The source.
 * @returns The status at acceptance, or the service's reason for refusing — the three
 *   `409`s each get their own sentence, because the reader's next move differs.
 * @throws Whatever is not an `ApiError`.
 */
export async function syncSource(id: string): Promise<SyncOutcome> {
  try {
    return { ok: true, status: await sources.sync(id) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    if (error.code === "ticket_source_paused") return { ok: false, reason: SYNC_REFUSED_PAUSED };
    if (error.code === "ticket_source_sync_running") return { ok: false, reason: SYNC_RUNNING };
    if (error.code === "ticket_source_sync_too_soon") {
      const wait = error.details.retryAfterSeconds;

      return { ok: false, reason: syncTooSoon(typeof wait === "number" ? wait : 30) };
    }

    return { ok: false, reason: refusalSentence(error, SYNC_READ_ONLY, SYNC_FAILED) };
  }
}

/**
 * Read a source's status — what the row polls while a sync it started is landing.
 *
 * @param id The source.
 * @returns The report, or why it could not be read.
 * @throws Whatever is not an `ApiError`.
 */
export async function readSourceStatus(id: string): Promise<StatusReading> {
  try {
    return { ok: true, status: await sources.status(id) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: error.code === NOT_FOUND_CODE ? SOURCE_GONE : SYNC_FAILED };
  }
}

/**
 * Pause or resume a source.
 *
 * @param id The source.
 * @param status The position to move to — the state to *be in*, not a request to invert.
 * @returns The position the service now holds, or why not.
 * @throws Whatever is not an `ApiError`.
 */
export async function setSourceStatus(
  id: string,
  status: "active" | "paused",
): Promise<StatusOutcome> {
  try {
    return { ok: true, status: (await sources.update(id, { status })).status };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: refusalSentence(error, PAUSE_READ_ONLY, PAUSE_FAILED) };
  }
}

/**
 * The envelope, as a value a dialog can turn into a sentence.
 *
 * @param error The failure.
 * @returns Its code, message and details.
 */
function refusalOf(error: ApiError): ApiRefusal {
  return { code: error.code, message: error.message, details: error.details };
}

/**
 * The sentence for a refusal of a row action.
 *
 * @param error The failure.
 * @param readOnly What to say for a `403`.
 * @param failed What to say for anything else.
 * @returns The sentence.
 */
function refusalSentence(error: ApiError, readOnly: string, failed: string): string {
  if (error.code === FORBIDDEN_CODE) return readOnly;
  if (error.code === NOT_FOUND_CODE) return SOURCE_GONE;

  return failed;
}
