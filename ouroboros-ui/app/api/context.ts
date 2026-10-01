/**
 * Context assembly — *what would be injected*, through `ouroboros-rest`
 * (BF.5, [#414](https://github.com/NobuData/ouroboros/issues/414); drawn by BG.5,
 * [#421](https://github.com/NobuData/ouroboros/issues/421)).
 *
 * ### The preview is the assembly, not a description of it
 *
 * Decision **K8**: closest scope wins on a name conflict (workflow beats repo beats org), a
 * `required` skill always holds its name, drafts and unconfirmed facts never appear. That is
 * resolved once, in the service, and `POST /api/v1/knowledge/context/preview` answers the same
 * manifest a consumer would be handed for the same scope — byte for byte — so what mockup 14's
 * scope card shows a reader is what a run would carry, and not this client's opinion of it.
 *
 * The answer names what went in (`skillVersions`, `facts`, `estTokens` against `budgetTokens`)
 * **and what did not, and why**: `trimmed` for every entry the budget or the consumer's fact cap
 * dropped, `excluded` for every skill resolution left out — switched off, or shadowed by a closer
 * or a required one. Nothing is dropped silently, which is the whole value of looking.
 *
 * ### The workspace is the session's
 *
 * No workspace in this path and no `X-Ouro-Tenant` sent (`app/api/server.ts` says why). It writes
 * nothing and records nothing, so every member may ask, `viewer` included.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** Who a manifest is assembled for — it decides what the manifest holds, and its budget. */
export type ContextConsumer = components["schemas"]["ContextConsumer"];

/** What a preview asks: the consumer, and optionally a repository and a workflow. */
export type PreviewContextBody = components["schemas"]["PreviewContextBody"];

/** What would be injected for one scope and consumer, and what would not and why. */
export type ContextManifest = components["schemas"]["ContextManifest"];

/** One resolved skill, at the version in force. */
export type ManifestSkill = components["schemas"]["ManifestSkill"];

/** One confirmed fact in scope. */
export type ManifestFact = components["schemas"]["ManifestFact"];

/** One entry the trim dropped. */
export type TrimmedEntry = components["schemas"]["TrimmedEntry"];

/** One skill resolution left out. */
export type ExcludedSkill = components["schemas"]["ExcludedSkill"];

/** Context assembly, as `ouroboros-rest` serves it. */
export const context = {
  /**
   * The manifest a consumer would receive for a scope. Writes and records nothing.
   *
   * @param body The consumer and the scope, forwarded as they are. An omitted `repo` is a
   *   workspace-wide manifest; an omitted `workflow` puts no workflow in scope.
   * @param client The client to call through. Defaults to the server-side one; tests pass one
   *   over a stub `fetch`.
   * @returns The manifest. A scope nothing resolves in answers an empty one — not a failure.
   * @throws {ApiError} `404 context_workflow_not_found` for a workflow this workspace does not
   *   have, `422 validation_failed` for a malformed body.
   */
  async preview(body: PreviewContextBody, client: ApiClient = api()): Promise<ContextManifest> {
    return unwrap(await client.POST("/api/v1/knowledge/context/preview", { body }));
  },
};
