/**
 * `provider.added`, `provider.revealed`, `provider.rotated`, the three settings events,
 * `provider.deleted` and `provider.tested` — the trail every lifecycle operation leaves.
 *
 * AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223)) established the seam; AD.4
 * ([#225](https://github.com/NobuData/ouroboros/issues/225)) closed it. This file's header
 * used to say *the events are real; their sink is interim*, and the interim was the service
 * log: `audit_events` did not exist, so each record was assembled at the one point the
 * operation was known to have happened and emitted where it would at least be durable and
 * timestamped. AD.4's V022 is the table it was always going to be written to, and the change
 * is exactly what that header predicted — **the method bodies became inserts, and every
 * caller, every field and every event name stayed as it was.**
 *
 * ---------------------------------------------------------------------------
 * **Every operation writes exactly one event, and a failure is still one.**
 *
 * That is AD.4's first acceptance criterion, and it is the sentence that changed most between
 * the two tickets. AD.2 recorded successes only, and argued for it: a refused reveal was
 * already a log line from the error filter, and inventing `provider.reveal_failed` would have
 * been putting a name into AD.4's vocabulary from outside it. AD.4 owns that vocabulary now,
 * and says the opposite — *including the failure paths (a failed rotation is still an
 * event)* — so a refusal is recorded under the **same action name** as the success, with
 * `outcome` and `reason` in the payload saying which it was. No new names, and one row per
 * attempt either way.
 *
 * Which is the more useful trail anyway. *Nobody rotated this key* and *three people tried to
 * rotate this key and the provider refused all three* are very different facts, and only one
 * of them is visible in a trail of successes.
 *
 * **A failure to record is a failure of the operation — except when recording a failure.**
 * `AuditService.record` propagates, on the reasoning in its own header: decision P5's premise
 * is that a credential operation with no record fails the page's security claim. The one
 * place that does not propagate is {@link ProviderAudit.failed}, which runs inside the
 * caller's `catch`: an insert that threw there would replace a `422
 * provider_validation_failed` with an unexplained `500`, losing the more useful of the two
 * facts and telling the client to retry an operation that was correctly refused. So that one
 * logs and swallows, which is the only asymmetry in this file and the reason it is written
 * down here.
 *
 * ---------------------------------------------------------------------------
 * **Nothing in a record is secret, and that is checkable rather than promised.** No method
 * here takes a plaintext, a mask or an envelope: the parameters are ids, a kind, a person, an
 * instant and — at most — the name of a step-up method or a pair of cap figures.
 * `audit.secrecy.spec.ts` greps the rows a full lifecycle actually writes against the vault's
 * own redaction vocabulary, and `ouroboros/no-secret-logging` — applied to this whole
 * module — is what refuses a field that would change it.
 */

import { Injectable, Logger } from "@nestjs/common";

import {
  auditDetail,
  providerUpdateEvent,
  PROVIDER_ADDED_EVENT,
  PROVIDER_DELETED_EVENT,
  PROVIDER_REVEALED_EVENT,
  PROVIDER_ROTATED_EVENT,
  PROVIDER_TESTED_EVENT,
  type AuditAction,
  type AuditDetail,
} from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import type { ProviderConnectionKind } from "../db/schema";
import { failureCode } from "../errors/failure";
import type { ProviderValidation } from "../providers/provider.adapter";
import { PROVIDER_CONNECTION_ERRORS } from "./provider-connections.errors";
import type { StepUpMethod } from "./step-up";

export {
  PROVIDER_ADDED_EVENT,
  PROVIDER_DELETED_EVENT,
  PROVIDER_REVEALED_EVENT,
  PROVIDER_ROTATED_EVENT,
  PROVIDER_TESTED_EVENT,
} from "../audit/audit.events";

/**
 * What the trail records a connection's events *about*.
 *
 * A constant rather than the string, because `audit_events.subject_type` is one half of a
 * deliberately non-referential subject (V022) — nothing in the database ties this word to the
 * table it names, so the one place it is spelled is here.
 */
export const PROVIDER_CONNECTION_SUBJECT = "provider_connection";

/** What every record of a *completed* operation carries. */
export interface ProviderAuditContext {
  /** The workspace — resolved from the session, never taken from the request. */
  readonly organizationId: string;
  /** The connection the operation was about. */
  readonly connectionId: string;
  /** Which provider it reaches. */
  readonly kind: ProviderConnectionKind;
  /** `"user".id` — who did it. Never their address: an id is what the trail's join reads. */
  readonly actorId: string;
  /** When it happened. */
  readonly at: Date;
}

/**
 * What a record of a *refused* operation carries.
 *
 * Deliberately a second shape rather than a widened {@link ProviderAuditContext}, because the
 * two `null`s below are only ever legitimate on this path and a shared type would make them
 * legitimate on both:
 *
 *   * **`connectionId` is null for a refused add.** AD.2 writes nothing to
 *     `provider_connections` unless the provider agreed first, so there is genuinely no row
 *     to name — which is also why V022 leaves `subject_id` nullable and gives it no foreign
 *     key.
 *   * **`kind` is null for a refusal that happened before the row was read.** A reveal is
 *     rate-limited before anything is fetched, on purpose (see the service's header on why
 *     the limiter is first), so *which provider* is not yet known and recording a guess would
 *     be worse than recording nothing.
 */
export interface ProviderAuditAttempt {
  readonly organizationId: string;
  readonly connectionId: string | null;
  readonly kind: ProviderConnectionKind | null;
  readonly actorId: string;
  readonly at: Date;
}

@Injectable()
export class ProviderAudit {
  /**
   * The sink of last resort, for an audit write that itself failed.
   *
   * Named for the family rather than for an event, so a deployment filtering its logs on
   * `provider.` still finds the events that could not be stored — which is the case this
   * logger exists for and the only one it sees.
   */
  private readonly logger = new Logger("provider.audit");

  /**
   * @param audit - The trail. AD.4's `audit_events`, through the one service that writes it.
   */
  constructor(private readonly audit: AuditService) {}

  /**
   * Record that a connection was created.
   *
   * @param context - Who, what and when.
   * @returns When the event is stored.
   */
  async added(context: ProviderAuditContext): Promise<void> {
    await this.write(PROVIDER_ADDED_EVENT, context);
  }

  /**
   * Record that a stored credential was handed back.
   *
   * @param context - Who, what and when.
   * @param method - How the step-up was satisfied. Recorded because it is the difference
   *   between *somebody with this session* and *somebody who proved they are this person*,
   *   and an audit of a reveal that could not say which is an audit of very little.
   * @returns When the event is stored.
   */
  async revealed(context: ProviderAuditContext, method: StepUpMethod): Promise<void> {
    await this.write(PROVIDER_REVEALED_EVENT, context, { step_up: method });
  }

  /**
   * Record that a credential was replaced.
   *
   * @param context - Who, what and when.
   * @returns When the event is stored.
   */
  async rotated(context: ProviderAuditContext): Promise<void> {
    await this.write(PROVIDER_ROTATED_EVENT, context);
  }

  /**
   * Record that a connection's settings changed.
   *
   * **Which of four names this writes is `providerUpdateEvent`'s decision**, not this
   * method's — a switch flipped on its own is `provider.enabled`, a cap moved on its own is
   * `provider.cap_changed`, and anything else is `provider.updated`. See that function for
   * why a request that did two things at once is the general name rather than either
   * specialised one.
   *
   * @param context - Who, what and when.
   * @param fields - Which settings were written, sorted. Recorded as a joined string rather
   *   than an array because `detail` is flat by construction — see `audit.events.ts` on why
   *   flatness is what makes the secrecy grep exhaustive. The *values* are deliberately
   *   absent: what changed is in the row, and echoing an address or a note here would put
   *   request content into a trail for no gain.
   * @param caps - What the monthly cap moved from and to, when it moved. Both are figures a
   *   person needs in order to read `provider.cap_changed` as anything other than *something
   *   about money changed*, and neither is secret.
   * @param enabled - What the switch was set to, when it was one of the fields.
   * @returns When the event is stored.
   */
  async updated(
    context: ProviderAuditContext,
    fields: readonly string[],
    caps?: { readonly from: number | null; readonly to: number | null },
    enabled?: boolean,
  ): Promise<void> {
    await this.write(providerUpdateEvent(fields, enabled), context, {
      fields: fields.join(","),
      from_cap_cents: caps?.from,
      to_cap_cents: caps?.to,
    });
  }

  /**
   * Record that a connection was removed.
   *
   * @param context - Who, what and when.
   * @returns When the event is stored.
   */
  async deleted(context: ProviderAuditContext): Promise<void> {
    await this.write(PROVIDER_DELETED_EVENT, context);
  }

  /**
   * Record that a connection was checked against its live provider, and what was found.
   *
   * Defined by AD.4 ([#225](https://github.com/NobuData/ouroboros/issues/225)) ahead of its
   * caller, so the name was spelled once; the caller is AE.4's
   * ([#230](https://github.com/NobuData/ouroboros/issues/230)) test route. **A provider that
   * failed the test is a `failure` outcome**, under the same reason a refused add or rotate
   * records — `provider_validation_failed` — with the taxonomy's class beside it: the
   * operation ran to completion either way, and what a reader of the trail wants to know is
   * what it found. A trail that recorded every test as a success would be a trail that could
   * not tell a key rejected on Tuesday from one that worked.
   *
   * @param context - Who, what and when.
   * @param validation - What the adapter found. A success carries its latency — the same
   *   figure `provider_connections.health` carries, and the reason a *tested* row is worth
   *   reading: a check that passed in 38ms and one that passed in 3 800ms are different facts.
   *   A failure carries its class and no latency, because it has none.
   * @returns When the event is stored.
   */
  async tested(context: ProviderAuditContext, validation: ProviderValidation): Promise<void> {
    await this.write(
      PROVIDER_TESTED_EVENT,
      context,
      validation.status === "ok"
        ? { outcome: "success", latency_ms: validation.latencyMs }
        : {
            outcome: "failure",
            reason: PROVIDER_CONNECTION_ERRORS.validationFailed,
            error_class: validation.errorClass,
          },
    );
  }

  /**
   * Record that an operation was refused, under the same name its success would have used.
   *
   * See this file's header on why a refusal is an event at all, and on why this is the one
   * method that swallows what it cannot store.
   *
   * @param attempt - Who tried, and what was known at the point it failed.
   * @param action - The action the operation would have recorded had it succeeded.
   * @param error - What refused it. Only its **code** is read — `provider_validation_failed`,
   *   `step_up_required` — never its message: a message is written for a person and can carry
   *   whatever an upstream provider chose to say, which is not something to copy into a table
   *   that is never pruned. `failureCode` is the same reader the error filter uses.
   * @returns When the event is stored, or when the failure to store it has been logged.
   */
  async failed(attempt: ProviderAuditAttempt, action: AuditAction, error: unknown): Promise<void> {
    const detail: AuditDetail = {
      kind: attempt.kind ?? undefined,
      outcome: "failure",
      reason: failureCode(error) ?? "internal_error",
    };

    try {
      await this.audit.record({
        organizationId: attempt.organizationId,
        actorId: attempt.actorId,
        action,
        subjectType: PROVIDER_CONNECTION_SUBJECT,
        subjectId: attempt.connectionId,
        at: attempt.at,
        detail,
      });
    } catch (recordingFailure) {
      // The one place this module writes a log line instead of a row. See the header: the
      // caller is already unwinding with a better error than this one, and replacing it would
      // tell a client to retry an operation that was correctly refused. The line carries the
      // whole event so the record still exists somewhere durable.
      this.logger.error(
        `could not record ${action} connection=${attempt.connectionId ?? "none"} ` +
          `organization=${attempt.organizationId} actor=${attempt.actorId} ` +
          `at=${attempt.at.toISOString()} ${JSON.stringify(auditDetail(detail))}`,
        recordingFailure,
      );
    }
  }

  /**
   * Write one event.
   *
   * @param action - The event's name.
   * @param context - Who, what and when.
   * @param detail - The event-specific fields, if any. `kind` is added here rather than at
   *   every call site, because every event this module writes is about a provider and a trail
   *   that made a reader join to find out which one is a trail nobody reads.
   * @returns When the event is stored.
   * @throws Whatever the insert threw — see this file's header.
   */
  private async write(
    action: AuditAction,
    context: ProviderAuditContext,
    detail: AuditDetail = {},
  ): Promise<void> {
    await this.audit.record({
      organizationId: context.organizationId,
      actorId: context.actorId,
      action,
      subjectType: PROVIDER_CONNECTION_SUBJECT,
      subjectId: context.connectionId,
      at: context.at,
      detail: { kind: context.kind, ...detail, outcome: detail.outcome ?? "success" },
    });
  }
}
