/**
 * The credential audit trail — what mockup 07's **Audit log** button reads from
 * `ouroboros-rest` ([#225](https://github.com/NobuData/ouroboros/issues/225)).
 *
 * One operation, and it is the whole of AD.4's surface on this side of the wire:
 * `GET /api/v1/providers/audit`, organization-scoped and filterable. The providers page's
 * own reads — the cards, their masks, their health — are AE.2's and AE.3's, and belong in a
 * module beside this one when they arrive, because they are one page's calls to one tag.
 *
 * What this adds over a raw call is what every resource file in this directory adds: a name,
 * the path written down once so a rename in the contract is a failed typecheck rather than a
 * `404` behind a button, and the body rather than the body-or-nothing.
 *
 * ### The workspace is the session's
 *
 * There is no workspace in this path and this client sends no `X-Ouro-Tenant`
 * (`app/api/server.ts` says why), so the trail is scoped to the session's active
 * organization. **Unlike the health strip, this is not a read for every member**: an event
 * says who revealed which credential, when, and from where, so the service refuses it to
 * anybody below `admin`. A `403` reaching this layer is a state to render, not a bug —
 * `app/providers/view.ts` carries the sentence.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/**
 * One thing that happened to this workspace's credentials, and who did it.
 *
 * **Every optional fact is `null` rather than a stand-in**, and the sheet is built on that:
 * `actorName` is absent for a lease grant, because a worker authenticates with a service key
 * and is not somebody; `subjectId` is absent for a refused add, because nothing was written;
 * `ip` is absent when the service could not honestly know one. None of the three has a
 * fallback here, and nothing in `app/providers/` supplies one either — an invented actor on
 * an event that had none would be the trail's first lie.
 */
export type AuditEvent = components["schemas"]["AuditEvent"];

/** One page of the trail, newest first. */
export type AuditEventPage = components["schemas"]["AuditEventPage"];

/**
 * What happened — the ten names the service writes.
 *
 * Named separately because the sheet maps every one of them to a sentence
 * (`app/providers/view.ts`), so an eleventh action added to the service is a build error in
 * the renderer rather than a row that prints a raw `provider.cap_changed` at somebody.
 */
export type AuditAction = AuditEvent["action"];

/** What a caller may narrow the trail by — the three questions AD.4 names. */
export interface AuditFilter {
  /** One connection. *What has been done to this key.* */
  readonly connectionId?: string;
  /** One person. *What has this person done.* */
  readonly actorId?: string;
  /** One action. *Who has revealed anything.* */
  readonly action?: AuditAction;
  /** How many rows. The service defaults to 25 and refuses more than 100. */
  readonly limit?: number;
}

/** The credential trail, as `ouroboros-rest` serves it. */
export const audit = {
  /**
   * One page of this workspace's credential trail, newest first.
   *
   * @param filter What to narrow by, and how many rows. Every field is optional; an empty
   *   filter is *the most recent events*, which is what the sheet asks for.
   * @param client The client to call through. Defaults to the server-side one; tests pass one
   *   over a stub `fetch`.
   * @returns The page. A workspace where nothing has happened yet answers an empty `items` —
   *   the sheet's empty state, not a failure.
   * @throws {ApiError} What the service answered, `403 forbidden` included. A `401` redirects
   *   to login before this rejects.
   */
  async events(filter: AuditFilter = {}, client: ApiClient = api()): Promise<AuditEventPage> {
    return unwrap(
      await client.GET("/api/v1/providers/audit", {
        // Only the fields the caller set. `openapi-fetch` serialises an explicit `undefined`
        // as nothing, but an object built with all four keys makes a query string's contents
        // depend on that behaviour rather than on this call.
        params: { query: { ...filter } },
      }),
    );
  },
};
