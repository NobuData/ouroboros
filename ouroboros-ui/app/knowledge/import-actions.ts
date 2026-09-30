"use server";

/**
 * The server hops for the **Import CLAUDE.md / .cursorrules** sheet
 * (BG.1, [#417](https://github.com/NobuData/ouroboros/issues/417)) — the two calls its Client
 * Component cannot make itself.
 *
 * `app/knowledge/create-actions.ts` states the rule: the browser cannot reach REST, so a Client
 * Component that needs the API calls a Server Action that calls it.
 *
 * ### Two actions, because the contract has two operations
 *
 * The preview writes nothing and the apply writes exactly the preview, checked by fingerprint. A
 * single action that previewed and applied in one hop would be the flow the issue warns against —
 * forty fact candidates without warning — so the sheet calls the first, shows the reader what it
 * said, and calls the second only on **Apply**.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in the call and no person.** The import belongs to the workspace the
 *   caller's own session is acting in, resolved by `ouroboros-rest` from the cookie.
 * - **The role gate is the service's** — `owner` or `admin`. The head does not draw the action for
 *   anyone else, but that is presentation; a member who reaches either action anyway gets the
 *   service's `403` and writes nothing.
 * - **What is sent is what the sheet composed**, and the service validates it.
 *
 * A refusal comes back as a value, not a throw, so the sheet stays open over the page. The one
 * throw that must travel is Next.js's redirect signal. A `"use server"` module may export only
 * async functions, so the sentences live in `app/knowledge/import.ts`.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import { isApiError } from "@/app/api/errors";
import {
  type ApplyRuleImportBody,
  type PreviewRuleImportBody,
  type RuleImportPreview,
  type RuleImportResult,
  knowledgeImport,
} from "@/app/api/knowledge-import";

/** What one call produced: the service's answer, or its refusal as a value. */
export type ImportOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: ErrorEnvelope };

/**
 * Keep the service's refusal as a value, and let everything else travel.
 *
 * @param call The call.
 * @returns Its answer, or the envelope.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
async function outcome<T>(call: () => Promise<T>): Promise<ImportOutcome<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      refusal: { code: error.code, message: error.message, details: error.details },
    };
  }
}

/**
 * What importing a repository's rules files would create. Writes nothing.
 *
 * @param body The repository.
 * @returns The preview, or the service's refusal.
 */
export async function previewImport(body: PreviewRuleImportBody): Promise<ImportOutcome<RuleImportPreview>> {
  return outcome(() => knowledgeImport.preview(body));
}

/**
 * Create exactly what a preview showed.
 *
 * @param body The repository and the preview's fingerprint.
 * @returns What was written, or the service's refusal — which means nothing was written.
 */
export async function applyImport(body: ApplyRuleImportBody): Promise<ImportOutcome<RuleImportResult>> {
  return outcome(() => knowledgeImport.apply(body));
}
