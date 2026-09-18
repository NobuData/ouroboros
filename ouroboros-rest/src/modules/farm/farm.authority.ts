/**
 * The farm certificate authority — the one file in this service that may hold a CA private
 * key, and the reason `ouroboros/no-ca-key-escape` exempts exactly one file.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)), decision **B3**.
 *
 * ```
 * ensure(workspace) ─▶ no row?  generate P-256 ─▶ self-sign ─▶ seal via AD.1 ─▶ insert
 *                   ─▶ a row?   return it, and nothing is unwrapped at all
 *
 * sign(workspace, public key, subject)
 *        │
 *        └─ withAuthorityKey ─▶ VaultService.decrypt ─▶ KeyObject ─▶ one signature ─▶ zeroize
 *                                                                          │
 *                                                                          └─▶ certificate
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The key is unwrapped per signature and nothing caches it.** That is `VaultService`'s own
 * posture — see its header on why it holds no DEK cache — applied one layer up, and for the
 * stronger of the two reasons it gives there: deleting a workspace destroys its DEK, and a CA
 * key living in a process after its workspace was deleted is a window in which the
 * crypto-shred has not happened. Enrollment is a once-per-machine operation, so the cost of
 * not caching is one AES operation on a path that runs a handful of times a day.
 *
 * ---------------------------------------------------------------------------
 * **What "never leaves" means precisely, because it is a claim worth being exact about.**
 *
 *   * The sealed form is the only form in the database. `farm_authorities_key_sealed` refuses
 *     any other shape, so a row holding a plaintext key cannot exist — whoever the writer is.
 *   * The unsealed bytes exist in a `Buffer` for the duration of one call and are zeroized in
 *     a `finally`. What outlives that call is a `KeyObject`, which is a handle to key material
 *     held by OpenSSL — **that cannot be zeroized by this code**, and it is held for the
 *     duration of one signature and then dropped, which is the honest statement rather than
 *     the stronger one. `vault/vault.service.ts` makes the same distinction about its
 *     `…Text` methods.
 *   * No method here returns one, and no name for one exists in any other file — which is a
 *     lint rule rather than a convention.
 *   * Nothing here logs. There is no logger in this file at all, and
 *     `farm.secrecy.spec.ts` reads this file's source to keep it that way.
 *
 * What it does **not** mean is that an operator with database access and the master key
 * cannot open it. That is decision **AD.1**'s custody model, not this module's, and
 * `SECURITY_MODEL.md` § 3 is where it is written down honestly.
 *
 * ---------------------------------------------------------------------------
 * **The authority is created lazily, on the first enrollment.** Not at workspace creation:
 * most workspaces never run a build farm, and a CA generated for every one of them is a key
 * per workspace that exists only to be a liability. The race two simultaneous first
 * enrollments produce is settled by the primary key — see `FarmRepository.insertAuthority`.
 */

import { Inject, Injectable } from "@nestjs/common";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";

import { VaultService } from "../vault/vault.service";
import type { FarmAuthority } from "../db/schema";
import { FarmRepository } from "./farm.repository";
import { authorityWindow, certificateWindow } from "./farm.policy";
import {
  CURVE,
  issueRunnerCertificate,
  newSerial,
  runnerUri,
  selfSignedAuthority,
  type IssuedCertificate,
} from "./x509/certificate";
import { authoritySubject, runnerSubject } from "./x509/name";
import { fromPem, toPem } from "./x509/pem";

/** The PEM label a certificate is carried in. */
export const CERTIFICATE_LABEL = "CERTIFICATE";

/**
 * The PEM label the CA's own key is sealed as.
 *
 * PKCS#8 rather than SEC1, because it carries the algorithm identifier with the key and is
 * therefore self-describing — `createPrivateKey` needs no `namedCurve` hint to read one back,
 * so a future curve change is a change in one place.
 */
const AUTHORITY_KEY_LABEL = "PRIVATE KEY";

/**
 * How the clock is read.
 *
 * Injected rather than called, so every suite in this module can place an expiry on either
 * side of "now" without waiting for one — the same seam `ouroboros-rest` uses wherever a
 * window is compared against the present.
 */
export const FARM_CLOCK = "ouroboros:farm:clock";

/** What the clock provides. */
export type FarmClock = () => Date;

/** A signed runner certificate, with what the caller has to store beside it. */
export interface SignedRunnerCertificate {
  /** The certificate, PEM, as it goes back to the agent and into no column. */
  readonly pem: string;
  /** Its serial, lowercase hex. */
  readonly serial: string;
  /** `sha256` over its DER, lowercase hex. */
  readonly fingerprint: string;
  /** The start of its validity. */
  readonly notBefore: Date;
  /** The end of it. */
  readonly notAfter: Date;
}

@Injectable()
export class FarmAuthorityService {
  /**
   * @param farm - The statements. This service reads and writes exactly one table through
   *   it — `farm_authorities` — and never reaches for a runner or a token.
   * @param vault - AD.1's ([#222](https://github.com/NobuData/ouroboros/issues/222)) envelope
   *   encryption. Nothing here implements cryptography of its own; V041's own CHECK is what
   *   makes that true of every other writer too.
   * @param now - The clock.
   */
  constructor(
    private readonly farm: FarmRepository,
    private readonly vault: VaultService,
    @Inject(FARM_CLOCK) private readonly now: FarmClock,
  ) {}

  /**
   * The workspace's authority, creating it if this is the first machine to enrol.
   *
   * @param organizationId - The workspace.
   * @returns The row. Its `key_sealed` column is present on the object — it is a row — and is
   *   read by nothing outside this file, which the lint rule is what enforces.
   */
  async ensure(organizationId: string): Promise<FarmAuthority> {
    const existing = await this.farm.authorityOf(organizationId);
    if (existing) return existing;

    return this.create(organizationId);
  }

  /**
   * Generate, self-sign and seal a workspace's authority.
   *
   * @param organizationId - The workspace.
   * @returns Whichever row is the workspace's once this returns — this one, or the one a
   *   simultaneous first enrollment inserted first. Either is a usable CA; what must not
   *   happen is two.
   */
  private async create(organizationId: string): Promise<FarmAuthority> {
    const pair = generateKeyPairSync("ec", { namedCurve: CURVE });
    const window = authorityWindow(this.now());

    const certificate = selfSignedAuthority(
      {
        subject: authoritySubject(organizationId),
        privateKey: pair.privateKey,
        publicKey: pair.publicKey,
        notBefore: window.notBefore,
        notAfter: window.notAfter,
      },
      newSerial(),
    );

    // Sealed against the workspace's *own id* as the record id, because there is one authority
    // per workspace and therefore no other identifier to bind to. The AAD is what stops a
    // sealed key being lifted into another workspace's row — see `vault/envelope.ts`.
    const sealed = await this.vault.encrypt(
      organizationId,
      organizationId,
      Buffer.from(
        toPem(AUTHORITY_KEY_LABEL, pair.privateKey.export({ type: "pkcs8", format: "der" })),
        "utf8",
      ),
    );

    return this.farm.insertAuthority({
      organization_id: organizationId,
      certificate_pem: toPem(CERTIFICATE_LABEL, certificate.der),
      key_sealed: sealed,
      serial: certificate.serial,
      fingerprint: certificate.fingerprint,
      not_before: certificate.notBefore,
      not_after: certificate.notAfter,
    });
  }

  /**
   * Sign a runner's client certificate.
   *
   * @param authority - The workspace's authority, from {@link ensure}.
   * @param runnerId - The runner the certificate names. The subject is composed from this and
   *   the workspace — never from the request — which is what makes a CSR's own claims
   *   irrelevant rather than merely ignored. See `x509/csr.ts`.
   * @param publicKey - The key to certify, as `csr.ts` re-derived it.
   * @returns The certificate and the three things stored beside it.
   */
  async sign(
    authority: FarmAuthority,
    runnerId: string,
    publicKey: KeyObject,
  ): Promise<SignedRunnerCertificate> {
    const window = certificateWindow(this.now());

    const issued = await this.withAuthorityKey(authority, (signer) =>
      issueRunnerCertificate(
        {
          subject: runnerSubject(runnerId, authority.organization_id),
          issuer: authoritySubject(authority.organization_id),
          publicKey,
          authorityKey: signer,
          authorityPublicKey: createPublicKey(signer),
          notBefore: window.notBefore,
          notAfter: window.notAfter,
          uri: runnerUri(authority.organization_id, runnerId),
        },
        newSerial(),
      ),
    );

    return {
      pem: toPem(CERTIFICATE_LABEL, issued.der),
      serial: issued.serial,
      fingerprint: issued.fingerprint,
      notBefore: issued.notBefore,
      notAfter: issued.notAfter,
    };
  }

  /**
   * Open the authority's key, hand it to one callback, and destroy the plaintext.
   *
   * The shape is `VaultService.withDek`'s, for its reason: a method that *returned* the key
   * would be a method whose result a caller could hold past the request that needed it, which
   * is the state the argument in this file's header is written against. Nothing outside this
   * class can call it, and nothing inside it lets the `KeyObject` escape the callback.
   *
   * @param authority - The workspace's authority row.
   * @param use - What to do with the key. Synchronous on purpose: an `async` callback could
   *   be suspended with the plaintext still live, and the `finally` below would run while it
   *   was still needed.
   * @returns Whatever the callback returned.
   */
  private async withAuthorityKey<T>(
    authority: FarmAuthority,
    use: (signer: KeyObject) => T,
  ): Promise<T> {
    const opened = await this.vault.decrypt(
      authority.organization_id,
      authority.organization_id,
      authority.key_sealed,
    );

    try {
      // Through the PEM and back into a `KeyObject`. The intermediate string is a copy this
      // code cannot erase — JavaScript strings are immutable — which is the same weaker
      // guarantee `VaultService`'s `…Text` methods document rather than paper over. The DER is
      // what the buffer holds and what gets zeroized.
      const signer = createPrivateKey({
        key: fromPem(AUTHORITY_KEY_LABEL, opened.toString("utf8")),
        format: "der",
        type: "pkcs8",
      });

      return use(signer);
    } finally {
      opened.fill(0);
    }
  }
}

/** Re-exported so callers do not import the x509 layer to name a certificate's parts. */
export type { IssuedCertificate };
