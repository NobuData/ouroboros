import { Logger } from "@nestjs/common";
import type { IncomingMessage } from "node:http";

import type { AppConfigService } from "../../config/config.service";
import type { VaultService } from "../../vault/vault.service";
import { authority, certificate, runner } from "../farm.fixture";
import { FARM_ERRORS } from "../farm.errors";
import type { RunnerIdentity, RunnerIdentityService } from "../runner.identity";
import type { AgentGatewayRepository } from "./gateway.repository";
import { TransportAuthenticator, isRefusal, type TransportRefusal } from "./transport";

/** The header this suite's deployment trusts a proxy to forward a certificate in. */
const HEADER = "x-ouro-client-cert";

/** A bearer secret of the exact shape AH.2 mints: 32 bytes, base64url. */
const SECRET = Buffer.alloc(32, 7).toString("base64url");

/**
 * An upgrade request as a proxy delivers it.
 *
 * @param headers - Its headers.
 * @returns The request.
 */
function upgrade(headers: Record<string, string> = {}): IncomingMessage {
  return { socket: {}, headers } as unknown as IncomingMessage;
}

describe("authenticating an upgrade", () => {
  // Several cases drive a failure path on purpose — a refused hello, a dead database, a listener
  // that throws — and the gateway logs each one, as it should in production. Silenced here so the
  // suite's output holds only what failed; the cases that care what was said spy on it themselves.
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  const issuer = authority();
  const presented = certificate(issuer);
  const mtlsRunner = runner();
  const fallbackRunner = runner({
    id: "7f000002-0000-4000-8000-000000000002",
    security_mode: "bearer_fallback",
    cert_serial: null,
    bearer_sealed: "ouro.v1.1.YQ.Yg",
  });

  let identity: jest.Mocked<Pick<RunnerIdentityService, "authenticate">>;
  let repository: jest.Mocked<Pick<AgentGatewayRepository, "bearerCandidates">>;
  let vault: jest.Mocked<Pick<VaultService, "decryptText">>;
  let authenticator: TransportAuthenticator;

  beforeEach(() => {
    identity = { authenticate: jest.fn() };
    repository = { bearerCandidates: jest.fn().mockResolvedValue([fallbackRunner]) };
    vault = { decryptText: jest.fn().mockResolvedValue(SECRET) };
    authenticator = new TransportAuthenticator(
      identity as unknown as RunnerIdentityService,
      repository as unknown as AgentGatewayRepository,
      vault as unknown as VaultService,
      { farmClientCertHeader: HEADER } as AppConfigService,
    );
  });

  /**
   * The refusal an answer was, or fail.
   *
   * @param verdict - The answer.
   * @returns The refusal.
   */
  function refusal(
    verdict: Awaited<ReturnType<TransportAuthenticator["authenticate"]>>,
  ): TransportRefusal {
    if (!isRefusal(verdict)) throw new Error("expected a refusal");
    return verdict;
  }

  it("authenticates a live certificate through AH.2's own check", async () => {
    identity.authenticate.mockResolvedValue({ runner: mtlsRunner } as RunnerIdentity);

    const verdict = await authenticator.authenticate(
      upgrade({ [HEADER]: encodeURIComponent(presented.pem) }),
    );

    expect(verdict).toEqual({ runner: mtlsRunner, mode: "mtls" });
    expect(identity.authenticate).toHaveBeenCalledWith(presented.pem);
  });

  it("REFUSES A REVOKED CERTIFICATE AT HANDSHAKE with AH.2's opaque refusal", async () => {
    identity.authenticate.mockResolvedValue(undefined);

    const verdict = refusal(
      await authenticator.authenticate(upgrade({ [HEADER]: encodeURIComponent(presented.pem) })),
    );

    expect(verdict.reason).toBe("identity");
    expect(verdict.error.getStatus()).toBe(401);
    expect(verdict.error.code).toBe(FARM_ERRORS.identityRefused);
  });

  it("REJECTS A CONNECTION WITH NO CERTIFICATE rather than accepting it as ordinary TLS", async () => {
    const verdict = refusal(await authenticator.authenticate(upgrade()));

    expect(verdict.reason).toBe("no_certificate");
    expect(verdict.error.code).toBe(FARM_ERRORS.clientCertificateRequired);
    expect(identity.authenticate).not.toHaveBeenCalled();
  });

  it("reads no header a deployment has not named — a certificate is public", async () => {
    authenticator = new TransportAuthenticator(
      identity as unknown as RunnerIdentityService,
      repository as unknown as AgentGatewayRepository,
      vault as unknown as VaultService,
      { farmClientCertHeader: undefined } as AppConfigService,
    );

    const verdict = refusal(
      await authenticator.authenticate(upgrade({ [HEADER]: encodeURIComponent(presented.pem) })),
    );

    expect(verdict.reason).toBe("no_certificate");
    expect(identity.authenticate).not.toHaveBeenCalled();
  });

  it("judges a connection offering a certificate and a bearer on the certificate alone", async () => {
    identity.authenticate.mockResolvedValue(undefined);

    const verdict = refusal(
      await authenticator.authenticate(
        upgrade({ [HEADER]: encodeURIComponent(presented.pem), authorization: `Bearer ${SECRET}` }),
      ),
    );

    expect(verdict.reason).toBe("identity");
    expect(vault.decryptText).not.toHaveBeenCalled();
  });

  describe("the bearer fallback", () => {
    it("authenticates a secret that matches a fallback runner's sealed one", async () => {
      const verdict = await authenticator.authenticate(
        upgrade({ authorization: `Bearer ${SECRET}` }),
      );

      expect(verdict).toEqual({ runner: fallbackRunner, mode: "bearer_fallback" });
      expect(vault.decryptText).toHaveBeenCalledWith(
        fallbackRunner.organization_id,
        fallbackRunner.id,
        fallbackRunner.bearer_sealed,
      );
    });

    it("reads the scheme case-insensitively", async () => {
      const verdict = await authenticator.authenticate(
        upgrade({ authorization: `bearer ${SECRET}` }),
      );

      expect(isRefusal(verdict)).toBe(false);
    });

    it("refuses a secret that matches no runner, having opened every candidate", async () => {
      repository.bearerCandidates.mockResolvedValue([
        fallbackRunner,
        { ...fallbackRunner, id: "x" },
      ]);
      vault.decryptText.mockResolvedValue(Buffer.alloc(32, 9).toString("base64url"));

      const verdict = refusal(
        await authenticator.authenticate(upgrade({ authorization: `Bearer ${SECRET}` })),
      );

      expect(verdict.reason).toBe("identity");
      expect(vault.decryptText).toHaveBeenCalledTimes(2);
    });

    it("keeps opening candidates after a match, so the time taken says nothing about which", async () => {
      repository.bearerCandidates.mockResolvedValue([
        fallbackRunner,
        { ...fallbackRunner, id: "later" },
      ]);

      const verdict = await authenticator.authenticate(
        upgrade({ authorization: `Bearer ${SECRET}` }),
      );

      expect(verdict).toMatchObject({ runner: { id: fallbackRunner.id } });
      expect(vault.decryptText).toHaveBeenCalledTimes(2);
    });

    it("refuses a value that is not even the shape of a secret without opening anything", async () => {
      const verdict = refusal(
        await authenticator.authenticate(upgrade({ authorization: "Bearer short" })),
      );

      expect(verdict.reason).toBe("identity");
      expect(repository.bearerCandidates).not.toHaveBeenCalled();
    });

    it("skips a candidate whose envelope will not open, rather than locking every runner out", async () => {
      repository.bearerCandidates.mockResolvedValue([
        { ...fallbackRunner, id: "broken" },
        fallbackRunner,
      ]);
      vault.decryptText.mockRejectedValueOnce(new Error("no key")).mockResolvedValueOnce(SECRET);

      const verdict = await authenticator.authenticate(
        upgrade({ authorization: `Bearer ${SECRET}` }),
      );

      expect(verdict).toMatchObject({ runner: { id: fallbackRunner.id } });
    });

    it("treats another authorization scheme as no credential at all", async () => {
      const verdict = refusal(
        await authenticator.authenticate(upgrade({ authorization: `Basic ${SECRET}` })),
      );

      expect(verdict.reason).toBe("no_certificate");
    });
  });
});
