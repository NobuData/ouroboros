/**
 * The farm's trail — every operation in AD.4's shape, and the one place the information the
 * agent-facing refusal withholds is actually written down.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)); AD.4
 * ([#225](https://github.com/NobuData/ouroboros/issues/225)) is the sink, and
 * `provider-connections/connection.audit.ts` is the precedent this follows.
 *
 * ---------------------------------------------------------------------------
 * **This module is the other half of `farm.errors.ts`.** That file argues that an
 * unauthenticated caller gets one refusal for six different failures, because telling them
 * apart tells a stranger which of their guesses was close. The fact still has to exist
 * somewhere, and it exists here: {@link enrollmentRefused} writes the `refusal` an operator
 * reads in the Audit log sheet. *Six failed enrollments, all `unknown_token`* and *six failed
 * enrollments, all `bad_secret` against one live token* are very different mornings, and only
 * the trail can tell them apart.
 *
 * ---------------------------------------------------------------------------
 * **Nothing here takes a credential, and the type says so.** AD.4's `AuditDetail` is a flat
 * record of scalars and no function below has a parameter a token value, a bearer secret or
 * an envelope could be passed to — a certificate *serial* and a *fingerprint* are public by
 * construction, which is exactly why they are the identifiers this trail names. The compiler
 * refuses the other call.
 *
 * **A failure to record is a failure of the operation**, which is AD.4's posture and is
 * inherited rather than restated: every method here awaits `AuditService.record` and lets it
 * throw. The one exception is {@link enrollmentRefused}, which is written inside a `catch`
 * and whose own failure must not replace the refusal the caller is owed — `connection.audit.ts`
 * is where that rule was first written down.
 */

import { Injectable } from "@nestjs/common";

import { AuditService } from "../audit/audit.service";
import {
  RUNNER_CERT_RENEWED_EVENT,
  RUNNER_CERT_REVOKED_EVENT,
  RUNNER_ENROLLED_EVENT,
  RUNNER_TOKEN_MINTED_EVENT,
  RUNNER_TOKEN_REVOKED_EVENT,
} from "../audit/audit.events";
import type { EnrollmentRefusal } from "./farm.errors";

/** Who did it, and when — the two things every event here shares. */
export interface FarmActor {
  /** The workspace. */
  readonly organizationId: string;
  /** `"user"."id"`, or `null` for an act performed by a machine holding a token. */
  readonly actorId: string | null;
  /** When. Supplied by the caller so one operation's events agree on an instant. */
  readonly at: Date;
}

@Injectable()
export class FarmAudit {
  /** @param audit - AD.4's one writer. */
  constructor(private readonly audit: AuditService) {}

  /**
   * An enrollment token was minted.
   *
   * @param actor - Who, where and when.
   * @param token - The row's id, the pool it scopes to, and its bounds. **Not its value** —
   *   there is no parameter here one would fit in.
   * @returns When the event is written.
   */
  async tokenMinted(
    actor: FarmActor,
    token: { id: string; poolId: string; maxUses: number; expiresAt: Date },
  ): Promise<void> {
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: RUNNER_TOKEN_MINTED_EVENT,
      subjectType: "enrollment_token",
      subjectId: token.id,
      at: actor.at,
      detail: {
        poolId: token.poolId,
        maxUses: token.maxUses,
        expiresAt: token.expiresAt.toISOString(),
      },
    });
  }

  /**
   * An enrollment token was revoked before it expired.
   *
   * `usesAtRevocation` is the number an incident actually turns on: a leaked token revoked at
   * zero uses leaked nothing, and one revoked at four uses means four machines to account for.
   *
   * @param actor - Who, where and when.
   * @param token - The row's id and how many uses it had spent.
   * @returns When the event is written.
   */
  async tokenRevoked(
    actor: FarmActor,
    token: { id: string; usesAtRevocation: number },
  ): Promise<void> {
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: RUNNER_TOKEN_REVOKED_EVENT,
      subjectType: "enrollment_token",
      subjectId: token.id,
      at: actor.at,
      detail: { usesAtRevocation: token.usesAtRevocation },
    });
  }

  /**
   * A machine enrolled.
   *
   * The subject is the **runner**, not the token: *what happened to this machine* is the
   * question a fleet operator asks, and the token is named in the detail so the other
   * question — *what did that token let in?* — is one `where detail->>'tokenId'` away.
   *
   * @param actor - The workspace and the instant. `actorId` is the person who minted the
   *   token, which is the closest thing to a human author an enrollment has.
   * @param runner - What was created, and how it authenticates.
   * @returns When the event is written.
   */
  async enrolled(
    actor: FarmActor,
    runner: {
      id: string;
      name: string;
      poolId: string;
      tokenId: string;
      securityMode: string;
      serial: string | null;
    },
  ): Promise<void> {
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: RUNNER_ENROLLED_EVENT,
      subjectType: "runner",
      subjectId: runner.id,
      at: actor.at,
      detail: {
        name: runner.name,
        poolId: runner.poolId,
        tokenId: runner.tokenId,
        securityMode: runner.securityMode,
        serial: runner.serial,
      },
    });
  }

  /**
   * An enrollment was refused, and which of the six it was.
   *
   * **The one asymmetry in this file.** It is called from inside the `catch` that produces the
   * caller's refusal, so its own failure must not replace that refusal with an unexplained
   * `500` — the more useful of the two facts would be the one lost. So this method swallows,
   * and it is the only one that does.
   *
   * The workspace is the *token's*, when there was one; an enrollment refused for a token id
   * that names no row has no workspace to be recorded against and writes nothing, which is
   * the honest outcome rather than a row invented under some default tenant.
   *
   * @param actor - The token's workspace and the instant, or `undefined` when there is no
   *   workspace to attribute it to.
   * @param refusal - Which of the six.
   * @param tokenId - The row the caller claimed to hold, when it named a real one.
   * @returns When the attempt to record has finished, successfully or not.
   */
  async enrollmentRefused(
    actor: FarmActor | undefined,
    refusal: EnrollmentRefusal,
    tokenId: string | null,
  ): Promise<void> {
    if (!actor) return;

    try {
      await this.audit.record({
        organizationId: actor.organizationId,
        actorId: actor.actorId,
        action: RUNNER_ENROLLED_EVENT,
        subjectType: "enrollment_token",
        subjectId: tokenId,
        at: actor.at,
        detail: { outcome: "refused", refusal },
      });
    } catch {
      // Deliberately swallowed. See this method's documentation.
    }
  }

  /**
   * A runner replaced its certificate over the already-authenticated channel.
   *
   * Both serials are recorded, because *this runner's identity changed* is only useful if the
   * trail says what it changed from — a superseded serial in a proxy log a week later has to
   * resolve to something.
   *
   * @param actor - The workspace and the instant. `actorId` is null: a renewal is the
   *   machine's own act and no person authorised it.
   * @param renewal - The runner and the two serials.
   * @returns When the event is written.
   */
  async certificateRenewed(
    actor: FarmActor,
    renewal: { runnerId: string; previousSerial: string; serial: string },
  ): Promise<void> {
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: RUNNER_CERT_RENEWED_EVENT,
      subjectType: "runner",
      subjectId: renewal.runnerId,
      at: actor.at,
      detail: { previousSerial: renewal.previousSerial, serial: renewal.serial },
    });
  }

  /**
   * A runner's certificate was revoked, so the next handshake refuses it.
   *
   * @param actor - Who, where and when.
   * @param revocation - The runner, the serial that is now dead, and why.
   * @returns When the event is written.
   */
  async certificateRevoked(
    actor: FarmActor,
    revocation: { runnerId: string; serial: string; reason: string },
  ): Promise<void> {
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: RUNNER_CERT_REVOKED_EVENT,
      subjectType: "runner",
      subjectId: revocation.runnerId,
      at: actor.at,
      detail: { serial: revocation.serial, reason: revocation.reason },
    });
  }
}
