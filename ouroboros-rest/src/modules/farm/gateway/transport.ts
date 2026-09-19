/**
 * Who is on the other end of an upgrade request — answered before a single frame, and before a
 * socket exists to send one on.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)), decision **B3**, and the
 * issue's two handshake criteria: *a revoked certificate is refused at handshake*, and *a
 * connection missing a client certificate is rejected rather than silently accepted*.
 *
 * ```
 * GET /api/v1/farm/agent  (Upgrade: websocket)
 *   ├─ a client certificate?  (the socket, or OURO_FARM_CLIENT_CERT_HEADER — client.certificate.ts)
 *   │     └─ RunnerIdentityService.authenticate ── live? ─ yes ─▶ runner, mtls
 *   │                                               └─ no ──▶ 401 farm_identity_refused
 *   ├─ Authorization: Bearer <secret>?  (decision B3's fallback, where a workspace permits it)
 *   │     └─ matches a fallback runner's sealed secret? ─ yes ─▶ runner, bearer_fallback
 *   │                                                   └─ no ──▶ 401 farm_identity_refused
 *   └─ neither ─────────────────────────────────────────────────▶ 401 farm_client_certificate_required
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The revocation check is AH.2's, called rather than rewritten.** `RunnerIdentityService` is
 * exported by `FarmModule` for exactly this caller, and it is the one answer to *is this
 * certificate a live identity of this farm?* — signature against the workspace's own CA, the
 * serial in `runner_certificates`, not revoked, not superseded, the runner not removed. A second
 * implementation here is how a revocation ends up honoured on one path and not the other.
 *
 * **The refusals are AH.2's too**, with AH.2's codes and AH.2's reasons for having only two: an
 * unknown certificate and a revoked one must be indistinguishable from outside, and the Go agent
 * already reads `farm_identity_refused` as *stop, do not retry* and
 * `farm_client_certificate_required` as *a proxy is eating your certificate* — its log line for
 * the second one names `SECURITY_MODEL.md` § 7.6.
 *
 * ---------------------------------------------------------------------------
 * **The bearer fallback is a scan, and that is a deliberate cost.** A fallback secret is a random
 * string that names no runner — AH.2 sealed it as an AD.1 envelope and gave it no lookup column —
 * so matching one means opening each eligible runner's envelope and comparing in constant time.
 * The candidates are bounded by everything that makes a runner eligible at all: enrolled with the
 * fallback, not removed, in a workspace whose setting still permits it (off by default). A
 * presented value that is not even the shape of a secret is refused before any envelope is
 * opened. The day a fallback fleet is large enough for the scan to matter is the day to add a
 * keyed digest column; until then the weaker mode stays the more expensive one to attempt, which
 * is not the worst property for it to have.
 */

import { Injectable, Logger } from "@nestjs/common";
import type { IncomingMessage } from "node:http";

import { AppConfigService } from "../../config/config.service";
import type { DomainError } from "../../errors/error.envelope";
import { describeForLog } from "../../errors/failure";
import { VaultService } from "../../vault/vault.service";
import type { Runner } from "../../db/schema";
import { clientCertificate } from "../client.certificate";
import { clientCertificateRequired, identityRefused } from "../farm.errors";
import { verifySecret } from "../farm.tokens";
import { RunnerIdentityService } from "../runner.identity";
import type { SecurityMode } from "../protocol/protocol.messages";
import { AgentGatewayRepository } from "./gateway.repository";
import type { RefusalReason } from "./gateway.metrics";

/** What a connection proved before it was upgraded. */
export interface Transport {
  /** The runner row, as it stood at the handshake. */
  readonly runner: Runner;
  /** How it authenticated — the fact a `hello`'s `security_mode` claim is held to. */
  readonly mode: SecurityMode;
}

/** An upgrade that is refused, and how to answer it. */
export interface TransportRefusal {
  /** The HTTP answer: AH.2's error, in the service's `{code, message, details}` envelope. */
  readonly error: DomainError;
  /** Which counter it goes in. */
  readonly reason: Extract<RefusalReason, "no_certificate" | "identity">;
}

/** A bearer fallback secret's exact shape: 32 random bytes, base64url, unpadded. */
const BEARER_SECRET = /^[A-Za-z0-9_-]{43}$/;

/** `Authorization: Bearer <value>` — the scheme is case-insensitive (RFC 9110 § 11.1). */
const BEARER_HEADER = /^bearer +(\S+)$/i;

@Injectable()
export class TransportAuthenticator {
  private readonly logger = new Logger(TransportAuthenticator.name);

  /**
   * @param identity - AH.2's handshake check.
   * @param repository - For the fallback's candidates.
   * @param vault - To open a fallback secret's envelope.
   * @param config - Which header, if any, a trusted proxy forwards the certificate in.
   */
  constructor(
    private readonly identity: RunnerIdentityService,
    private readonly repository: AgentGatewayRepository,
    private readonly vault: VaultService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Authenticate an upgrade request.
   *
   * @param request - The upgrade request.
   * @returns The transport, or the refusal. A certificate, when one was presented, is the only
   *   thing looked at: a connection offering both is judged on the stronger.
   */
  async authenticate(request: IncomingMessage): Promise<Transport | TransportRefusal> {
    const presented = clientCertificate(request, this.config.farmClientCertHeader);

    if (presented) {
      const identity = await this.identity.authenticate(presented);

      return identity
        ? { runner: identity.runner, mode: "mtls" }
        : { error: identityRefused(), reason: "identity" };
    }

    const bearer = bearerOf(request);
    if (bearer === undefined) {
      return { error: clientCertificateRequired(), reason: "no_certificate" };
    }

    const runner = BEARER_SECRET.test(bearer) ? await this.matchBearer(bearer) : undefined;

    return runner
      ? { runner, mode: "bearer_fallback" }
      : { error: identityRefused(), reason: "identity" };
  }

  /**
   * Find the fallback runner a secret belongs to.
   *
   * Every candidate is opened, including after a match would have been found, so the time this
   * takes says nothing about *which* runner — or whether any — matched. An envelope that will not
   * open is logged and skipped: one runner's damaged row must not lock every other fallback
   * runner out of the farm.
   *
   * @param bearer - The presented secret.
   * @returns The runner, or `undefined`.
   */
  private async matchBearer(bearer: string): Promise<Runner | undefined> {
    let matched: Runner | undefined;

    for (const candidate of await this.repository.bearerCandidates()) {
      if (!candidate.bearer_sealed) continue;

      try {
        const sealed = await this.vault.decryptText(
          candidate.organization_id,
          candidate.id,
          candidate.bearer_sealed,
        );

        if (verifySecret(bearer, sealed) && !matched) matched = candidate;
      } catch (error) {
        this.logger.warn(
          `Runner ${candidate.id}'s bearer secret could not be opened; skipping it.`,
          describeForLog(error),
        );
      }
    }

    return matched;
  }
}

/**
 * The bearer secret on an upgrade request.
 *
 * @param request - The upgrade request.
 * @returns The secret, or `undefined` when there is no `Authorization: Bearer` header — or more
 *   than one, which Node joins and this refuses to guess between.
 */
function bearerOf(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== "string") return undefined;

  return BEARER_HEADER.exec(header.trim())?.[1];
}

/**
 * Whether an authentication answer is a refusal.
 *
 * @param verdict - What {@link TransportAuthenticator.authenticate} answered.
 * @returns True for a refusal.
 */
export function isRefusal(verdict: Transport | TransportRefusal): verdict is TransportRefusal {
  return "error" in verdict;
}
