/**
 * The audit trail — the one writer of `audit_events`, and the one reader of it.
 *
 * AD.4 ([#225](https://github.com/NobuData/ouroboros/issues/225)), roadmap decision **P5**.
 *
 * ```
 * record ─▶ context ─▶ append          the address comes from the request, not the caller
 * list   ─▶ org scope ─▶ filter ─▶ page   another workspace's history is unreachable
 * ```
 *
 * ---------------------------------------------------------------------------
 * **A failure to record is a failure of the operation, and that is the whole posture.**
 * {@link AuditService.record} awaits its insert and lets a failure propagate. Decision P5's
 * premise is that a credential operation with no record fails the page's own security
 * claim — so a reveal this service could not write down is a reveal it should not complete,
 * and the caller has to be told rather than the row quietly not existing.
 *
 * The window that argument has to survive is narrow by construction: `audit_events` is in the
 * same database as `provider_connections`, so *the trail is unavailable and the credential
 * store is fine* is not a state this deployment can easily be in. Where the database is down,
 * the operation was going to fail anyway.
 *
 * There is exactly one place that does **not** propagate, and it is not an exception to the
 * rule so much as the rule applied twice: recording the *failure* of an operation happens
 * inside that operation's `catch`, and an insert that threw there would replace the caller's
 * real error — a `422 provider_validation_failed` becoming an unexplained `500` — which
 * would lose the more useful of the two facts. `connection.audit.ts` is where that is handled
 * and where it is written down.
 *
 * ---------------------------------------------------------------------------
 * **Nothing here takes a credential.** {@link AuditRecord} has no field a plaintext, a mask
 * or an envelope could be passed in, so *no audit event ever contains secret material* is a
 * property the compiler enforces at every call site rather than a rule reviewers have to
 * remember. `audit.secrecy.spec.ts` closes the other half — that no *builder* composes one
 * out of the fields it does take — by greping the rows a full credential lifecycle writes.
 *
 * `ouroboros/no-secret-logging` is applied to this module for the same reason it is applied
 * to `provider-connections/` and `vault/`: see `eslint.config.mjs`.
 */

import { Injectable } from "@nestjs/common";

import type { NewAuditEvent } from "../db/schema";
import { pageOf, windowOf, type Page } from "../tenancy/pagination";
import { currentClientAddress } from "./audit.context";
import { auditDetail, type AuditRecord } from "./audit.events";
import { AuditRepository, type AuditFilter } from "./audit.repository";
import type { ListAuditQuery } from "./audit.dto";
import { auditEventResource, type AuditEventResource } from "./audit.resources";

@Injectable()
export class AuditService {
  /**
   * @param events - The two statements against `audit_events`. There is no third — see
   *   `audit.repository.ts`.
   */
  constructor(private readonly events: AuditRepository) {}

  /**
   * Append one event.
   *
   * **The address is read here rather than passed in**, from the `AsyncLocalStorage` store
   * `audit.middleware.ts` opened. That is deliberate: a caller that supplied its own address
   * would be a caller that could supply somebody else's, and the whole value of the column is
   * that it says where the request came from rather than what it claimed. See
   * `audit.context.ts` for what "came from" honestly means behind a proxy.
   *
   * @param event - What happened. Assembled by the domain that knows — `connection.audit.ts`
   *   for the credential lifecycle, `lease.audit.ts` for AD.3's grants.
   * @returns The event's id, so a caller can correlate its own answer with the trail.
   * @throws Whatever the insert threw. See this file's header on why that is not swallowed.
   */
  async record(event: AuditRecord): Promise<string> {
    const row: NewAuditEvent = {
      organization_id: event.organizationId,
      actor_id: event.actorId,
      action: event.action,
      subject_type: event.subjectType,
      subject_id: event.subjectId,
      ip: currentClientAddress() ?? null,
      detail: auditDetail(event.detail),
      occurred_at: event.at,
    };

    return this.events.append(row);
  }

  /**
   * One page of a workspace's trail, newest first.
   *
   * @param organizationId - The workspace, from the tenant context. Never from the request:
   *   there is no `{orgId}` in this path, and an event names who revealed which credential.
   * @param query - The filters and the window, already validated.
   * @returns The page, per the #31 convention.
   */
  async list(organizationId: string, query: ListAuditQuery): Promise<Page<AuditEventResource>> {
    const window = windowOf(query);
    const filter: AuditFilter = {
      subjectId: query.connectionId,
      actorId: query.actorId,
      action: query.action,
    };

    const { rows, total } = await this.events.page(organizationId, filter, window);

    return pageOf(rows.map(auditEventResource), total, window);
  }
}
