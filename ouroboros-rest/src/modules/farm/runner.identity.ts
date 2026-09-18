/**
 * *Is this certificate a live runner identity of this farm?* — the question AH.3's gateway
 * asks at every handshake, answered here so that there is one answer.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)); the gateway is AH.3
 * ([#251](https://github.com/NobuData/ouroboros/issues/251)) and the renewal endpoint in this
 * module is its first caller. The issue's third acceptance criterion is that *a revoked
 * certificate is refused at handshake, tested against the gateway rather than asserted* — and
 * the gateway does not exist yet. So the check lives here, on the authenticated surface AH.2
 * does ship, with a suite that drives it against certificates this service genuinely issued
 * and then genuinely revoked. AH.3 calls this method; it does not write a second one.
 *
 * ```
 * presented certificate
 *      │
 *      ├─ parse ................... a certificate at all?
 *      ├─ subject O and CN ........ which workspace, which runner?
 *      ├─ within its window? ...... not-before / not-after, against the clock
 *      ├─ signed by that
 *      │   workspace's CA? ........ crypto.verify, against the row in farm_authorities
 *      ├─ serial known? ........... runner_certificates, scoped to that workspace
 *      ├─ revoked or superseded? .. THE CHECK — refused either way
 *      └─ runner still active? .... a removed runner is not an identity
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Every step is a refusal and none of them is a different refusal.** The caller gets one
 * answer — `undefined` — for a certificate that is unparseable, one signed by somebody else's
 * CA, one whose serial was never issued, one that expired, one that a renewal superseded, one
 * that was revoked this morning, and one whose runner has been removed. `farm.errors.ts`
 * argues the general form of this; here the specific point is that *revoked* and *unknown*
 * must be indistinguishable from outside, because the difference tells a caller holding a
 * stolen certificate whether the theft has been noticed.
 *
 * The audit trail and the agent's own close code are where the distinction lives. The
 * protocol's `identity.revoked` (`docs/RUNNER_PROTOCOL.md` § 3) is sent to a runner that has
 * already authenticated once and is being told to stop retrying; it is a message to a machine
 * the farm knows, not to a stranger.
 *
 * ---------------------------------------------------------------------------
 * **The workspace comes from the certificate, and that is safe precisely because the
 * signature is checked against that workspace's CA.** A forged certificate claiming
 * `O=somebody-else` is looked up against somebody-else's authority and fails to verify; there
 * is no path in which a claimed workspace is believed before it is proved. It is the same
 * shape `farm.repository.ts`'s one unscoped read has, for the same reason.
 */

import { Inject, Injectable } from "@nestjs/common";
import { X509Certificate } from "node:crypto";

import type { FarmAuthority, Runner, RunnerCertificate } from "../db/schema";
import { FARM_CLOCK, type FarmClock } from "./farm.authority";
import { FarmRepository } from "./farm.repository";
import { RUNNER_UNIT } from "./x509/name";

/** A runner that has proved who it is. */
export interface RunnerIdentity {
  /** The runner row. */
  readonly runner: Runner;
  /** The certificate it presented, as this service issued it. */
  readonly certificate: RunnerCertificate;
  /** The workspace's authority, so a caller that is about to re-sign does not read it twice. */
  readonly authority: FarmAuthority;
}

/** The attributes of a subject this service composed — see `x509/name.ts`. */
interface Subject {
  /** `CN` — the runner's id. */
  readonly commonName: string;
  /** `O` — the workspace's id. */
  readonly organization: string;
  /** `OU` — which kind of certificate. */
  readonly unit: string;
}

@Injectable()
export class RunnerIdentityService {
  /**
   * @param farm - The statements. Two reads on this path, both indexed.
   * @param now - The clock, so a suite can place a window on either side of the present.
   */
  constructor(
    private readonly farm: FarmRepository,
    @Inject(FARM_CLOCK) private readonly now: FarmClock,
  ) {}

  /**
   * Resolve a presented certificate to the runner it identifies, or refuse.
   *
   * @param pem - What the peer presented, from `client.certificate.ts`.
   * @returns The identity, or `undefined` for every one of the seven refusals in this file's
   *   header. There is deliberately no second return channel saying which.
   */
  async authenticate(pem: string): Promise<RunnerIdentity | undefined> {
    const parsed = this.parse(pem);
    if (!parsed) return undefined;

    const subject = this.subjectOf(parsed);
    if (!subject || subject.unit !== RUNNER_UNIT) return undefined;

    const authority = await this.farm.authorityOf(subject.organization);
    if (!authority) return undefined;

    if (!this.signedByAuthority(parsed, authority)) return undefined;

    // Lowercase, because `X509Certificate.serialNumber` is upper-case hex and this schema
    // stores lower. A comparison that got this wrong would refuse every certificate, which is
    // the failure mode to prefer — but it would refuse them for the wrong reason.
    const certificate = await this.farm.certificateBySerial(
      subject.organization,
      parsed.serialNumber.toLowerCase(),
    );

    // **The revocation check**, and the superseded check beside it. A certificate a renewal
    // replaced is still cryptographically valid and is still not the one this runner should be
    // presenting, so both end here.
    if (!certificate || certificate.revoked || certificate.superseded_at) return undefined;

    const runner = await this.farm.runnerById(subject.organization, certificate.runner_id);

    // A removed runner is not an identity. Its row survives — its builds reference it — and
    // `desired_state` is what an operator decided, so this reads the intent rather than the
    // observation: a machine that is merely `offline` is one that will come back.
    if (!runner || runner.desired_state === "removed") return undefined;

    return { runner, certificate, authority };
  }

  /**
   * Parse a presented certificate and check its own validity window.
   *
   * @param pem - The PEM.
   * @returns The parsed certificate, or `undefined` when it is not one or is outside its
   *   window. Node's own parser, never a hand-written one — `x509/reader.ts` is deliberately
   *   the only parsing in this module and it does not read certificates.
   */
  private parse(pem: string): X509Certificate | undefined {
    let certificate: X509Certificate;

    try {
      certificate = new X509Certificate(pem);
    } catch {
      return undefined;
    }

    const at = this.now().getTime();
    const from = Date.parse(certificate.validFrom);
    const to = Date.parse(certificate.validTo);

    if (Number.isNaN(from) || Number.isNaN(to) || at < from || at > to) return undefined;

    return certificate;
  }

  /**
   * The three attributes of a subject this CA composed.
   *
   * `X509Certificate.subject` is a newline-separated list of `TYPE=value`, which is Node's
   * rendering rather than a structure — so this reads it back rather than re-deriving it. The
   * values cannot contain a newline: they are ids composed by `x509/name.ts` from a UUID and a
   * BetterAuth id, and a certificate whose subject looks otherwise fails the signature check
   * before its shape could matter.
   *
   * @param certificate - The parsed certificate.
   * @returns The attributes, or `undefined` when any of the three is missing.
   */
  private subjectOf(certificate: X509Certificate): Subject | undefined {
    const fields = new Map<string, string>();

    for (const line of certificate.subject.split("\n")) {
      const at = line.indexOf("=");
      if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
    }

    const commonName = fields.get("CN");
    const organization = fields.get("O");
    const unit = fields.get("OU");

    if (!commonName || !organization || !unit) return undefined;

    return { commonName, organization, unit };
  }

  /**
   * Was this certificate signed by that workspace's own authority?
   *
   * The step that makes reading the workspace out of the subject safe. `verify` checks the
   * signature against the CA's public key; `checkIssued` checks that the issuer name matches,
   * which on its own proves nothing and which together with the signature is what a chain of
   * length two amounts to.
   *
   * @param certificate - The presented certificate.
   * @param authority - The workspace's CA row.
   * @returns Whether it verifies.
   */
  private signedByAuthority(certificate: X509Certificate, authority: FarmAuthority): boolean {
    try {
      const issuer = new X509Certificate(authority.certificate_pem);

      // `X509Certificate.publicKey` is already a public `KeyObject`; passing it through
      // `createPublicKey` throws, which a suite caught before this shipped.
      return certificate.checkIssued(issuer) && certificate.verify(issuer.publicKey);
    } catch {
      return false;
    }
  }
}
