import { X509Certificate, createPrivateKey } from "node:crypto";

import type { VaultService } from "../vault/vault.service";
import { FarmAuthorityService } from "./farm.authority";
import type { FarmRepository } from "./farm.repository";
import { AUTHORITY_LIFETIME_MS, CERTIFICATE_LIFETIME_MS } from "./farm.policy";
import { authoritySubject } from "./x509/name";
import { fromPem } from "./x509/pem";
import {
  authority,
  keypair,
  privateKeyPem,
  FIXTURE_NOW,
  FIXTURE_ORGANIZATION,
  FIXTURE_RUNNER,
  FIXTURE_SEALED,
} from "./farm.fixture";

/**
 * The CA, and the claim the whole module is arranged around: **the private key is opened for
 * one signature and is destroyed**.
 *
 * The vault is a stub here, which is the right seam — AD.1's own suites prove the envelope
 * works, and what is being asserted here is *how this service uses it*: that the sealed column
 * is what is stored, that the plaintext buffer is zeroized, and that nothing this class
 * returns contains a key.
 */

/** The vault, reduced to the three methods this service calls. */
function vault(opened: Buffer): { service: VaultService; sealed: string[]; handedOut: Buffer[] } {
  const sealed: string[] = [];
  const handedOut: Buffer[] = [];

  const service = {
    encrypt: jest.fn((_organization: string, _record: string, plaintext: Buffer) => {
      sealed.push(plaintext.toString("utf8"));

      return Promise.resolve(FIXTURE_SEALED);
    }),
    decrypt: jest.fn(() => {
      // A fresh copy per call, as `VaultService` returns: the caller owns it and is expected to
      // zeroize it, and handing the same buffer back twice would hide a failure to.
      const copy = Buffer.from(opened);
      handedOut.push(copy);

      return Promise.resolve(copy);
    }),
  } as unknown as VaultService;

  return { service, sealed, handedOut };
}

/** The repository, reduced to the two methods this service calls. */
function repository(existing?: ReturnType<typeof authority>["row"]): {
  farm: FarmRepository;
  inserted: unknown[];
} {
  const inserted: unknown[] = [];

  const farm = {
    authorityOf: jest.fn(() => Promise.resolve(existing)),
    insertAuthority: jest.fn((row: unknown) => {
      inserted.push(row);

      return Promise.resolve(row);
    }),
  } as unknown as FarmRepository;

  return { farm, inserted };
}

describe("creating a workspace's authority", () => {
  it("is lazy — nothing is generated until a machine enrols", async () => {
    // Most workspaces never run a build farm, and a CA generated for every one of them is a key
    // per workspace that exists only to be a liability.
    const existing = authority();
    const { farm } = repository(existing.row);
    const { service } = vault(Buffer.alloc(0));

    const service_ = new FarmAuthorityService(farm, service, () => FIXTURE_NOW);

    expect(await service_.ensure(FIXTURE_ORGANIZATION)).toEqual(existing.row);
    expect(farm.insertAuthority).not.toHaveBeenCalled();
  });

  it("seals the key and stores the certificate", async () => {
    const { farm, inserted } = repository();
    const { service, sealed } = vault(Buffer.alloc(0));

    const created = await new FarmAuthorityService(farm, service, () => FIXTURE_NOW).ensure(
      FIXTURE_ORGANIZATION,
    );

    expect(created.key_sealed).toBe(FIXTURE_SEALED);
    // What was sealed is a PKCS#8 private key, which is what `createPrivateKey` can read back.
    expect(() => createPrivateKey(sealed[0])).not.toThrow();
    expect(inserted).toHaveLength(1);
  });

  it("signs itself, with the subject `name.ts` composes", async () => {
    const { farm } = repository();
    const { service } = vault(Buffer.alloc(0));

    const created = await new FarmAuthorityService(farm, service, () => FIXTURE_NOW).ensure(
      FIXTURE_ORGANIZATION,
    );
    const parsed = new X509Certificate(created.certificate_pem);

    expect(parsed.ca).toBe(true);
    expect(parsed.subject).toContain(authoritySubject(FIXTURE_ORGANIZATION).commonName);
    expect(parsed.issuer).toBe(parsed.subject);
  });

  it("lives for the policy's ten years", async () => {
    const { farm } = repository();
    const { service } = vault(Buffer.alloc(0));

    const created = await new FarmAuthorityService(farm, service, () => FIXTURE_NOW).ensure(
      FIXTURE_ORGANIZATION,
    );

    expect(created.not_after.getTime() - FIXTURE_NOW.getTime()).toBe(AUTHORITY_LIFETIME_MS);
  });

  it("seals against the workspace's own id, so a sealed key cannot be lifted elsewhere", async () => {
    // There is one authority per workspace and therefore no other identifier to bind to; the
    // AAD is what stops a sealed key being pasted into another workspace's row.
    const { farm } = repository();
    const { service } = vault(Buffer.alloc(0));

    await new FarmAuthorityService(farm, service, () => FIXTURE_NOW).ensure(FIXTURE_ORGANIZATION);

    expect(service.encrypt).toHaveBeenCalledWith(
      FIXTURE_ORGANIZATION,
      FIXTURE_ORGANIZATION,
      expect.any(Buffer),
    );
  });
});

describe("signing a runner's certificate", () => {
  const issuer = authority();
  const opened = Buffer.from(privateKeyPem(issuer.privateKey), "utf8");

  it("produces a certificate the authority verifies", async () => {
    const { farm } = repository(issuer.row);
    const { service } = vault(opened);

    const signed = await new FarmAuthorityService(farm, service, () => FIXTURE_NOW).sign(
      issuer.row,
      FIXTURE_RUNNER,
      keypair().publicKey,
    );

    const parsed = new X509Certificate(signed.pem);
    const ca = new X509Certificate(issuer.pem);

    expect(parsed.verify(ca.publicKey)).toBe(true);
    expect(parsed.ca).toBe(false);
    expect(parsed.subject).toContain(`CN=${FIXTURE_RUNNER}`);
  });

  it("lives for the policy's ninety days", async () => {
    const { farm } = repository(issuer.row);
    const { service } = vault(opened);

    const signed = await new FarmAuthorityService(farm, service, () => FIXTURE_NOW).sign(
      issuer.row,
      FIXTURE_RUNNER,
      keypair().publicKey,
    );

    expect(signed.notAfter.getTime() - FIXTURE_NOW.getTime()).toBe(CERTIFICATE_LIFETIME_MS);
  });

  it("ZEROIZES the opened key, every time", async () => {
    // The claim in this module's header, asserted rather than stated. `VaultService` hands the
    // caller a buffer it owns; this is what makes "opened for one signature" true.
    const { farm } = repository(issuer.row);
    const { service, handedOut } = vault(opened);

    const subject = new FarmAuthorityService(farm, service, () => FIXTURE_NOW);
    await subject.sign(issuer.row, FIXTURE_RUNNER, keypair().publicKey);
    await subject.sign(issuer.row, FIXTURE_RUNNER, keypair().publicKey);

    expect(handedOut).toHaveLength(2);
    for (const buffer of handedOut) expect(buffer.every((byte) => byte === 0)).toBe(true);
  });

  it("zeroizes even when the signature throws", async () => {
    // The `finally`. A failure that left the plaintext live would be the one case where the
    // guarantee mattered most.
    const { farm } = repository(issuer.row);
    const { service, handedOut } = vault(Buffer.from("not a key at all", "utf8"));

    await expect(
      new FarmAuthorityService(farm, service, () => FIXTURE_NOW).sign(
        issuer.row,
        FIXTURE_RUNNER,
        keypair().publicKey,
      ),
    ).rejects.toThrow();

    expect(handedOut[0]?.every((byte) => byte === 0)).toBe(true);
  });

  it("returns the certificate and its identifiers — and nothing that is a key", async () => {
    const { farm } = repository(issuer.row);
    const { service } = vault(opened);

    const signed = await new FarmAuthorityService(farm, service, () => FIXTURE_NOW).sign(
      issuer.row,
      FIXTURE_RUNNER,
      keypair().publicKey,
    );

    expect(Object.keys(signed).sort()).toEqual([
      "fingerprint",
      "notAfter",
      "notBefore",
      "pem",
      "serial",
    ]);
    expect(signed.pem).not.toContain("PRIVATE KEY");
    expect(() => fromPem("CERTIFICATE", signed.pem)).not.toThrow();
  });
});
