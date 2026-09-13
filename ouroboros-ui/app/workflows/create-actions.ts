"use server";

/**
 * The server hop for the **+ New workflow** dialog
 * (S.1, [#147](https://github.com/NobuData/ouroboros/issues/147)) — the one call its Client
 * Component cannot make itself.
 *
 * `app/api/server.ts` states the rule this exists under, and `app/registry/create-actions.ts`
 * is the same seam for mockup 21's create dialog: the browser cannot reach REST —
 * `OURO_REST_URL` has no `NEXT_PUBLIC_` prefix and the session cookie is `HttpOnly` — so a
 * Client Component that needs something from the API calls a Server Action that calls it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * The paragraph every action module in this product carries:
 *
 * - **There is no workspace in the call and no person.** A workflow belongs to *the workspace
 *   the caller's own session is acting in*, resolved by `ouroboros-rest` from the cookie this
 *   request carries. There is nothing to forge and no way to point a create at somebody else's
 *   workspace.
 * - **The role gate is the service's, not this module's** — `owner` or `admin`, and nobody
 *   else (P.3). The rail draws the tile inert for a member, but that is *presentation*: a
 *   check made in the browser is a check anybody can skip, so the one that decides is behind
 *   the API, and a member who reaches {@link createWorkflow} anyway gets the service's `403`
 *   and writes nothing.
 * - **What is sent is what the dialog composed.** The body is forwarded as it is; the name's
 *   length, the slug's shape and its uniqueness are all the service's checks, and the answer
 *   is the service's own envelope so the dialog can put each refusal under the field it is
 *   about.
 *
 * ### Failure posture: a value, not a throw
 *
 * A refusal comes back as a value. The dialog is opened *over* a page the reader is still
 * entitled to be on, and a rejected action would replace it with an error screen — which is
 * the wrong outcome for "that slug is taken". The one throw that must travel is Next.js's
 * redirect signal, for a session that expired since the page rendered.
 *
 * **Every value this module needs is imported rather than declared.** A `"use server"` module
 * may export nothing but async functions — a `const` beside them is a build error — so the
 * sentences live in `app/workflows/create.ts` and only types (which are erased) are declared
 * here.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import { isApiError } from "@/app/api/errors";
import { type CreateWorkflowRequest, workflows } from "@/app/api/workflows";

/** What one create produced. */
export type CreateOutcome =
  /** The workflow, as stored — its slug is where the page then goes. */
  | { readonly ok: true; readonly slug: string }
  /** The service's refusal, for `create.ts`'s `createFailure` to turn into sentences. */
  | { readonly ok: false; readonly refusal: ErrorEnvelope };

/**
 * Create one workflow.
 *
 * @param body The name and the slug, composed by the dialog from `create.ts`'s `createBody`
 *   and forwarded as it is.
 * @returns The stored workflow's slug, or the service's refusal. **A refusal means nothing
 *   was created** — one `POST` writes the workflow and its draft inside one transaction, so
 *   there is no partial state to describe and the dialog says so.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function createWorkflow(body: CreateWorkflowRequest): Promise<CreateOutcome> {
  try {
    const created = await workflows.create(body);

    return { ok: true, slug: created.slug };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      refusal: { code: error.code, message: error.message, details: error.details },
    };
  }
}
