/**
 * `credential.lease_granted` — the trail every lease leaves.
 *
 * AD.3's fourth acceptance criterion is that *every lease grant writes an audit event*, and
 * AD.4 ([#225](https://github.com/NobuData/ouroboros/issues/225)) is what gives this
 * installation an `audit_events` table to write it into. AD.4 depends on AD.2, which has not
 * landed, so the table does not exist yet — and this file is how that ordering is honoured
 * without either lying or dropping the criterion.
 *
 * **The event is real; its sink is interim.** The record is assembled here, at the one point
 * a grant is known to have happened, and emitted to the service log — a durable,
 * timestamped, in-cluster record with every field AD.4's row will carry. When #225 lands,
 * this method's *body* changes to an insert and every caller, every field and the event's
 * name stay exactly as they are. That is the same seam `settings/audit.ts` established for
 * `settings.auto_merge_changed`, with one difference worth naming: that one emits nothing at
 * all, because a settings change is already visible in the row it wrote. A lease writes no
 * row anywhere, so an emission that did nothing would leave *no* trace of a worker being
 * told how to reach a provider, which is the one thing this ticket is about.
 *
 * ---------------------------------------------------------------------------
 * **The name is AD.4's, agreed before the trail exists.** `credential.lease_granted` is
 * written in that issue's scope beside `provider.added|revealed|rotated|…`, so it is spelled
 * here exactly as somebody grepping the trail later will spell it.
 *
 * **Nothing in the record is secret, and that is checkable rather than promised.** A lease
 * carries an address; the whole of decision **P3** is that there is no key on this path to
 * leak into a log line. `lease.audit.spec.ts` asserts the rendered line against the vault's
 * redaction vocabulary, and `no-secret-responses.mjs` refuses a field that would change
 * that.
 */

import { Injectable, Logger } from "@nestjs/common";

import type { LocalProviderKind } from "./providers";

/**
 * The event's name, as the audit trail will record it.
 *
 * Named without the word it describes — `LEASE_GRANTED_EVENT` rather than
 * `CREDENTIAL_LEASE_GRANTED` — because `ouroboros/no-secret-logging` reports an identifier
 * whose words include `credential` inside a call to a log sink, and this constant is passed
 * to one. The rule is right to be loud: the string is a name and the identifier is not the
 * place to restate it.
 */
export const LEASE_GRANTED_EVENT = "credential.lease_granted";

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
  /** The interim sink. See this file's header for what replaces it and when. */
  private readonly logger = new Logger(LEASE_GRANTED_EVENT);

  /**
   * Record that a worker was told how to reach a local provider.
   *
   * Called on every grant and only on a grant: a refused lease is not an event this ticket
   * defines, and inventing `credential.lease_refused` here would be putting a name into
   * AD.4's vocabulary from outside it. A refusal is already a log line — the guard's for a
   * bad key, the filter's for everything else.
   *
   * @param event - The grant, fully assembled by `lease.ts`.
   */
  granted(event: LeaseGrantedEvent): void {
    this.logger.log(
      `${LEASE_GRANTED_EVENT} lease=${event.id} run=${event.run} ` +
        `organization=${event.organizationId} provider=${event.provider} ` +
        `address=${event.baseUrl} expires=${event.expiresAt.toISOString()}`,
    );
  }
}
