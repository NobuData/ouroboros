import { describe, expect, it } from "vitest";

import {
  ACTIVE_TENANT_COOKIE,
  TENANT_HEADER,
  TENANT_REFERENCE_MAX_LENGTH,
  assertTenantReference,
  isTenantReference,
} from "@/app/api/tenant";

/**
 * What this client is willing to call a workspace.
 *
 * The value arrives from a cookie — whatever the browser was last given — and leaves in
 * an HTTP header this client composes, so the validation below is a safety property
 * rather than a convenience. The cases that matter are the ones that would still be a
 * valid *string*: a newline, a semicolon, a value longer than the contract accepts.
 */

describe("the vocabulary", () => {
  it("names the header the contract names", () => {
    // openapi.yaml § components.parameters.TenantHeader. Spelt as the document spells
    // it: header names are case-insensitive on the wire, but the CORS allow-list in
    // ouroboros-rest and this constant should read the same.
    expect(TENANT_HEADER).toBe("X-Ouro-Tenant");
  });

  it("prefixes the cookie like every other Ouroboros cookie", () => {
    expect(ACTIVE_TENANT_COOKIE).toBe("ouro_tenant");
  });

  it("accepts references as long as a DNS label, which is what a slug must become", () => {
    expect(TENANT_REFERENCE_MAX_LENGTH).toBe(63);
  });
});

describe("isTenantReference", () => {
  it.each([
    ["a slug", "acme"],
    ["a hyphenated slug", "acme-robotics"],
    ["a uuid", "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10"],
    ["digits", "2026"],
    ["the longest reference the contract accepts", "a".repeat(63)],
  ])("accepts %s", (_description, value) => {
    expect(isTenantReference(value)).toBe(true);
  });

  it.each([
    ["the empty string, which a cleared cookie leaves behind", ""],
    ["one character too long", "a".repeat(64)],
    ["a value carrying CR and LF, which would be two headers", "acme\r\nX-Ouro-Internal-Key: k"],
    ["a value carrying a bare newline", "acme\n"],
    ["a value carrying a space", "acme robotics"],
    ["a value carrying a semicolon, which would end a cookie", "acme;path=/"],
    ["a path traversal", "../admin"],
    ["a slug with a slash, which would change the URL's meaning", "acme/robotics"],
    ["a NUL byte", "acme\u0000"],
    ["a non-ASCII letter, which the contract's slugs never carry", "acmé"],
  ])("rejects %s", (_description, value) => {
    expect(isTenantReference(value)).toBe(false);
  });
});

describe("assertTenantReference", () => {
  it("returns an acceptable reference unchanged, never rewriting what it was given", () => {
    // There is no escaping a header value into safety; a client that "fixed" the value
    // would send a request naming a workspace nobody chose.
    expect(assertTenantReference("acme")).toBe("acme");
  });

  it("names the header it was about to compose", () => {
    expect(() => assertTenantReference("acme robotics")).toThrow(TENANT_HEADER);
  });

  it("quotes the length rather than the rejected value, which may reach a log", () => {
    expect(() => assertTenantReference("acme\r\nX-Ouro-Internal-Key: stolen")).not.toThrow(
      /X-Ouro-Internal-Key: stolen/,
    );
    expect(() => assertTenantReference("acme robotics")).toThrow(/13 character\(s\)/);
  });
});
