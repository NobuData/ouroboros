"use server";

/**
 * The server hops for the **import wizard**
 * ([#594](https://github.com/NobuData/ouroboros/issues/594)) — the two calls its Client
 * Component cannot make itself.
 *
 * `app/api/server.ts` states the rule this exists under, and `app/registry/create-actions.ts`
 * is the same seam for the dialog beside it: the browser cannot reach REST, so a Client
 * Component that needs the API calls a Server Action that calls it.
 *
 * ### The candidates are read when the wizard opens, and read again every time
 *
 * Not with the page — the wizard is behind a menu row most visits never press, and a workspace
 * with five connections would otherwise pay for five discovery reads to draw a table about
 * none of them. Reading on **every** open is the other half of the ticket's idempotency
 * criterion: an operator who imports two models and reopens the wizard sees those two marked
 * as already-aliased, because the annotation is recomputed against the workspace's aliases
 * rather than remembered from the last open.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in either call and no person.** Both are scoped to the workspace
 *   the caller's own session is acting in, resolved by `ouroboros-rest` from the cookie this
 *   request carries; a `connectionId` from another workspace is the service's `404`.
 * - **The role gate is the service's** — `owner` or `admin`, for **both** calls. Unlike the
 *   alias list, which any member may read, the candidate list is the first half of a write: a
 *   form pre-filled with the names that write would use. The menu is drawn inert for a member,
 *   but that is presentation; a member who reaches either of these gets the service's `403`.
 * - **What is sent is what was ticked.** {@link importAliases} forwards the body the wizard
 *   composed — one connection and the rows under it — and the service's checks are the ones
 *   that decide.
 *
 * ### Failure posture: a value, not a throw
 *
 * A refusal comes back as a value, because the wizard is opened over a page the reader is
 * still entitled to be on. The one throw that must travel is Next.js's redirect signal, for a
 * session that expired since the page rendered.
 *
 * ### All of them, or none of them
 *
 * `POST /registry/import` is one transaction, and that is what makes an itemised `422`
 * actionable: the wizard puts each message back on its row and can promise that **nothing was
 * created**, rather than leaving somebody to work out which seven of eight landed.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import { isApiError } from "@/app/api/errors";
import {
  type ImportCandidate,
  type ImportEmpty,
  type ImportModelAliases,
  type ImportResult,
  registry,
} from "@/app/api/registry";

import { CANDIDATES_FAILED } from "./wizard";

/**
 * **Every value this module needs is imported rather than declared** — a `"use server"` module
 * may export nothing but async functions, so the sentences live in `app/registry/wizard.ts`
 * with the rest of the wizard's decisions.
 */

/** What one read of a connection's candidates produced. */
export type CandidatesReading =
  /**
   * The candidates, ordered by model id, and `empty` — non-null **exactly** when there are
   * none. Both are the service's, and the wizard branches on `empty` rather than on the
   * length, so *nothing discovered* keeps the connection's name and the link that fixes it.
   */
  | {
      readonly ok: true;
      readonly candidates: readonly ImportCandidate[];
      readonly empty: ImportEmpty | null;
    }
  /** Why not — the product's sentence, and the service's own after it. */
  | { readonly ok: false; readonly reason: string };

/** What one import produced. */
export type ImportOutcome =
  /** What the batch did — what it created, and what it passed over for already being named. */
  | { readonly ok: true; readonly result: ImportResult }
  /** The service's refusal, for `wizard.ts`'s `importFailure` to map back onto the rows. */
  | { readonly ok: false; readonly refusal: ErrorEnvelope };

/**
 * What one connection has to import, annotated.
 *
 * @param connectionId The connection the menu row named.
 * @returns The candidates and the empty state, or the sentence to draw instead. **A connection
 *   that has reported nothing is a success**, answered with an empty list and a non-null
 *   `empty`; a wizard that treated it as a failure would say *could not be read* about a
 *   connection that answered perfectly well.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function readCandidates(connectionId: string): Promise<CandidatesReading> {
  try {
    const page = await registry.candidates(connectionId);

    return { ok: true, candidates: page.candidates, empty: page.empty };
  } catch (error) {
    if (!isApiError(error)) throw error;

    // The service's own sentence after the product's, rather than instead of it: a `403` and a
    // `502` are the same shape here and a reader is owed both what happened and what it means.
    return { ok: false, reason: `${CANDIDATES_FAILED} ${error.message}` };
  }
}

/**
 * Create the ticked rows, as one transaction.
 *
 * @param body The connection, and the items — each a model discovery reported and the name to
 *   give it. Composed by the wizard from `wizard.ts`'s `importRequest`.
 * @returns What was created and what was skipped, or the service's refusal. **A refusal means
 *   nothing was created**, and the refusal names every offending item rather than the first.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function importAliases(body: ImportModelAliases): Promise<ImportOutcome> {
  try {
    return { ok: true, result: await registry.importAliases(body) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      refusal: { code: error.code, message: error.message, details: error.details },
    };
  }
}
