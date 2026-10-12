/**
 * The workflow copilot's promote gate and its conversation — what mockup 20's page head reads
 * and writes through `ouroboros-rest` (CE.1,
 * [#565](https://github.com/NobuData/ouroboros/issues/565)).
 *
 * Four operations, all beneath one workflow:
 *
 * - `GET /api/v1/workflows/{id}/copilot/promotion` — what **Promote draft → security-patch v1**
 *   would publish: the version it would make, the draft it would freeze, the guards the
 *   conversation set and where each is enforced, and the references that resolve to nothing yet
 *   (decision **W7**).
 * - `GET /api/v1/workflows/{id}/copilot/conversation` — the conversation, for a surface
 *   switching back to it (decision **W9**). It answers the active session, or — read-only — the
 *   most recently closed one; a workflow that never had one answers `404`
 *   {@link COPILOT_SESSION_NOT_FOUND}, which {@link workflowCopilot.conversation} hands back as
 *   `null`, because *no conversation yet* is a state of the page and not a failed read.
 * - `GET /api/v1/workflows/{id}/copilot/readiness` — whether a message sent now could be
 *   answered (CE.2, #566): the gateway, the route, and the dry run in the way.
 * - `POST /api/v1/workflows/{id}/copilot/discard` — **Discard draft**: the draft is thrown away
 *   and the session closed as `discarded`, its transcript kept.
 *
 * Publishing itself is not here: promoting is the studio's one publish path,
 * `workflows.publish` (`app/api/workflows.ts`), which since CE.1 also closes the active
 * conversation as `promoted`.
 *
 * ### The shapes are the service's
 *
 * Every type here is an alias of `app/api/schema.d.ts`, generated from the service's OpenAPI
 * document by `yarn api:sync` — the promotion and discard shapes since CE.1, the conversation's
 * since CC.1, the readiness since CE.2.
 *
 * ### The workspace is the session's
 *
 * As everywhere under `/api/v1/workflows`: no workspace in these paths, no `X-Ouro-Tenant` from
 * this client. Any member may read the promotion and the conversation, viewers included; the
 * discard is `owner` or `admin`, and the service is what enforces it.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import { isApiError } from "@/app/api/errors";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** The whole conversation: its session, its messages, and the draft as the conversation sees it. */
export type CopilotConversation = components["schemas"]["CopilotConversation"];

/** One message of the conversation. */
export type CopilotMessage = components["schemas"]["CopilotMessage"];

/** One conversation, bound to the workflow whose shared draft it edits. */
export type CopilotSession = components["schemas"]["CopilotSession"];

/**
 * One guard the published version carries — *never auto-merge*, *spend cap $5.00/run*.
 *
 * `enforcement` `dry_run_only` is a guard the service records and checks in a dry run and
 * **does not enforce on real runs yet** — it must never be drawn as protection.
 */
export type CopilotGuard = components["schemas"]["CopilotPromotionGuard"];

/**
 * A reference in the draft that resolves to nothing yet (decision W7), and whether the
 * validation policy lets a publish through with it (`blocking`).
 */
export type CopilotReference = components["schemas"]["CopilotPromotionReference"];

/** What **Promote draft** would publish, and whether it can. */
export type CopilotPromotion = components["schemas"]["CopilotPromotion"];

/** What a discard did: whether there was a draft, and the conversation as it now stands. */
export type CopilotDiscardResult = components["schemas"]["CopilotDiscard"];

/** One chip row of a reply — an `ask_user` question, and its answer once given. */
export type CopilotChoice = components["schemas"]["CopilotChoice"];

/** How a reply came to be: the operations it proposed, the reads it made, the dry runs it suggested. */
export type CopilotToolTrace = components["schemas"]["CopilotToolTrace"];

/** One operation a reply proposed, and what became of it. */
export type CopilotTraceOperation = components["schemas"]["CopilotTraceOperation"];

/** A reference in the draft that resolves to nothing yet (decision W7). */
export type CopilotWarning = components["schemas"]["CopilotWarning"];

/** The shared draft as the conversation sees it. */
export type CopilotDraft = components["schemas"]["CopilotDraft"];

/** One server-sent event of an exchange — the `data:` of an event whose `event:` is its `kind`. */
export type CopilotStreamEvent = components["schemas"]["CopilotStreamEvent"];

/**
 * Whether a message sent now could be answered (CE.2,
 * [#566](https://github.com/NobuData/ouroboros/issues/566)): the deployment's gateway, what
 * routing the next reply would find, and the workflow's dry run that has not ended.
 */
export type CopilotReadiness = components["schemas"]["CopilotReadiness"];

/** The code a `404` answers for a workflow that never had a conversation. */
export const COPILOT_SESSION_NOT_FOUND = "copilot_session_not_found";

/** The workflow copilot's promote gate and conversation, as `ouroboros-rest` serves them. */
export const workflowCopilot = {
  /**
   * What promoting this workflow's draft would publish, and whether it can be.
   *
   * @param id The workflow's id — the rail is what turns the URL's slug into one.
   * @param client The client to call through. Defaults to the server-side one; tests pass one
   *   over a stub `fetch`.
   * @returns The promotion summary.
   * @throws {ApiError} What the service answered — `404 workflow_not_found` for an id this
   *   workspace does not have.
   */
  async promotion(id: string, client: ApiClient = api()): Promise<CopilotPromotion> {
    return unwrap(
      await client.GET("/api/v1/workflows/{id}/copilot/promotion", { params: { path: { id } } }),
    );
  },

  /**
   * The workflow's conversation: the active one, else the most recently closed one, read-only.
   *
   * @param id The workflow's id.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The conversation, or `null` for a workflow that never had one — the service's
   *   `404` {@link COPILOT_SESSION_NOT_FOUND}, which is a state and not a failure.
   * @throws {ApiError} Every other refusal — `404 workflow_not_found` above all, which is a
   *   different fact from a workflow with no conversation and is not folded into `null`.
   */
  async conversation(id: string, client: ApiClient = api()): Promise<CopilotConversation | null> {
    try {
      return unwrap(
        await client.GET("/api/v1/workflows/{id}/copilot/conversation", { params: { path: { id } } }),
      );
    } catch (error) {
      if (isApiError(error) && error.code === COPILOT_SESSION_NOT_FOUND) return null;
      throw error;
    }
  },

  /**
   * Whether a message sent now could be answered: the deployment's gateway, the copilot's route,
   * and the workflow's open dry run.
   *
   * @param id The workflow's id.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The readiness as the service knows it — it asks no engine and no provider.
   * @throws {ApiError} What the service answered — `404 workflow_not_found`.
   */
  async readiness(id: string, client: ApiClient = api()): Promise<CopilotReadiness> {
    return unwrap(
      await client.GET("/api/v1/workflows/{id}/copilot/readiness", { params: { path: { id } } }),
    );
  },

  /**
   * Discard the draft and close the conversation, keeping its transcript — **Discard draft**.
   *
   * @param id The workflow's id.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns What was discarded, and the conversation as it now stands.
   * @throws {ApiError} What the service answered — `409 copilot_nothing_to_discard`,
   *   `409 dry_run_in_progress`, `403` for a member or a viewer, `404 workflow_not_found`.
   */
  async discard(id: string, client: ApiClient = api()): Promise<CopilotDiscardResult> {
    return unwrap(
      await client.POST("/api/v1/workflows/{id}/copilot/discard", { params: { path: { id } } }),
    );
  },
};
