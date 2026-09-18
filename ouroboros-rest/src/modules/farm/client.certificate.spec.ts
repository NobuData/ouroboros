import type { Request } from "express";

import { clientCertificate } from "./client.certificate";
import { authority, certificate } from "./farm.fixture";
import { fromPem } from "./x509/pem";

/**
 * Where a certificate comes from, and the default that is the whole security argument:
 * **the header is not read unless a deployment names one**.
 */

const ISSUER = authority();
const PRESENTED = certificate(ISSUER);

/**
 * A request with a plain TCP socket — this process behind a TLS-terminating proxy.
 *
 * @param headers - What arrived.
 * @returns The request.
 */
function proxied(headers: Record<string, string | string[]> = {}): Request {
  return { socket: {}, headers } as unknown as Request;
}

/**
 * A request over TLS this process terminated.
 *
 * @param der - What the peer presented, or nothing.
 * @returns The request.
 */
function tls(der?: Buffer): Request {
  return {
    socket: { getPeerCertificate: () => (der ? { raw: der } : {}) },
    headers: {},
  } as unknown as Request;
}

describe("a TLS connection this process terminated", () => {
  it("reads the certificate off the socket", () => {
    const der = fromPem("CERTIFICATE", PRESENTED.pem);

    expect(clientCertificate(tls(der))).toBe(PRESENTED.pem);
  });

  it("answers nothing when the peer presented none", () => {
    // Node answers an empty object rather than undefined for a TLS connection with no client
    // certificate, which is the case a naive check misses.
    expect(clientCertificate(tls())).toBeUndefined();
  });
});

describe("a forwarded header", () => {
  it("is NOT READ unless a deployment names one", () => {
    // The default, and the reason for it: a certificate is public — it crosses the network in
    // the clear at every handshake — so a header this service trusted unconditionally would be
    // an impersonation of any runner whose certificate somebody has seen.
    expect(clientCertificate(proxied({ "x-ouro-client-cert": PRESENTED.pem }))).toBeUndefined();
  });

  it("is read when one is named", () => {
    expect(
      clientCertificate(proxied({ "x-ouro-client-cert": PRESENTED.pem }), "x-ouro-client-cert"),
    ).toBe(PRESENTED.pem);
  });

  it("is matched case-insensitively, as HTTP field names are", () => {
    expect(
      clientCertificate(proxied({ "x-ouro-client-cert": PRESENTED.pem }), "X-Ouro-Client-Cert"),
    ).toBe(PRESENTED.pem);
  });

  it("decodes nginx's percent-encoded form", () => {
    // `$ssl_client_escaped_cert`.
    const escaped = encodeURIComponent(PRESENTED.pem);

    expect(clientCertificate(proxied({ h: escaped }), "h")).toBe(PRESENTED.pem);
  });

  it("decodes the space-separated form most proxies send", () => {
    // Traefik and most ALBs replace the newlines. Both shapes are handled rather than one being
    // declared correct — refusing the other would be this service picking a proxy for an
    // operator — and what comes back is the canonical block either way.
    const flattened = PRESENTED.pem.trim().replace(/\n/g, " ");

    expect(clientCertificate(proxied({ h: flattened }), "h")).toBe(PRESENTED.pem);
  });

  it("decodes a literal backslash-n form", () => {
    const escaped = PRESENTED.pem.trim().replace(/\n/g, "\\n");

    expect(clientCertificate(proxied({ h: escaped }), "h")).toBe(PRESENTED.pem);
  });

  it("answers nothing for an absent, empty or repeated header", () => {
    // Repeated is refused rather than joined: two values mean something in the chain appended
    // one, and picking either would be guessing which hop is the trusted one.
    expect(clientCertificate(proxied({}), "h")).toBeUndefined();
    expect(clientCertificate(proxied({ h: "" }), "h")).toBeUndefined();
    expect(clientCertificate(proxied({ h: [PRESENTED.pem, PRESENTED.pem] }), "h")).toBeUndefined();
  });

  it("answers nothing for a header that is not a certificate", () => {
    expect(clientCertificate(proxied({ h: "hello" }), "h")).toBeUndefined();
    expect(clientCertificate(proxied({ h: "%%%" }), "h")).toBeUndefined();
  });
});

describe("when both are available", () => {
  it("the socket wins", () => {
    // A real handshake is strictly better evidence than a forwarded string, and a deployment
    // with both configured is one in transition rather than one under attack.
    const other = certificate(authority("org_somebody_else"));
    const request = {
      socket: { getPeerCertificate: () => ({ raw: fromPem("CERTIFICATE", PRESENTED.pem) }) },
      headers: { h: other.pem },
    } as unknown as Request;

    expect(clientCertificate(request, "h")).toBe(PRESENTED.pem);
  });
});
