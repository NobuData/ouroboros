import type { FarmRepository } from "./farm.repository";
import { RunnerIdentityService } from "./runner.identity";
import {
  authority,
  certificate,
  keypair,
  runner,
  FIXTURE_NOW,
  FIXTURE_ORGANIZATION,
  FIXTURE_RUNNER,
} from "./farm.fixture";
import type { FarmAuthority, Runner, RunnerCertificate } from "../db/schema";

/**
 * **The revocation check** — AH.2's third acceptance criterion, exercised against certificates
 * this module really issued.
 *
 * The issue asks for a revoked certificate to be refused *at handshake, tested against the
 * gateway rather than asserted*. The gateway is AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251))
 * and does not exist yet; this is the method it will call, and every refusal is driven here
 * through real cryptography — a real CA, a real signature, a real forged certificate — rather
 * than through a stub that agrees with the code under test.
 *
 * Seven ways in, one answer out. The suite's shape is that list.
 */

/** The repository, reduced to the three reads this service makes. */
function repository(rows: {
  authority?: FarmAuthority;
  certificate?: RunnerCertificate;
  runner?: Runner;
}): FarmRepository {
  return {
    authorityOf: jest.fn(() => Promise.resolve(rows.authority)),
    certificateBySerial: jest.fn(() => Promise.resolve(rows.certificate)),
    runnerById: jest.fn(() => Promise.resolve(rows.runner)),
  } as unknown as FarmRepository;
}

describe("a live identity", () => {
  const issuer = authority();
  const issued = certificate(issuer);

  it("resolves to its runner, its certificate and its workspace's authority", async () => {
    const identity = new RunnerIdentityService(
      repository({ authority: issuer.row, certificate: issued.row, runner: runner() }),
      () => FIXTURE_NOW,
    );

    const resolved = await identity.authenticate(issued.pem);

    expect(resolved?.runner.id).toBe(FIXTURE_RUNNER);
    expect(resolved?.certificate.serial).toBe(issued.serial);
    expect(resolved?.authority.organization_id).toBe(FIXTURE_ORGANIZATION);
  });

  it("looks the serial up in lower case, as the schema stores it", async () => {
    // `X509Certificate.serialNumber` is upper-case hex. A comparison that got this wrong would
    // refuse every certificate — the failure mode to prefer, and still the wrong reason.
    const farm = repository({ authority: issuer.row, certificate: issued.row, runner: runner() });

    await new RunnerIdentityService(farm, () => FIXTURE_NOW).authenticate(issued.pem);

    expect(farm.certificateBySerial).toHaveBeenCalledWith(FIXTURE_ORGANIZATION, issued.serial);
    expect(issued.serial).toBe(issued.serial.toLowerCase());
  });
});

describe("the seven refusals, each of which answers identically", () => {
  const issuer = authority();
  const issued = certificate(issuer);

  /**
   * Run the check and assert nothing came back.
   *
   * @param rows - What the repository answers with.
   * @param pem - What the peer presents.
   * @param at - The clock.
   */
  async function refused(
    rows: Parameters<typeof repository>[0],
    pem = issued.pem,
    at = FIXTURE_NOW,
  ): Promise<void> {
    const resolved = await new RunnerIdentityService(repository(rows), () => at).authenticate(pem);

    expect(resolved).toBeUndefined();
  }

  it("refuses something that is not a certificate", async () => {
    await refused({ authority: issuer.row }, "hello");
  });

  it("refuses a certificate that is not a runner's", async () => {
    // The CA's own certificate, presented as a client certificate. Its `OU` is the authority's.
    await refused({ authority: issuer.row }, issuer.pem);
  });

  it("refuses a workspace with no authority at all", async () => {
    await refused({});
  });

  it("REFUSES A FORGED CERTIFICATE — one signed by a CA this workspace does not have", async () => {
    // The step that makes reading the workspace out of the subject safe. A certificate claiming
    // `O=this-workspace` and signed by somebody else fails against this workspace's CA.
    const impostor = authority();
    const forged = certificate(impostor, { organizationId: FIXTURE_ORGANIZATION });

    await refused({ authority: issuer.row, certificate: forged.row, runner: runner() }, forged.pem);
  });

  it("refuses a certificate whose serial was never issued", async () => {
    await refused({ authority: issuer.row, certificate: undefined, runner: runner() });
  });

  it("REFUSES A REVOKED CERTIFICATE", async () => {
    // The acceptance criterion. The certificate is cryptographically perfect and the answer is
    // still no.
    await refused({
      authority: issuer.row,
      certificate: { ...issued.row, revoked: true, revoked_at: FIXTURE_NOW },
      runner: runner(),
    });
  });

  it("refuses a superseded certificate — still valid, and no longer the one to present", async () => {
    await refused({
      authority: issuer.row,
      certificate: { ...issued.row, superseded_at: FIXTURE_NOW },
      runner: runner(),
    });
  });

  it("refuses a certificate outside its own validity window", async () => {
    const expired = certificate(issuer, {
      notBefore: new Date(FIXTURE_NOW.getTime() - 200 * 86_400_000),
      notAfter: new Date(FIXTURE_NOW.getTime() - 100 * 86_400_000),
    });

    await refused(
      { authority: issuer.row, certificate: expired.row, runner: runner() },
      expired.pem,
    );
  });

  it("refuses a certificate that is not valid yet", async () => {
    const future = certificate(issuer, {
      notBefore: new Date(FIXTURE_NOW.getTime() + 86_400_000),
      notAfter: new Date(FIXTURE_NOW.getTime() + 200 * 86_400_000),
    });

    await refused({ authority: issuer.row, certificate: future.row, runner: runner() }, future.pem);
  });

  it("refuses a removed runner, reading the intent rather than the observation", async () => {
    // `desired_state` is what an operator decided; `status` is what the fleet last saw. A
    // machine that is merely `offline` is one that will come back.
    await refused({
      authority: issuer.row,
      certificate: issued.row,
      runner: runner({ status: "removed", desired_state: "removed" }),
    });
  });

  it("admits a runner that is merely offline", async () => {
    const resolved = await new RunnerIdentityService(
      repository({
        authority: issuer.row,
        certificate: issued.row,
        runner: runner({ status: "offline", desired_state: "active" }),
      }),
      () => FIXTURE_NOW,
    ).authenticate(issued.pem);

    expect(resolved).toBeDefined();
  });

  it("refuses a certificate whose runner row has gone", async () => {
    await refused({ authority: issuer.row, certificate: issued.row, runner: undefined });
  });

  it("answers undefined and nothing else — there is no channel saying which", async () => {
    // The difference between *revoked* and *unknown* tells a caller holding a stolen certificate
    // whether the theft has been noticed.
    const identity = new RunnerIdentityService(
      repository({ authority: issuer.row, certificate: undefined }),
      () => FIXTURE_NOW,
    );

    await expect(identity.authenticate(issued.pem)).resolves.toBeUndefined();
    await expect(identity.authenticate("nonsense")).resolves.toBeUndefined();
  });
});

describe("what it does not do", () => {
  it("does not trust a subject before the signature is checked", async () => {
    // A certificate claiming another workspace is looked up against *that* workspace's CA —
    // there is no path in which a claimed workspace is believed before it is proved.
    const issuer = authority("org_the_real_one");
    const impostor = authority("org_the_impostor");
    const forged = certificate(impostor, { organizationId: "org_the_real_one" });

    const farm = repository({
      authority: issuer.row,
      certificate: forged.row,
      runner: runner({ organization_id: "org_the_real_one" }),
    });

    expect(
      await new RunnerIdentityService(farm, () => FIXTURE_NOW).authenticate(forged.pem),
    ).toBeUndefined();
    expect(farm.authorityOf).toHaveBeenCalledWith("org_the_real_one");
  });

  it("does not care which key the certificate certifies", async () => {
    // Possession of the private key is proved by the TLS handshake, not by this lookup. What
    // this answers is whether the *certificate* is live.
    const issuer = authority();
    const issued = certificate(issuer, { publicKey: keypair().publicKey });

    expect(
      await new RunnerIdentityService(
        repository({ authority: issuer.row, certificate: issued.row, runner: runner() }),
        () => FIXTURE_NOW,
      ).authenticate(issued.pem),
    ).toBeDefined();
  });
});
