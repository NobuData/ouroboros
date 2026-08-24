/**
 * `credential.lease_granted` — the trail every lease leaves.
 *
 * AD.3's ([#224](https://github.com/NobuData/ouroboros/issues/224)) fourth acceptance
 * criterion is that *every lease grant writes an audit event*, and AD.4
 * ([#225](https://github.com/NobuData/ouroboros/issues/225)) is what gave this installation
 * an `audit_events` table to write it into. This file's header used to say *the event is
 * real; its sink is interim* — the interim being the service log, because the table did not
 * exist yet — and it predicted exactly this change: **the method body became an insert, and
 * every caller, every field and the event's name stayed as they were.**
 *
 * ---------------------------------------------------------------------------
 * **A grant, and only a grant.** A refused lease is still not an event, and AD.4 does not
 * make it one: its *including the failure paths* criterion is about the AD.2 credential
 * operations, each of which is somebody acting on a stored key. A lease refusal is a worker
 * asking for a provider kind policy does not lease (decision **P3**), which is a fact about a
 * deployment's configuration rather than about a credential — and it is already a log line
 * from the guard or the error filter. Inventing `credential.lease_refused` here would be
 * putting a name into AD.4's vocabulary from outside it, which is the thing this file has
 * declined to do since it was written.
 *
 * **The event has no actor**, and that is the one way it differs from every other row in the
 * trail. A worker authenticates with a service key rather than as a person, so `actor_id` is
 * null — naming a user there would be inventing one. V022 makes the column nullable for
 * exactly this, and `ouroboros-db`'s seed carries one such row so that the sheet is drawn
 * against a history containing the case.
 *
 * **Nothing in the record is secret, and that is checkable rather than promised.** A lease
 * carries an address; the whole of decision **P3** is that there is no key on this path to
 * leak into a row. `lease.audit.spec.ts` asserts the payload against the vault's redaction
 * vocabulary, and `no-secret-responses.mjs` refuses a field that would change that.
 */

import { Injectable } from "@nestjs/common";

import { LEASE_GRANTED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import type { LocalProviderKind } from "./providers";

export { LEASE_GRANTED_EVENT } from "../audit/audit.events";

/**
 * What the trail records a lease's event *about* — the run it was scoped to.
 *
 * A lease is the one event in this vocabulary whose subject is **not** a provider connection,
 * and that is the right subject rather than a shortcut: the question somebody brings to a
 * lease grant is *what was this run allowed to reach*, and V022's subject columns are
 * deliberately non-referential precisely so an event can name a row in a table the audit
 * schema knows nothing about.
 */
export const LEASE_SUBJECT = "run";

/** One grant, as the trail records it. */
export interface LeaseGrantedEvent {
  /** The lease's own id, so a worker's answer and this line can be matched up. */
  readonly id: string;
  /** The run the lease is scoped to. */
  readonly run: string;
  /** The workspace that run belongs to — resolved here, never taken from the request. */
  readonly organizationId: string;
  /** Which provider kind was granted. */
  readonly provider: LocalProviderKind;
  /** The address that was handed over. Recorded because it is exactly what was given. */
  readonly baseUrl: string;
  /** When the grant happened. */
  readonly grantedAt: Date;
  /** When it stops being current. */
  readonly expiresAt: Date;
}

@Injectable()
export class LeaseAudit {
  /**
   * @param audit - The trail. AD.4's `audit_events`, through the one service that writes it.
   */
  constructor(private readonly audit: AuditService) {}

  /**
   * Record that a worker was told how to reach a local provider.
   *
   * Called on every grant and only on a grant — see this file's header.
   *
   * **Awaited by the caller before the lease is answered.** A worker holding an address
   * nothing recorded is the one outcome this criterion exists to prevent, and unlike a
   * rotation there is nothing here that a failure would have to un-happen: the lease has not
   * left the process yet. See `audit.service.ts` on why a failure to record propagates.
   *
   * @param event - The grant, fully assembled by `lease.ts`.
   * @returns When the event is stored.
   */
  async granted(event: LeaseGrantedEvent): Promise<void> {
    await this.audit.record({
      organizationId: event.organizationId,
      // Null, and never a person: see this file's header. A worker is not somebody.
      actorId: null,
      action: LEASE_GRANTED_EVENT,
      subjectType: LEASE_SUBJECT,
      subjectId: event.run,
      at: event.grantedAt,
      detail: {
        lease: event.id,
        provider: event.provider,
        // The address is recorded because it is exactly what was handed over, and a trail of
        // *a worker was given an address* that does not say which one answers half of the
        // question. It is a host on the deployment's own network — decision P3 is that there
        // is no key on this path at all — so there is nothing here to redact.
        address: event.baseUrl,
        expires_at: event.expiresAt.toISOString(),
      },
    });
  }
}
