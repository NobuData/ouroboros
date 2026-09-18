import { X509Certificate } from "node:crypto";

import type { AuditService } from "../audit/audit.service";
import type { AuditRecord } from "../audit/audit.events";
import type { EnrollmentToken, RunnerPool } from "../db/schema";
import type { VaultService } from "../vault/vault.service";
import { FarmAudit } from "./farm.audit";
import { FarmAuthorityService } from "./farm.authority";
import type { FarmRepository, EnrollmentWrite } from "./farm.repository";
import { mintToken } from "./farm.tokens";
import { RegistrationService } from "./registration.service";
import {
  authority,
  certificate,
  certificationRequest,
  keypair,
  privateKeyPem,
  runner,
  FIXTURE_NOW,
  FIXTURE_ORGANIZATION,
  FIXTURE_SEALED,
} from "./farm.fixture";

/**
 * Enrollment, end to end, against real cryptography — which is where most of AH.2's
 * acceptance criteria live:
 *
 *   * a token's TTL and use count are enforced, and a second use of a single-use token fails;
 *   * a token scoped to `pool-a` cannot enrol into `pool-b`;
 *   * a token cannot enrol into another organization;
 *   * the bearer fallback needs the org setting and is recorded in `security_mode`;
 *   * every operation writes an audit row, refusals included;
 *   * renewal works over the authenticated channel with no second token.
 *
 * The CA is real, the CSR is real and the certificate that comes out is verified against the
 * authority by OpenSSL. What is stubbed is the vault (AD.1 proves its own envelope) and the
 * repository (`farm.repository.spec.ts` proves its statements).
 */

const ISSUER = authority();
const TOKEN_ID = "7f3a9c1e-4b0d-4e2a-8f6b-5c3d1e0f2a4b";
const SECRET = "a-secret-long-enough-to-be-one-abcdefgh";
const TOKEN = mintToken(TOKEN_ID, SECRET);

const POOL: RunnerPool = {
  id: "5eed0024-0000-4000-8000-000000000001",
  organization_id: FIXTURE_ORGANIZATION,
  name: "pool-a",
  executor: "container",
  image: "img:0.17",
  description: null,
  env_allowlist: [],
  max_concurrency: 1,
  enabled: true,
  autoscale_pref: {},
  tags: [],
  created_at: FIXTURE_NOW,
  updated_at: FIXTURE_NOW,
};

/**
 * A token row.
 *
 * @param overrides - What this test is varying.
 * @returns The row.
 */
function tokenRow(overrides: Partial<EnrollmentToken> = {}): EnrollmentToken {
  return {
    id: TOKEN_ID,
    organization_id: FIXTURE_ORGANIZATION,
    pool_id: POOL.id,
    token_sealed: FIXTURE_SEALED,
    expires_at: new Date(FIXTURE_NOW.getTime() + 86_400_000),
    max_uses: 5,
    uses: 0,
    revoked: false,
    revoked_at: null,
    created_by: "user_ken",
    created_at: FIXTURE_NOW,
    ...overrides,
  };
}

/** What a test builds: the service, and everything it wrote. */
interface Subject {
  service: RegistrationService;
  written: AuditRecord[];
  enrolled: EnrollmentWrite[];
  farm: FarmRepository;
}

/**
 * Build the service over stubs a test can steer.
 *
 * @param options - The token row, the fallback setting, and whether the write succeeds.
 * @returns The subject.
 */
function subject(
  options: {
    token?: EnrollmentToken | undefined;
    fallback?: boolean;
    spent?: boolean;
    pool?: RunnerPool | undefined;
  } = {},
): Subject {
  const written: AuditRecord[] = [];
  const enrolled: EnrollmentWrite[] = [];

  const farm = {
    tokenById: jest.fn(() => Promise.resolve("token" in options ? options.token : tokenRow())),
    poolById: jest.fn(() => Promise.resolve("pool" in options ? options.pool : POOL)),
    bearerFallbackPermitted: jest.fn(() => Promise.resolve(options.fallback ?? false)),
    authorityOf: jest.fn(() => Promise.resolve(ISSUER.row)),
    insertAuthority: jest.fn(() => Promise.resolve(ISSUER.row)),
    enrol: jest.fn((write: EnrollmentWrite) => {
      enrolled.push(write);

      return Promise.resolve(options.spent ? undefined : runner({ ...write.runner }));
    }),
    renew: jest.fn(() => Promise.resolve(certificate(ISSUER).row)),
    runnerById: jest.fn(() => Promise.resolve(runner())),
    liveCertificate: jest.fn(() => Promise.resolve(certificate(ISSUER).row)),
    revokeCertificate: jest.fn(() => Promise.resolve(certificate(ISSUER).row)),
  } as unknown as FarmRepository;

  const opened = Buffer.from(privateKeyPem(ISSUER.privateKey), "utf8");
  const vault = {
    decrypt: jest.fn(() => Promise.resolve(Buffer.from(opened))),
    decryptText: jest.fn(() => Promise.resolve(SECRET)),
    encryptText: jest.fn(() => Promise.resolve(FIXTURE_SEALED)),
  } as unknown as VaultService;

  const auditService = {
    record: jest.fn((event: AuditRecord) => {
      written.push(event);

      return Promise.resolve("event");
    }),
  } as unknown as AuditService;

  const service = new RegistrationService(
    farm,
    new FarmAuthorityService(farm, vault, () => FIXTURE_NOW),
    vault,
    new FarmAudit(auditService),
    () => FIXTURE_NOW,
  );

  return { service, written, enrolled, farm };
}

/** An ordinary registration body. */
function registration(overrides: Record<string, unknown> = {}): never {
  return {
    token: TOKEN.value,
    name: "forge-01",
    arch: "linux/arm64",
    csr: certificationRequest(),
    ...overrides,
  } as never;
}

describe("enrolling a machine", () => {
  it("issues a certificate the workspace's authority verifies", async () => {
    const { service } = subject();

    const enrollment = await service.register(registration());
    const parsed = new X509Certificate(enrollment.certificate as string);

    expect(parsed.verify(new X509Certificate(ISSUER.pem).publicKey)).toBe(true);
    expect(enrollment.securityMode).toBe("mtls");
    expect(enrollment.bearerToken).toBeNull();
  });

  it("names the runner this service created, not what the request claimed", async () => {
    // The CSR's subject is a lie by construction in this fixture.
    const { service, enrolled } = subject();

    const enrollment = await service.register(
      registration({ csr: certificationRequest(keypair(), "somebody-elses-runner") }),
    );
    const parsed = new X509Certificate(enrollment.certificate as string);

    expect(parsed.subject).toContain(`CN=${enrolled[0]?.runner.id}`);
    expect(parsed.subject).not.toContain("somebody-elses-runner");
  });

  it("puts the runner in the TOKEN's workspace — there is no field for another", async () => {
    // AH.2's organization-isolation criterion. The body has no workspace field at all, so this
    // is structural rather than checked.
    const { service, enrolled } = subject();

    await service.register(registration());

    expect(enrolled[0]?.runner.organization_id).toBe(FIXTURE_ORGANIZATION);
    expect(enrolled[0]?.runner.pool_id).toBe(POOL.id);
  });

  it("returns the CA to pin and when to renew", async () => {
    const { service } = subject();

    const enrollment = await service.register(registration());

    expect(enrollment.authority.fingerprint).toBe(ISSUER.row.fingerprint);
    expect(Date.parse(enrollment.renewAfter as string)).toBeLessThan(
      Date.parse(enrollment.notAfter as string),
    );
  });

  it("captures what the agent says it can do", async () => {
    const { service, enrolled } = subject();

    await service.register(registration({ docker: true, cpuCount: 8, agentVersion: "1.0.0" }));

    expect(enrolled[0]?.runner.capabilities).toEqual({ docker: true, cpu_count: 8 });
    expect(enrolled[0]?.runner.agent_version).toBe("1.0.0");
  });

  it("writes an audit row naming the runner and the token that admitted it", async () => {
    const { service, written } = subject();

    await service.register(registration());

    expect(written[0]?.action).toBe("runner.enrolled");
    expect(written[0]?.subjectType).toBe("runner");
    expect(written[0]?.detail?.tokenId).toBe(TOKEN_ID);
    expect(written[0]?.detail?.securityMode).toBe("mtls");
  });
});

describe("the six ways a token is refused", () => {
  /**
   * Assert the refusal, and assert what the trail recorded.
   *
   * @param options - How to steer the stubs.
   * @param refusal - What the trail should say.
   * @param body - The registration, if this test varies it.
   */
  async function refuses(
    options: Parameters<typeof subject>[0],
    refusal: string,
    body = registration(),
  ): Promise<void> {
    const { service, written, enrolled } = subject(options);

    await expect(service.register(body)).rejects.toMatchObject({
      response: { code: "farm_enrollment_refused", details: {} },
    });

    expect(enrolled).toHaveLength(0);
    if (refusal === "unknown_token") {
      expect(written).toHaveLength(0);
    } else {
      expect(written[0]?.detail).toEqual({ outcome: "refused", refusal });
    }
  }

  it("refuses a token that is not even a token", async () => {
    await refuses({}, "unknown_token", registration({ token: "orb_enroll_nonsense" }));
  });

  it("refuses a token that names no row", async () => {
    await refuses({ token: undefined }, "unknown_token");
  });

  it("refuses the right row with the wrong secret", async () => {
    const { service, written } = subject();

    await expect(
      service.register(registration({ token: mintToken(TOKEN_ID, `${SECRET}x`).value })),
    ).rejects.toMatchObject({ response: { code: "farm_enrollment_refused" } });
    expect(written[0]?.detail).toEqual({ outcome: "refused", refusal: "bad_secret" });
  });

  it("ENFORCES THE TTL", async () => {
    await refuses(
      { token: tokenRow({ expires_at: new Date(FIXTURE_NOW.getTime() - 1) }) },
      "expired",
    );
  });

  it("ENFORCES THE USE COUNT — a second use of a single-use token fails", async () => {
    await refuses({ token: tokenRow({ max_uses: 1, uses: 1 }) }, "spent");
  });

  it("refuses a revoked token", async () => {
    await refuses({ token: tokenRow({ revoked: true, revoked_at: FIXTURE_NOW }) }, "revoked");
  });

  it("REFUSES A POOL THE TOKEN IS NOT SCOPED TO", async () => {
    // A token for `pool-a` refuses a registration naming `pool-b` rather than quietly enrolling
    // into `pool-a`: the `--pool` flag is on the one command an operator reads most carefully.
    await refuses({}, "pool_mismatch", registration({ pool: "pool-b" }));
  });

  it("accepts a registration that names the token's own pool", async () => {
    const { service } = subject();

    await expect(service.register(registration({ pool: "pool-a" }))).resolves.toBeDefined();
  });

  it("refuses rather than 404s when a named pool cannot be resolved at all", async () => {
    // A stranger must not learn which pool names exist.
    await refuses({ pool: undefined }, "pool_mismatch", registration({ pool: "pool-a" }));
  });

  it("refuses without spending a use, generating a key or writing a runner", async () => {
    const { service, enrolled, farm } = subject({
      token: tokenRow({ revoked: true, revoked_at: FIXTURE_NOW }),
    });

    await expect(service.register(registration())).rejects.toThrow();

    expect(enrolled).toHaveLength(0);
    expect(farm.insertAuthority).not.toHaveBeenCalled();
  });

  it("loses the race gracefully when the statement's own guard refuses", async () => {
    // Two agents presenting the last use of the same token: both pass the service's check and
    // exactly one updates a row. The loser gets the ordinary refusal.
    const { service, written } = subject({ spent: true });

    await expect(service.register(registration())).rejects.toMatchObject({
      response: { code: "farm_enrollment_refused" },
    });
    expect(written[0]?.detail).toEqual({ outcome: "refused", refusal: "spent" });
  });
});

describe("the certificate request", () => {
  it("is required on the mTLS path", async () => {
    const { service } = subject();

    await expect(service.register(registration({ csr: undefined }))).rejects.toMatchObject({
      response: { code: "farm_invalid_csr" },
    });
  });

  it("is refused with a reason, because its shape is the caller's own business", async () => {
    const { service } = subject();

    await expect(service.register(registration({ csr: "not a csr" }))).rejects.toMatchObject({
      response: { code: "farm_invalid_csr" },
    });
    await expect(service.register(registration({ csr: "not a csr" }))).rejects.toThrow(/PEM/);
  });
});

describe("the bearer fallback", () => {
  it("is refused unless the workspace has switched it on", async () => {
    // Off by default: a deployment that never considers the question never has the weaker path.
    const { service } = subject({ fallback: false });

    await expect(
      service.register(registration({ securityMode: "bearer_fallback", csr: undefined })),
    ).rejects.toMatchObject({ response: { code: "farm_bearer_fallback_not_permitted" } });
  });

  it("issues a secret and RECORDS THE DEGRADED MODE when the workspace permits it", async () => {
    // AI.2 (#257) renders `bearer_fallback` as visibly degraded. A security downgrade nobody
    // can see is the worst of both designs.
    const { service, enrolled } = subject({ fallback: true });

    const enrollment = await service.register(
      registration({ securityMode: "bearer_fallback", csr: undefined }),
    );

    expect(enrollment.securityMode).toBe("bearer_fallback");
    expect(enrollment.bearerToken).toEqual(expect.any(String));
    expect(enrollment.certificate).toBeNull();
    expect(enrolled[0]?.runner.security_mode).toBe("bearer_fallback");
    expect(enrolled[0]?.runner.cert_serial).toBeNull();
    expect(enrolled[0]?.certificate).toBeUndefined();
  });

  it("seals the secret rather than storing it", async () => {
    const { service, enrolled } = subject({ fallback: true });

    const enrollment = await service.register(
      registration({ securityMode: "bearer_fallback", csr: undefined }),
    );

    expect(enrolled[0]?.runner.bearer_sealed).toBe(FIXTURE_SEALED);
    expect(JSON.stringify(enrolled)).not.toContain(enrollment.bearerToken);
  });

  it("still returns the CA, because the agent verifies the server's certificate", async () => {
    const { service } = subject({ fallback: true });

    const enrollment = await service.register(
      registration({ securityMode: "bearer_fallback", csr: undefined }),
    );

    expect(enrollment.authority.fingerprint).toBe(ISSUER.row.fingerprint);
  });

  it("records the degraded mode in the trail too", async () => {
    const { service, written } = subject({ fallback: true });

    await service.register(registration({ securityMode: "bearer_fallback", csr: undefined }));

    expect(written[0]?.detail?.securityMode).toBe("bearer_fallback");
    expect(written[0]?.detail?.serial).toBeNull();
  });
});

describe("renewal", () => {
  it("needs no enrollment token — the identity is the certificate", async () => {
    // The issue's *renewal over the already-authenticated channel*. The body has no token
    // field, so a renewal cannot be performed by anything holding only a token.
    const { service, farm } = subject();
    const live = certificate(ISSUER);

    const renewed = await service.renew(
      { runner: runner(), certificate: live.row, authority: ISSUER.row },
      { csr: certificationRequest() },
    );

    expect(
      new X509Certificate(renewed.certificate).verify(new X509Certificate(ISSUER.pem).publicKey),
    ).toBe(true);
    expect(farm.tokenById).not.toHaveBeenCalled();
  });

  it("supersedes the certificate it replaces", async () => {
    const { service, farm } = subject();
    const live = certificate(ISSUER);

    await service.renew(
      { runner: runner(), certificate: live.row, authority: ISSUER.row },
      { csr: certificationRequest() },
    );

    const [write, at] = (farm.renew as jest.Mock).mock.calls[0] as [
      { supersededId: string; certificate: { issued_for: string } },
      Date,
    ];

    expect(write.supersededId).toBe(live.row.id);
    expect(write.certificate.issued_for).toBe("renewal");
    expect(at).toBe(FIXTURE_NOW);
  });

  it("records both serials", async () => {
    const { service, written } = subject();
    const live = certificate(ISSUER);

    const renewed = await service.renew(
      { runner: runner(), certificate: live.row, authority: ISSUER.row },
      { csr: certificationRequest() },
    );

    expect(written[0]?.action).toBe("runner.cert_renewed");
    expect(written[0]?.detail).toEqual({
      previousSerial: live.row.serial,
      serial: renewed.serial,
    });
  });
});

describe("revoking a certificate", () => {
  it("kills the runner's live certificate and audits it", async () => {
    const { service, written, farm } = subject();

    const revoked = await service.revokeCertificate(FIXTURE_ORGANIZATION, "user_ken", runner().id);

    expect(farm.revokeCertificate).toHaveBeenCalled();
    expect(written[0]?.action).toBe("runner.cert_revoked");
    expect(revoked.serial).toEqual(expect.any(String));
  });

  it("refuses a runner this workspace does not have", async () => {
    const { service } = subject();
    (service as unknown as { farm: FarmRepository }).farm.runnerById = jest.fn(() =>
      Promise.resolve(undefined),
    );

    await expect(
      service.revokeCertificate(FIXTURE_ORGANIZATION, "user_ken", runner().id),
    ).rejects.toMatchObject({ response: { code: "farm_runner_not_found" } });
  });

  it("refuses a runner with nothing to revoke", async () => {
    // A bearer-fallback runner has no certificate by construction, and cutting one off is a
    // removal rather than a revocation.
    const { service } = subject();
    (service as unknown as { farm: FarmRepository }).farm.liveCertificate = jest.fn(() =>
      Promise.resolve(undefined),
    );

    await expect(
      service.revokeCertificate(FIXTURE_ORGANIZATION, "user_ken", runner().id),
    ).rejects.toMatchObject({ response: { code: "farm_no_live_certificate" } });
  });
});
