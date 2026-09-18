import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import type { AppConfigService } from "../config/config.service";
import { ALLOW_ANONYMOUS } from "../auth/anonymous";
import { RegistrationController } from "./registration.controller";
import type { RegistrationService } from "./registration.service";
import type { RunnerIdentityService } from "./runner.identity";
import { authority, certificate, runner } from "./farm.fixture";
import { fromPem } from "./x509/pem";

/**
 * The agent's two routes — unsessioned, and each authenticated by something named in its own
 * handler.
 */

const ISSUER = authority();
const PRESENTED = certificate(ISSUER);

/** The controller over three stubs. */
function subject(options: { header?: string; identity?: unknown } = {}): {
  controller: RegistrationController;
  registration: RegistrationService;
  identity: RunnerIdentityService;
} {
  const registration = {
    register: jest.fn(() => Promise.resolve({ runnerId: "r" })),
    renew: jest.fn(() => Promise.resolve({ certificate: "pem" })),
  } as unknown as RegistrationService;

  const identity = {
    authenticate: jest.fn(() =>
      Promise.resolve(
        "identity" in options
          ? options.identity
          : { runner: runner(), certificate: PRESENTED.row, authority: ISSUER.row },
      ),
    ),
  } as unknown as RunnerIdentityService;

  const config = { farmClientCertHeader: options.header } as AppConfigService;

  return {
    controller: new RegistrationController(registration, identity, config),
    registration,
    identity,
  };
}

/** A request over TLS this process terminated. */
function tls(): Request {
  return {
    socket: { getPeerCertificate: () => ({ raw: fromPem("CERTIFICATE", PRESENTED.pem) }) },
    headers: {},
  } as unknown as Request;
}

/** A request with no client certificate at all — the proxy case, unconfigured. */
function bare(headers: Record<string, string> = {}): Request {
  return { socket: {}, headers } as unknown as Request;
}

describe("the guard surface", () => {
  const reflector = new Reflector();

  it("lets a caller with no session reach both routes", () => {
    // The caller is a machine on hardware this control plane does not administer; no session
    // could be issued to it. What authenticates each route is named in its own handler.
    for (const handler of ["register", "renew"] as const) {
      expect(reflector.get(ALLOW_ANONYMOUS, RegistrationController.prototype[handler])).toBe(true);
    }
  });
});

describe("registering", () => {
  it("passes the body through and names no workspace", async () => {
    const { controller, registration } = subject();
    const body = { token: "orb_enroll_x", name: "forge-01", arch: "linux/arm64" as const };

    await controller.register(body);

    expect(registration.register).toHaveBeenCalledWith(body);
  });
});

describe("renewing", () => {
  it("authenticates on the certificate the peer presented", async () => {
    const { controller, identity, registration } = subject();

    await controller.renew(tls(), { csr: "a-request" });

    const [identityArgument, body] = (registration.renew as jest.Mock).mock.calls[0] as [
      { runner: { id: string } },
      { csr: string },
    ];

    expect(identity.authenticate).toHaveBeenCalledWith(PRESENTED.pem);
    expect(identityArgument.runner.id).toBe(runner().id);
    expect(body).toEqual({ csr: "a-request" });
  });

  it("refuses, and names the proxy, when no certificate was presented", async () => {
    // The likeliest cause by a wide margin, and the deployment note SECURITY_MODEL.md carries.
    const { controller } = subject();

    await expect(controller.renew(bare(), { csr: "x" })).rejects.toMatchObject({
      response: { code: "farm_client_certificate_required" },
    });
  });

  it("DOES NOT READ A FORWARDED HEADER unless the deployment names one", async () => {
    // A certificate is public, so a header trusted unconditionally is an impersonation of any
    // runner whose certificate somebody has seen.
    const { controller } = subject();

    await expect(
      controller.renew(bare({ "x-ouro-client-cert": PRESENTED.pem }), { csr: "x" }),
    ).rejects.toMatchObject({ response: { code: "farm_client_certificate_required" } });
  });

  it("reads the header when the deployment has named one", async () => {
    const { controller, identity } = subject({ header: "x-ouro-client-cert" });

    await controller.renew(bare({ "x-ouro-client-cert": PRESENTED.pem }), { csr: "x" });

    expect(identity.authenticate).toHaveBeenCalledWith(PRESENTED.pem);
  });

  it("refuses a certificate that is not a live identity", async () => {
    // Unknown, expired, superseded, revoked and removed all arrive here as `undefined`, and all
    // answer the same way.
    const { controller, registration } = subject({ identity: undefined });

    await expect(controller.renew(tls(), { csr: "x" })).rejects.toMatchObject({
      response: { code: "farm_identity_refused", details: {} },
    });
    expect(registration.renew).not.toHaveBeenCalled();
  });
});
