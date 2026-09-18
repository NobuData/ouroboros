/**
 * Where a runner's client certificate comes from — the socket, or a header an operator has
 * taken responsibility for.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)), decision **B3**, and the
 * deployment requirement the issue asks `SECURITY_MODEL.md` to carry: *reverse proxies
 * terminating TLS must pass client certificates through, or mTLS silently becomes
 * decoration*.
 *
 * ```
 * agent ──wss:// + client cert──▶ [ nginx / Traefik / ALB ]  ──http──▶ ouroboros-rest
 *                                          │                              │
 *                          terminates TLS and CONSUMES the certificate    │
 *                                          │                              │
 *                          forwards it as a header ─────────────────────▶ here
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Two sources, and they are not equally trusted.**
 *
 *   * **The TLS socket.** When this process terminates TLS itself, `getPeerCertificate()`
 *     answers with what the peer actually presented during a handshake this process
 *     performed. Nothing can forge it; it is the certificate or there was none.
 *   * **A forwarded header.** Read **only** when `OURO_FARM_CLIENT_CERT_HEADER` names one.
 *     It is unset by default, and that default is the whole of this module's security
 *     argument: **a certificate is public**. It crosses the network in the clear at every
 *     handshake, so anybody who has ever talked to a runner — or to this gateway — can send
 *     a copy. A header this service trusted unconditionally would be an impersonation of any
 *     runner whose certificate somebody has seen.
 *
 * Naming the header is therefore an operator asserting *this header cannot reach the process
 * except through my proxy*, which is a claim only they are in a position to make. The
 * variable's documentation in `.env.example` says so in those words, and
 * `SECURITY_MODEL.md`'s farm-CA section carries the directives that make the assertion true.
 *
 * ---------------------------------------------------------------------------
 * **The socket wins.** When both are present the socket's certificate is used and the header
 * is ignored, rather than the other way round or an error: a real handshake is strictly
 * better evidence than a forwarded string, and a deployment that has both configured is one
 * in transition rather than one under attack.
 *
 * **Nothing here verifies anything.** This module answers *what was presented*;
 * `runner.identity.ts` answers *whether it is a live identity of this farm*, which is a
 * signature check and a revocation lookup. Keeping them apart is what lets the second one be
 * tested against a certificate this service really issued rather than against a socket.
 */

import type { Request } from "express";
import type { TLSSocket } from "node:tls";

import { fromPem, toPem } from "./x509/pem";

/** The PEM label a certificate is carried in — see `farm.authority.ts`. */
const CERTIFICATE_LABEL = "CERTIFICATE";

/**
 * The certificate the caller presented, as PEM, or `undefined`.
 *
 * @param request - The inbound request.
 * @param header - The header name `OURO_FARM_CLIENT_CERT_HEADER` gave, or `undefined` when a
 *   deployment has not named one — in which case the header is not read at all.
 * @returns The PEM, or `undefined` when nothing was presented.
 */
export function clientCertificate(request: Request, header?: string): string | undefined {
  return fromSocket(request) ?? (header ? fromHeader(request, header) : undefined);
}

/**
 * The certificate from a TLS handshake this process performed.
 *
 * @param request - The inbound request.
 * @returns The PEM, or `undefined` when the connection is not TLS or presented no client
 *   certificate. Node answers an *empty object* rather than `undefined` for the latter, which
 *   is the case `raw?.length` is checking.
 */
function fromSocket(request: Request): string | undefined {
  const socket = request.socket as Partial<TLSSocket>;

  if (typeof socket.getPeerCertificate !== "function") return undefined;

  const raw = socket.getPeerCertificate().raw;

  return raw?.length ? toPem(CERTIFICATE_LABEL, raw) : undefined;
}

/**
 * The certificate a proxy forwarded.
 *
 * Proxies disagree about the encoding, and the two shapes in the wild are handled rather than
 * one being declared correct: nginx's `$ssl_client_escaped_cert` is percent-encoded PEM, and
 * Traefik's and most ALBs' are PEM with the newlines replaced by spaces or by literal `\n`.
 * Both decode to the same block, and refusing one of them would be this service picking a
 * proxy for an operator.
 *
 * @param request - The inbound request.
 * @param header - The header to read.
 * @returns The PEM, or `undefined` when the header is absent, empty, repeated, or does not
 *   contain a certificate block. **Repeated is refused rather than joined**: two values mean
 *   something in the chain appended one, and picking either would be guessing which hop is
 *   the trusted one.
 */
function fromHeader(request: Request, header: string): string | undefined {
  const value = request.headers[header.toLowerCase()];

  if (typeof value !== "string" || value.length === 0) return undefined;

  // Percent-decoding first, then the literal two-character `\n` some proxies write. What is
  // left is a PEM block whose newlines may have become spaces, which `fromPem` already treats
  // as whitespace — so the block is decoded and **re-encoded canonically** rather than patched
  // up. That is what makes the value handed on identical whatever shape it arrived in, and it
  // is also the check: a header that is not a certificate does not survive the round trip.
  try {
    const der = fromPem(CERTIFICATE_LABEL, decode(value).replace(/\\n/g, "\n"));

    return toPem(CERTIFICATE_LABEL, der);
  } catch {
    return undefined;
  }
}

/**
 * Percent-decode, tolerantly.
 *
 * @param value - The header's value.
 * @returns The decoded value, or the value unchanged when it is not percent-encoded —
 *   `decodeURIComponent` throws on a stray `%`, and a Traefik header full of base64 `+`
 *   characters is not an encoding error.
 */
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
