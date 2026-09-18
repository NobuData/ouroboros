/**
 * Enrolling a machine, renewing its certificate, and revoking one — decision **B3**'s chain,
 * end to end.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)).
 *
 * ```
 * register(token, name, arch, CSR)
 *    │
 *    ├─ parse the token ......... shape only; a fabricated one gets the same answer
 *    ├─ find its row ............ by the id the token carries — the ONE unscoped read
 *    ├─ open the envelope ....... and compare in constant time
 *    ├─ live? ................... not revoked, not expired, uses remaining
 *    ├─ pool scope .............. a token for pool-a REFUSES a request naming pool-b
 *    ├─ ensure the CA ........... generated on the first enrollment, never before
 *    ├─ read the CSR ............ platform parsers only; the subject is discarded
 *    ├─ sign .................... CN = runner id, O = workspace — composed, never claimed
 *    └─ one transaction ......... spend the token · insert the runner · insert the cert
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Two checks of the use count, and they are doing different jobs.** The service checks
 * `uses < max_uses` so that a spent token is refused without generating a keypair or creating
 * a row; the *statement* checks it again with `where uses < max_uses`, which is the one that
 * is actually load-bearing. Two agents presenting the last use of the same token at the same
 * moment both pass the first check, and exactly one of them updates a row — so *a second use
 * of a single-use token fails* is a property of the database rather than of a check this code
 * performs. `FarmRepository.enrol` is where that is written down.
 *
 * **The workspace is never taken from the request.** `RegisterRunnerDto` has no field for
 * one, and the workspace an enrollment lands in is the one on the token's row. The
 * organization-isolation criterion is therefore structural rather than checked: there is no
 * input to compare against anything.
 *
 * **The order is: everything that can fail without a side effect, first.** A refused
 * enrollment writes no runner, spends no use and generates no certificate — the only thing it
 * writes is the audit row saying which of the six refusals it was, which is the fact
 * `farm.errors.ts` deliberately keeps out of the response.
 */

import { Inject, Injectable } from "@nestjs/common";
import type { KeyObject } from "node:crypto";

import { VaultService } from "../vault/vault.service";
import type { EnrollmentToken, Runner, RunnerCertificate } from "../db/schema";
import { FARM_CLOCK, FarmAuthorityService, type FarmClock } from "./farm.authority";
import { FarmAudit, type FarmActor } from "./farm.audit";
import {
  enrollmentRefused,
  fallbackNotPermitted,
  invalidCsr,
  noLiveCertificate,
  runnerNameTaken,
  runnerNotFound,
  type EnrollmentRefusal,
} from "./farm.errors";
import { UNIQUE_VIOLATION, isDatabaseFailure } from "../tenancy/constraints";
import { BEARER_SECRET_BYTES } from "./farm.policy";
import { FarmRepository } from "./farm.repository";
import { parseToken, randomSecret, verifySecret } from "./farm.tokens";
import {
  authorityResource,
  fallbackEnrollmentResource,
  mtlsEnrollmentResource,
  renewalResource,
  runnerCertificateResource,
  type AuthorityResource,
  type EnrollmentResource,
  type RenewalResource,
  type RunnerCertificateResource,
} from "./farm.resources";
import type { RegisterRunnerDto, RenewCertificateDto } from "./farm.dto";
import { InvalidCsrError, publicKeyFromCsr } from "./x509/csr";
import type { RunnerIdentity } from "./runner.identity";

/** A token that passed every check, with the workspace it establishes. */
interface LiveToken {
  /** The row. */
  readonly row: EnrollmentToken;
  /** Its workspace — the one the runner will be created in. */
  readonly organizationId: string;
}

/** Why an enrollment was refused, carried out of the checks and into the trail. */
class RefusedEnrollment extends Error {
  /**
   * @param refusal - Which of the six.
   * @param actor - The workspace to record it against, when the token named a real row.
   * @param tokenId - That row's id, when there was one.
   */
  constructor(
    readonly refusal: EnrollmentRefusal,
    readonly actor: FarmActor | undefined,
    readonly tokenId: string | null,
  ) {
    super("enrollment refused");
  }
}

@Injectable()
export class RegistrationService {
  /**
   * @param farm - The statements.
   * @param authority - The CA. The only collaborator that ever holds a private key.
   * @param vault - AD.1's envelope encryption, for the token's secret and the fallback's.
   * @param audit - AD.4's trail.
   * @param now - The clock.
   */
  constructor(
    private readonly farm: FarmRepository,
    private readonly authority: FarmAuthorityService,
    private readonly vault: VaultService,
    private readonly audit: FarmAudit,
    @Inject(FARM_CLOCK) private readonly now: FarmClock,
  ) {}

  /**
   * Enrol a machine.
   *
   * @param request - The token, the machine's name and architecture, and a certificate
   *   request — or, where a workspace permits it, no certificate request and an explicit ask
   *   for the bearer fallback.
   * @returns What the agent needs: its runner id, its certificate, and the CA to pin.
   * @throws {UnauthenticatedError} For all six token failures, identically.
   * @throws {InvalidRequestError} If the certificate request cannot be signed.
   * @throws {ForbiddenError} If the fallback was asked for and the workspace forbids it.
   */
  async register(request: RegisterRunnerDto): Promise<EnrollmentResource> {
    const at = this.now();

    let token: LiveToken;
    try {
      token = await this.liveToken(request, at);
    } catch (cause) {
      if (!(cause instanceof RefusedEnrollment)) throw cause;

      await this.audit.enrollmentRefused(cause.actor, cause.refusal, cause.tokenId);
      throw enrollmentRefused();
    }

    return request.securityMode === "bearer_fallback"
      ? this.enrolWithBearer(token, request, at)
      : this.enrolWithCertificate(token, request, at);
  }

  /**
   * The six checks, in the order that avoids side effects.
   *
   * @param request - The registration.
   * @param at - Now.
   * @returns The token and its workspace.
   * @throws {RefusedEnrollment} Naming which check failed — for the trail, never the caller.
   */
  private async liveToken(request: RegisterRunnerDto, at: Date): Promise<LiveToken> {
    const presented = parseToken(request.token);
    if (!presented) throw new RefusedEnrollment("unknown_token", undefined, null);

    const row = await this.farm.tokenById(presented.id);
    if (!row) throw new RefusedEnrollment("unknown_token", undefined, null);

    // From here on there is a workspace to record a refusal against. The actor is the person
    // who minted the token, which is the closest thing an enrollment has to a human author.
    const actor: FarmActor = { organizationId: row.organization_id, actorId: row.created_by, at };
    const refuse = (refusal: EnrollmentRefusal): never => {
      throw new RefusedEnrollment(refusal, actor, row.id);
    };

    const sealed = await this.vault.decryptText(row.organization_id, row.id, row.token_sealed);
    if (!verifySecret(presented.secret, sealed)) refuse("bad_secret");

    if (row.revoked) refuse("revoked");
    if (row.expires_at.getTime() <= at.getTime()) refuse("expired");
    if (row.uses >= row.max_uses) refuse("spent");

    // **The pool-scope criterion.** A request that names a pool must name *this token's* pool.
    // Resolving the requested name and comparing ids rather than comparing names is what makes
    // it robust against a workspace that has two pools whose names differ only in case — and
    // an unresolvable name is a mismatch, not a `404`: a stranger must not learn which pool
    // names exist.
    if (request.pool) {
      const pool = await this.farm.poolById(row.organization_id, row.pool_id);
      if (!pool || pool.name !== request.pool) refuse("pool_mismatch");
    }

    return { row, organizationId: row.organization_id };
  }

  /**
   * Enrol with a client certificate — the default, and the one decision B3 argues for.
   *
   * @param token - The live token.
   * @param request - The registration.
   * @param at - Now.
   * @returns The enrollment.
   */
  private async enrolWithCertificate(
    token: LiveToken,
    request: RegisterRunnerDto,
    at: Date,
  ): Promise<EnrollmentResource> {
    const publicKey = this.keyFromRequest(request.csr);
    const authority = await this.authority.ensure(token.organizationId);

    // The runner's id is chosen here, because the certificate's `CN` is that id and the
    // certificate has to exist before the row that names its serial. `crypto.randomUUID()`
    // rather than the column's default, for `enrollment.service.ts`'s reason.
    const runnerId = crypto.randomUUID();
    const certificate = await this.authority.sign(authority, runnerId, publicKey);

    const runner = await this.enrolOrRefuse(request.name, {
      tokenId: token.row.id,
      runner: {
        id: runnerId,
        organization_id: token.organizationId,
        pool_id: token.row.pool_id,
        name: request.name,
        arch: request.arch,
        agent_version: request.agentVersion ?? null,
        capabilities: this.capabilities(request),
        security_mode: "mtls",
        cert_serial: certificate.serial,
        enrolled_by: token.row.created_by,
      },
      certificate: {
        organization_id: token.organizationId,
        runner_id: runnerId,
        serial: certificate.serial,
        fingerprint: certificate.fingerprint,
        issued_for: "enrollment",
        not_before: certificate.notBefore,
        not_after: certificate.notAfter,
      },
    });

    // The statement's own `where uses < max_uses` refused it — another agent spent the last
    // use between this request's check and its write. The certificate that was signed a moment
    // ago is discarded unstored, which costs a signature and is the right trade: the
    // alternative is holding a transaction open across one.
    if (!runner) {
      await this.audit.enrollmentRefused(
        { organizationId: token.organizationId, actorId: token.row.created_by, at },
        "spent",
        token.row.id,
      );

      throw enrollmentRefused();
    }

    await this.audit.enrolled(
      { organizationId: token.organizationId, actorId: token.row.created_by, at },
      {
        id: runner.id,
        name: runner.name,
        poolId: runner.pool_id,
        tokenId: token.row.id,
        securityMode: "mtls",
        serial: certificate.serial,
      },
    );

    return mtlsEnrollmentResource(runner, authority, certificate);
  }

  /**
   * Enrol with a bearer secret — the path for proxies that strip client certificates.
   *
   * **Gated by the workspace setting, and recorded in `security_mode`.** Both halves matter:
   * the gate means a deployment that never considered the question never has the weaker path,
   * and the column means AI.2 ([#257](https://github.com/NobuData/ouroboros/issues/257))
   * renders the runner as visibly degraded rather than putting a green shield over it.
   *
   * @param token - The live token.
   * @param request - The registration.
   * @param at - Now.
   * @returns The enrollment, carrying the secret exactly once.
   * @throws {ForbiddenError} If the workspace has not switched the fallback on.
   */
  private async enrolWithBearer(
    token: LiveToken,
    request: RegisterRunnerDto,
    at: Date,
  ): Promise<EnrollmentResource> {
    if (!(await this.farm.bearerFallbackPermitted(token.organizationId))) {
      throw fallbackNotPermitted();
    }

    const authority = await this.authority.ensure(token.organizationId);
    const runnerId = crypto.randomUUID();
    const bearer = randomSecret(BEARER_SECRET_BYTES);

    const runner = await this.enrolOrRefuse(request.name, {
      tokenId: token.row.id,
      runner: {
        id: runnerId,
        organization_id: token.organizationId,
        pool_id: token.row.pool_id,
        name: request.name,
        arch: request.arch,
        agent_version: request.agentVersion ?? null,
        capabilities: this.capabilities(request),
        security_mode: "bearer_fallback",
        cert_serial: null,
        bearer_sealed: await this.vault.encryptText(token.organizationId, runnerId, bearer),
        enrolled_by: token.row.created_by,
      },
    });

    if (!runner) {
      await this.audit.enrollmentRefused(
        { organizationId: token.organizationId, actorId: token.row.created_by, at },
        "spent",
        token.row.id,
      );

      throw enrollmentRefused();
    }

    await this.audit.enrolled(
      { organizationId: token.organizationId, actorId: token.row.created_by, at },
      {
        id: runner.id,
        name: runner.name,
        poolId: runner.pool_id,
        tokenId: token.row.id,
        securityMode: "bearer_fallback",
        serial: null,
      },
    );

    return fallbackEnrollmentResource(runner, authority, bearer);
  }

  /**
   * Replace the certificate of a runner that is already authenticated by one.
   *
   * **No enrollment token is involved and none can be.** The identity comes from the
   * certificate the caller presented, which `runner.identity.ts` has already verified against
   * the workspace's CA and the revocation list — so a runner whose certificate was revoked
   * cannot renew its way back in, which is the property that makes revocation mean anything.
   *
   * @param identity - The authenticated runner, from `RunnerIdentityService`.
   * @param request - The new certificate request.
   * @returns The new certificate and the CA.
   * @throws {InvalidRequestError} If the certificate request cannot be signed.
   */
  async renew(identity: RunnerIdentity, request: RenewCertificateDto): Promise<RenewalResource> {
    const at = this.now();
    const publicKey = this.keyFromRequest(request.csr);

    const certificate = await this.authority.sign(
      identity.authority,
      identity.runner.id,
      publicKey,
    );

    await this.farm.renew(
      {
        supersededId: identity.certificate.id,
        certificate: {
          organization_id: identity.runner.organization_id,
          runner_id: identity.runner.id,
          serial: certificate.serial,
          fingerprint: certificate.fingerprint,
          issued_for: "renewal",
          not_before: certificate.notBefore,
          not_after: certificate.notAfter,
        },
      },
      at,
    );

    await this.audit.certificateRenewed(
      { organizationId: identity.runner.organization_id, actorId: null, at },
      {
        runnerId: identity.runner.id,
        previousSerial: identity.certificate.serial,
        serial: certificate.serial,
      },
    );

    return renewalResource(identity.authority, certificate);
  }

  /**
   * Revoke a runner's live certificate, so the next handshake refuses it.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who is revoking it.
   * @param runnerId - The runner.
   * @param reason - One short word for the trail and the column — `operator` by default.
   * @returns The certificate as it now stands.
   * @throws {NotFoundError} If the workspace has no such runner.
   * @throws {ConflictError} If it holds no live certificate — a bearer-fallback runner, or
   *   one whose certificate was already revoked.
   */
  async revokeCertificate(
    organizationId: string,
    actorId: string,
    runnerId: string,
    reason = "operator",
  ): Promise<RunnerCertificateResource> {
    const runner = await this.farm.runnerById(organizationId, runnerId);
    if (!runner) throw runnerNotFound();

    const live = await this.farm.liveCertificate(organizationId, runnerId);
    if (!live) throw noLiveCertificate();

    const at = this.now();
    const revoked = await this.farm.revokeCertificate(organizationId, live.id, at, actorId, reason);

    // Another revocation of the same certificate landed first. Its effect is what this caller
    // asked for, so the answer is the certificate rather than a conflict about who got there
    // first — `enrollment.service.ts` takes the same position about a token.
    const result: RunnerCertificate = revoked ?? live;

    if (revoked) {
      await this.audit.certificateRevoked(
        { organizationId, actorId, at },
        { runnerId, serial: revoked.serial, reason },
      );
    }

    return runnerCertificateResource(result);
  }

  /**
   * One workspace's authority, creating it if nothing has enrolled yet.
   *
   * The read behind `GET /farm/authority` — the certificate a person pins by hand when they
   * are setting up a proxy, and the one thing about a CA any API returns.
   *
   * **It answers the resource rather than the row**, which is the one place in this service
   * where that choice is load-bearing rather than tidy: a `FarmAuthority` carries `key_sealed`,
   * and a method that handed one to a controller would be a method whose result somebody could
   * serialise. `farm.secrecy.spec.ts` drives this path and greps what comes back.
   *
   * @param organizationId - The workspace.
   * @returns The public half.
   */
  async authorityOf(organizationId: string): Promise<AuthorityResource> {
    return authorityResource(await this.authority.ensure(organizationId));
  }

  /**
   * Write the enrollment, turning the one constraint a caller can trip into its own answer.
   *
   * `runners_organization_name_key` is the only uniqueness rule a registration can violate
   * that is about the caller's input rather than about this service's state — a serial is 128
   * random bits and a runner id is a fresh UUID. Any other `23505` is re-thrown, because a
   * conflict this code does not recognise is a `500` a person should look at rather than a
   * `409` a client should retry.
   *
   * @param name - The machine's name, for the message.
   * @param write - The transaction's inputs.
   * @returns The runner, or `undefined` when the token had no use left.
   * @throws {ConflictError} If the workspace already has a runner of that name.
   */
  private async enrolOrRefuse(
    name: string,
    write: Parameters<FarmRepository["enrol"]>[0],
  ): Promise<Runner | undefined> {
    try {
      return await this.farm.enrol(write);
    } catch (cause) {
      if (
        isDatabaseFailure(cause) &&
        cause.code === UNIQUE_VIOLATION &&
        cause.constraint === "runners_organization_name_key"
      ) {
        throw runnerNameTaken(name);
      }

      throw cause;
    }
  }

  /**
   * Read a certificate request, or refuse it in the caller's own terms.
   *
   * @param pem - The request, or `undefined` — which the DTO only permits on the fallback
   *   path, so reaching here without one is a client that sent `securityMode: "mtls"` and no
   *   CSR.
   * @returns The key to certify.
   * @throws {InvalidRequestError} With `csr.ts`'s own sentence. Safe to echo: it describes the
   *   request's shape and never this workspace's state — see `farm.errors.ts`.
   */
  private keyFromRequest(pem: string | undefined): KeyObject {
    if (!pem) throw invalidCsr("A certificate request is required to enrol with mTLS.");

    try {
      return publicKeyFromCsr(pem);
    } catch (cause) {
      if (cause instanceof InvalidCsrError) throw invalidCsr(cause.message);
      throw cause;
    }
  }

  /**
   * What the machine says it can do — AG.1's `hello`, asked at enrollment.
   *
   * Bounded by V040's `farm_capabilities_valid`, which is why only the two fields that
   * constraint names are carried: a capabilities document this service assembled from
   * arbitrary request fields would be a document the schema then refuses, and the refusal
   * would arrive as a `500`.
   *
   * @param request - The registration.
   * @returns The document, `{}` when the agent said nothing.
   */
  private capabilities(request: RegisterRunnerDto): Record<string, unknown> {
    const capabilities: Record<string, unknown> = {};

    if (request.docker !== undefined) capabilities.docker = request.docker;
    if (request.cpuCount !== undefined) capabilities.cpu_count = request.cpuCount;

    return capabilities;
  }
}

/** Re-exported so the controller names one type rather than importing two modules. */
export type { Runner };
