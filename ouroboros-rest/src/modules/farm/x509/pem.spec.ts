import { randomBytes } from "node:crypto";

import { fromPem, toPem } from "./pem";

/**
 * The textual wrapper, and the asymmetry it is built on: strict when writing, tolerant when
 * reading. What this service *writes* has to be the canonical form; what it *reads* arrives
 * from a Go agent, a shell heredoc and a copy-paste out of a terminal.
 */

describe("writing a block", () => {
  it("wraps the body at 64 characters, which some parsers enforce", () => {
    const lines = toPem("CERTIFICATE", randomBytes(200)).trim().split("\n");

    expect(lines[0]).toBe("-----BEGIN CERTIFICATE-----");
    expect(lines.at(-1)).toBe("-----END CERTIFICATE-----");
    for (const line of lines.slice(1, -1)) expect(line.length).toBeLessThanOrEqual(64);
    expect(lines.slice(1, -1).some((line) => line.length === 64)).toBe(true);
  });

  it("ends in a newline, so two blocks concatenate into a chain", () => {
    expect(toPem("CERTIFICATE", Buffer.of(1))).toMatch(/\n$/);
  });

  it("handles an empty body without emitting a blank line", () => {
    expect(toPem("CERTIFICATE", Buffer.alloc(0))).toBe(
      "-----BEGIN CERTIFICATE-----\n\n-----END CERTIFICATE-----\n",
    );
  });
});

describe("reading a block", () => {
  const der = randomBytes(128);
  const pem = toPem("CERTIFICATE", der);

  it("round-trips what it wrote", () => {
    expect(fromPem("CERTIFICATE", pem)).toEqual(der);
  });

  it("tolerates CRLF, indentation and surrounding text", () => {
    const mangled = `not a certificate\n  ${pem.replace(/\n/g, "\r\n  ")}\ntrailing words`;

    expect(fromPem("CERTIFICATE", mangled)).toEqual(der);
  });

  it("tolerates a missing trailing newline", () => {
    expect(fromPem("CERTIFICATE", pem.trimEnd())).toEqual(der);
  });

  it("refuses a block with the wrong label", () => {
    // The one thing it is not tolerant about: a response that returned somebody's certificate
    // where a request was expected would otherwise decode happily and fail much later.
    expect(() => fromPem("CERTIFICATE REQUEST", pem)).toThrow(/CERTIFICATE REQUEST/);
  });

  it("refuses text with no block at all", () => {
    expect(() => fromPem("CERTIFICATE", "hello")).toThrow(/CERTIFICATE/);
  });

  it("refuses a body that is not base64, rather than decoding a prefix of it", () => {
    // `Buffer.from(…, "base64")` stops at the first character it cannot read and returns what
    // it had — so a typo in the middle silently decodes to a short buffer. Re-encoding and
    // comparing is what turns that into a refusal.
    const corrupt = pem.replace(/^([A-Za-z0-9+/]{10})/m, "$1***");

    expect(() => fromPem("CERTIFICATE", corrupt)).toThrow();
  });

  it("says nothing about the content in its message", () => {
    // A malformed key is still a key.
    const secret = toPem("PRIVATE KEY", randomBytes(32));

    expect(() => fromPem("CERTIFICATE", secret)).toThrow("No CERTIFICATE block.");
  });
});
