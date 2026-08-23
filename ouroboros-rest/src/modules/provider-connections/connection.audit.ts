/**
 * `provider.added`, `provider.revealed`, `provider.rotated`, `provider.updated`,
 * `provider.deleted` — the trail every lifecycle operation leaves.
 *
 * AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223)) requires that a reveal
 * *writes an audit event*, and AD.4 ([#225](https://github.com/NobuData/ouroboros/issues/225))
 * — which depends on this ticket — is what gives the installation an `audit_events` table to
 * write into and a surface to read it back on. That ordering is real and this file is how it
 * is honoured without either lying or dropping the criterion.
 *
 * **The events are real; their sink is interim.** Each record is assembled at the one point
 * the operation is known to have happened, and emitted to the service log — a durable,
 * timestamped, in-cluster record carrying every field AD.4's row will carry. When #225
 * lands, the bodies of the methods below become an insert and every caller, every field and
 * every event name stays exactly as it is. `internal/lease.audit.ts` (AD.3) established this
 * seam for `credential.lease_granted`, and this is the same seam at five events instead of
 * one — which is also why the two files look alike on purpose.
 *
 * ---------------------------------------------------------------------------
 * **The names are AD.4's, agreed before the trail exists.** That issue's scope names
 * `provider.added|revealed|rotated|…` beside AD.3's `credential.lease_granted`, so they are
 * spelled here exactly as somebody grepping the trail later will spell them.
 *
 * **Every operation writes exactly one event, and only on success.** A refused reveal is not
 * a `provider.reveal_failed` invented here — that would be putting a name into AD.4's
 * vocabulary from outside it — and a refusal is already a log line from the error filter.
 * What *is* recorded on a reveal is how the step-up was satisfied, because *whose password
 * opened this key* is the question an audit of a reveal exists to answer.
 *
 * **Nothing in a record is secret, and that is checkable rather than promised.** No method
 * here takes a plaintext, a mask or an envelope: the fields are ids, a kind, a person and an
 * instant. `connection.audit.spec.ts` asserts the rendered lines against the vault's own
 * redaction vocabulary, and `ouroboros/no-secret-logging` — which is applied to the whole
 * service — is what refuses a field that would change it.
 */

import { Injectable, Logger } from "@nestjs/common";

import type { ProviderConnectionKind } from "../db/schema";
import type { StepUpMethod } from "./step-up";

/** A provider connection was created. */
export const PROVIDER_ADDED_EVENT = "provider.added";

/** A stored provider credential was handed back to a person. */
export const PROVIDER_REVEALED_EVENT = "provider.revealed";

/** A provider credential was replaced by a new, live-validated one. */
export const PROVIDER_ROTATED_EVENT = "provider.rotated";

/** A connection's settings changed — the switch, the cap, the note, the address. */
export const PROVIDER_UPDATED_EVENT = "provider.updated";

/** A connection was removed. */
export const PROVIDER_DELETED_EVENT = "provider.deleted";

/**
 * Every event this module records.
 *
 * A named list rather than five loose constants, so `openapi.yaml`'s prose, AD.4's reader and
 * this module's own suite can all be held to one enumeration — which is what stops a sixth
 * operation shipping with no trail because nobody remembered to add one.
 */
export const PROVIDER_AUDIT_EVENTS = [
  PROVIDER_ADDED_EVENT,
  PROVIDER_REVEALED_EVENT,
  PROVIDER_ROTATED_EVENT,
  PROVIDER_UPDATED_EVENT,
  PROVIDER_DELETED_EVENT,
] as const;

/** One of {@link PROVIDER_AUDIT_EVENTS}. */
export type ProviderAuditEvent = (typeof PROVIDER_AUDIT_EVENTS)[number];

/** What every record carries, whatever happened. */
export interface ProviderAuditContext {
  /** The workspace — resolved from the session, never taken from the request. */
  readonly organizationId: string;
  /** The connection the operation was about. */
  readonly connectionId: string;
  /** Which provider it reaches. */
  readonly kind: ProviderConnectionKind;
  /** `"user".id` — who did it. Never their address: an id is what AD.4's row will join on. */
  readonly actorId: string;
  /** When it happened. */
  readonly at: Date;
}

@Injectable()
export class ProviderAudit {
  /**
   * The interim sink. See this file's header for what replaces it and when.
   *
   * One logger for all five events, named for the family rather than for an event, so a
   * deployment filtering its logs on `provider.` gets the whole trail with one pattern.
   */
  private readonly logger = new Logger("provider.audit");

  /**
   * Record that a connection was created.
   *
   * @param context - Who, what and when.
   */
  added(context: ProviderAuditContext): void {
    this.write(PROVIDER_ADDED_EVENT, context);
  }

  /**
   * Record that a stored credential was handed back.
   *
   * @param context - Who, what and when.
   * @param method - How the step-up was satisfied. Recorded because it is the difference
   *   between *somebody with this session* and *somebody who proved they are this person*,
   *   and an audit of a reveal that could not say which is an audit of very little.
   */
  revealed(context: ProviderAuditContext, method: StepUpMethod): void {
    this.write(PROVIDER_REVEALED_EVENT, context, `step-up=${method}`);
  }

  /**
   * Record that a credential was replaced.
   *
   * @param context - Who, what and when.
   */
  rotated(context: ProviderAuditContext): void {
    this.write(PROVIDER_ROTATED_EVENT, context);
  }

  /**
   * Record that a connection's settings changed.
   *
   * @param context - Who, what and when.
   * @param fields - Which settings were written, sorted. The values are deliberately absent:
   *   what changed is in the row and in this line, and echoing an address or a note here
   *   would put request content into a log for no gain that AD.4's own before/after will not
   *   give properly.
   */
  updated(context: ProviderAuditContext, fields: readonly string[]): void {
    this.write(PROVIDER_UPDATED_EVENT, context, `fields=${fields.join(",")}`);
  }

  /**
   * Record that a connection was removed.
   *
   * @param context - Who, what and when.
   */
  deleted(context: ProviderAuditContext): void {
    this.write(PROVIDER_DELETED_EVENT, context);
  }

  /**
   * Write one line.
   *
   * @param event - The event's name.
   * @param context - Who, what and when.
   * @param extra - The one event-specific clause, when there is one. Appended rather than
   *   interleaved, so every line in the trail starts with the same six fields in the same
   *   order and is readable by a person and by `cut` alike.
   */
  private write(event: ProviderAuditEvent, context: ProviderAuditContext, extra?: string): void {
    this.logger.log(
      `${event} connection=${context.connectionId} kind=${context.kind} ` +
        `organization=${context.organizationId} actor=${context.actorId} ` +
        `at=${context.at.toISOString()}${extra === undefined ? "" : ` ${extra}`}`,
    );
  }
}
