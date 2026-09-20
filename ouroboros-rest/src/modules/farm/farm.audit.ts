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
  RUNNER_DRAINED_EVENT,
  RUNNER_ENROLLED_EVENT,
  RUNNER_JOB_SUBMITTED_EVENT,
  RUNNER_POOL_CREATED_EVENT,
  RUNNER_POOL_DELETED_EVENT,
  RUNNER_POOL_UPDATED_EVENT,
  RUNNER_REMOVED_EVENT,
  RUNNER_TOKEN_MINTED_EVENT,
  RUNNER_TOKEN_REVOKED_EVENT,
  RUNNER_UNDRAINED_EVENT,
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

  /**
   * A runner was drained or undrained — an operator's decision about a machine.
   *
   * **The answer to *who drained bigiron?*** V040 keeps `runners.desired_state` apart from
   * `runners.status` so that a heartbeat cannot write a pill nobody chose, and its own comment
   * names this question as the reason. The column records that a decision exists; this records
   * whose it was.
   *
   * `pushed` is recorded because it is the difference between *the agent was told* and *the
   * agent will be told at its next heartbeat*, and when a drain appears not to have taken
   * effect that is the first thing worth knowing. It is not a failure either way — see
   * `gateway/runner.control.ts`.
   *
   * @param actor - Who, where and when.
   * @param action - The runner, which way it went, and whether the frame reached a session in
   *   this process.
   * @returns When the event is written.
   */
  async drainChanged(
    actor: FarmActor,
    action: { runnerId: string; name: string; draining: boolean; pushed: boolean },
  ): Promise<void> {
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: action.draining ? RUNNER_DRAINED_EVENT : RUNNER_UNDRAINED_EVENT,
      subjectType: "runner",
      subjectId: action.runnerId,
      at: actor.at,
      detail: { name: action.name, pushed: action.pushed },
    });
  }

  /**
   * A runner was retired from the fleet.
   *
   * Distinct from {@link certificateRevoked}, which a removal also causes: retiring a machine
   * and suspecting one are different events, and only the second is an incident. Both rows are
   * written, so the trail can answer either question — `audit.events.ts` is where that split
   * is argued.
   *
   * `status` is what the fleet last observed before the row was retired, which is the evidence
   * that the guard held: a removal is only ever performed on a machine that was offline or
   * drained, and the trail should say which.
   *
   * @param actor - Who, where and when.
   * @param removal - The runner, its name, and the state it was removed from.
   * @returns When the event is written.
   */
  async runnerRemoved(
    actor: FarmActor,
    removal: { runnerId: string; name: string; status: string },
  ): Promise<void> {
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: RUNNER_REMOVED_EVENT,
      subjectType: "runner",
      subjectId: removal.runnerId,
      at: actor.at,
      detail: { name: removal.name, status: removal.status },
    });
  }

  /**
   * A pool was created.
   *
   * @param actor - Who, where and when.
   * @param pool - The pool, and what a build of it will run under.
   * @returns When the event is written.
   */
  async poolCreated(
    actor: FarmActor,
    pool: { id: string; name: string; executor: string; image: string | null },
  ): Promise<void> {
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: RUNNER_POOL_CREATED_EVENT,
      subjectType: "runner_pool",
      subjectId: pool.id,
      at: actor.at,
      detail: { name: pool.name, executor: pool.executor, image: pool.image },
    });
  }

  /**
   * A pool's configuration changed.
   *
   * **The field names, never their values.** Which fields moved is what makes the trail
   * useful — *somebody changed this pool's image on Tuesday* — and the values are on the row.
   * `env_allowlist`'s value in particular is the list of variables a build may carry onto a
   * customer's machine: its *shape* is operational detail about that workspace's secrets, and
   * `AuditDetail` is flat precisely so a scan of the column's keys is a scan of the whole
   * payload. `enabled` is carried as a value because the switch's direction is the event.
   *
   * @param actor - Who, where and when.
   * @param change - The pool, the fields that moved, and the switch's direction if it moved.
   * @returns When the event is written.
   */
  async poolUpdated(
    actor: FarmActor,
    change: { id: string; name: string; fields: readonly string[]; enabled?: boolean },
  ): Promise<void> {
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: RUNNER_POOL_UPDATED_EVENT,
      subjectType: "runner_pool",
      subjectId: change.id,
      at: actor.at,
      detail: {
        name: change.name,
        fields: [...change.fields].sort().join(","),
        enabled: change.enabled,
      },
    });
  }

  /**
   * A pool was deleted.
   *
   * @param actor - Who, where and when.
   * @param pool - The pool. Its id is recorded even though the row is gone, which is V022's
   *   whole position on a non-referential subject: an event about a thing must outlive it.
   * @returns When the event is written.
   */
  async poolDeleted(actor: FarmActor, pool: { id: string; name: string }): Promise<void> {
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: RUNNER_POOL_DELETED_EVENT,
      subjectType: "runner_pool",
      subjectId: pool.id,
      at: actor.at,
      detail: { name: pool.name },
    });
  }

  /**
   * A build was submitted to a pool (AH.4's submission, audited since AI.5 —
   * [#260](https://github.com/NobuData/ouroboros/issues/260)).
   *
   * What is recorded is **what was asked to be built, never the command that builds it**. The
   * command is argv somebody typed, and a token pasted onto a command line is the likeliest
   * secret a submission will ever carry — so there is no parameter here it could arrive in.
   * The job row holds the command for whoever may read the job; the trail holds who asked.
   *
   * @param actor - Who, where and when. `actorId` is `null` when a run submitted the build
   *   rather than a person; `runId` then says which.
   * @param job - The build: its id and public number, the pool, and the exact commit of which
   *   repository and ref.
   * @returns When the event is written.
   */
  async jobSubmitted(
    actor: FarmActor,
    job: {
      jobId: string;
      number: number;
      pool: string;
      repository: string;
      ref: string;
      commit: string;
      runId: string | null;
    },
  ): Promise<void> {
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: RUNNER_JOB_SUBMITTED_EVENT,
      subjectType: "build_job",
      subjectId: job.jobId,
      at: actor.at,
      detail: {
        number: job.number,
        pool: job.pool,
        repository: job.repository,
        ref: job.ref,
        commit: job.commit,
        // Only when a run submitted it: the detail stays flat scalars, and a key holding
        // `null` on every build a person submitted would be a fact about nothing.
        ...(job.runId === null ? {} : { runId: job.runId }),
      },
    });
  }
}
