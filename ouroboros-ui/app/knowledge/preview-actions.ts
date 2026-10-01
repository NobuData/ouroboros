"use server";

/**
 * The server hop for the manifest preview
 * (BG.5, [#421](https://github.com/NobuData/ouroboros/issues/421)) — the one call its Client
 * Component cannot make itself: asking context assembly what a consumer would be handed.
 *
 * `app/knowledge/facts-actions.ts` is the same seam for the learned-facts card and states the
 * rule: the browser cannot reach REST, so a Client Component that needs the API calls a Server
 * Action that calls it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in the call and no person.** The manifest is assembled for the
 *   workspace the caller's own session is acting in, resolved by `ouroboros-rest` from the cookie.
 * - **It writes nothing.** The preview records no injection and changes no skill, so every member
 *   may make it, `viewer` included; the gate that there is — membership — is the service's.
 * - **Only the scope and the consumer travel.** {@link previewContext} forwards a repository, a
 *   workflow and a consumer and nothing else: no overrides and no budget, so what comes back is
 *   what a consumer with no delta would receive, which is what the page promises to show.
 *
 * A refusal comes back as a value, not a throw, so the dialog can show it. The one throw that
 * must travel is Next.js's redirect signal. A `"use server"` module may export only async
 * functions, so the sentences live in `app/knowledge/preview.ts`.
 */

import { type ContextConsumer, type ContextManifest, context } from "@/app/api/context";
import type { ErrorEnvelope } from "@/app/api/errors";
import { isApiError } from "@/app/api/errors";

/** What the call produced: the manifest, or the service's refusal as a value. */
export type PreviewOutcome =
  | { readonly ok: true; readonly value: ContextManifest }
  | { readonly ok: false; readonly refusal: ErrorEnvelope };

/**
 * Ask what would be injected for one scope and one consumer.
 *
 * @param consumer Who the manifest is for.
 * @param repo The repository in scope, `owner/name`, or `null` for a workspace-wide manifest.
 * @param workflow The workflow in scope, by slug, or `null` for none.
 * @returns The manifest, or the service's refusal — `context_workflow_not_found` for a workflow
 *   the workspace no longer has.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function previewContext(
  consumer: ContextConsumer,
  repo: string | null,
  workflow: string | null,
): Promise<PreviewOutcome> {
  try {
    return {
      ok: true,
      value: await context.preview({
        consumer,
        ...(repo === null ? {} : { repo }),
        ...(workflow === null ? {} : { workflow }),
      }),
    };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      refusal: { code: error.code, message: error.message, details: error.details },
    };
  }
}
