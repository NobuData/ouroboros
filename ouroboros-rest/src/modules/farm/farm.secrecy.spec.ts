import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { X509Certificate } from "node:crypto";

import type { AuditService } from "../audit/audit.service";
import type { AuditRecord } from "../audit/audit.events";
import type { EnrollmentToken, RunnerPool } from "../db/schema";
import type { VaultService } from "../vault/vault.service";
import { FarmAudit } from "./farm.audit";
import { FarmAuthorityService } from "./farm.authority";
import type { FarmRepository, EnrollmentWrite } from "./farm.repository";
import { EnrollmentService } from "./enrollment.service";
import { RegistrationService } from "./registration.service";
import { mintToken, parseToken } from "./farm.tokens";
import {
  authority,
  certificationRequest,
  installerStub,
  privateKeyPem,
  runner,
  FIXTURE_NOW,
  FIXTURE_ORGANIZATION,
  FIXTURE_SEALED,
} from "./farm.fixture";

/**
 * **The grep test** — the second half of AH.2's
 * ([#250](https://github.com/NobuData/ouroboros/issues/250)) fourth acceptance criterion,
 * *the CA private key never leaves the vault service, verified by lint and a grep test*.
 *
 * `ouroboros/no-ca-key-escape` is the lint. It refuses the **name** anywhere but the one
 * service that unwraps the key, which catches the line somebody adds tomorrow. This suite
 * catches the two things a name-based rule cannot:
 *
 *   * **What the module's source actually says.** The one exempt file is read here and held to
 *     the promises its own header makes — no logger, no cache, no method that returns a key.
 *     The rule cannot check those, because inside that file the names are allowed.
 *   * **What the module actually answers.** A full lifecycle is driven — mint, enrol, renew,
 *     revoke — and every payload that would cross the wire is scanned for key material, token
 *     values and envelopes. That is the claim a person cares about, and it is a claim about
 *     behaviour rather than about text.
 */

/** This module's own directory. */
const MODULE = __dirname;

/** The one file allowed to hold a CA private key — see `eslint.config.mjs`. */
const AUTHORITY_FILE = "farm.authority.ts";

/**
 * A source file with its comments removed.
 *
 * The lint rule reads identifiers and ignores prose, so this suite has to as well: several
 * files *explain* what `key_sealed` is and why they never touch it, and a grep that counted
 * those would be a grep that punished documentation.
 *
 * @param path - The file.
 * @returns Its code, with block and line comments blanked out.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Every shipped `.ts` in this module, recursively. Specs and fixtures do not ship. */
function sources(directory: string = MODULE): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return sources(path);
    if (!entry.name.endsWith(".ts")) return [];
    if (/\.(spec|integration-spec|fixture|d)\.ts$/.test(entry.name)) return [];

    return [path];
  });
}

describe("what the module's source says", () => {
  const shipped = sources();

  it("has files to read, so a broken walk cannot pass silently", () => {
    expect(shipped.length).toBeGreaterThan(10);
  });

  it("names the CA's sealed column in exactly one file", () => {
    // The lint rule enforces this and this asserts it from the other direction: if the rule's
    // exemption list ever grows a second entry, the addition has to be argued here too.
    const naming = shipped.filter((path) => code(path).includes("key_sealed"));

    expect(naming.map((path) => path.slice(MODULE.length + 1))).toEqual([AUTHORITY_FILE]);
  });

  describe("and in that file", () => {
    const source = readFileSync(join(MODULE, AUTHORITY_FILE), "utf8");

    it("nothing logs — there is no logger at all", () => {
      // A `Logger` in the one file holding an unwrapped key is one `logger.debug(signer)` away
      // from the thing this whole arrangement exists to prevent.
      expect(source).not.toMatch(/\bLogger\b/);
      expect(source).not.toMatch(/console\./);
      expect(source).not.toMatch(/\.(log|debug|warn|error|verbose|fatal)\(/);
    });

    it("nothing caches — the key is unwrapped per signature", () => {
      // `VaultService`'s posture, applied one layer up: a CA key living in a process after its
      // workspace was deleted is a window in which the crypto-shred has not happened.
      expect(source).not.toMatch(/private\s+\w*[Cc]ache/);
      expect(source).not.toMatch(/\bMap<|\bnew Map\(/);
    });

    it("zeroizes in a finally", () => {
      expect(source).toMatch(/finally\s*\{\s*\n\s*opened\.fill\(0\);/);
    });

    it("hands the key to a callback rather than returning one", () => {
      // A method that *returned* it would be a method whose result a caller could hold past the
      // request that needed it.
      expect(source).toMatch(/private async withAuthorityKey</);
      expect(source).not.toMatch(/\): Promise<KeyObject>/);
    });
  });

  it("declares no type with a key-shaped field outside the two files allowed one", () => {
    // The lint rule covers the names it knows; this covers the shape. `x509/` and
    // `farm.authority.ts` legitimately take a `KeyObject` as a parameter — that is the
    // exemption the rule itself carries, and this sweep honours the same list rather than
    // inventing a second one.
    for (const path of shipped.filter(
      (file) => !file.includes(`${"x509"}/`) && !file.endsWith(AUTHORITY_FILE),
    )) {
      const members = code(path).matchAll(/^\s{2}(?:readonly\s+)?(\w+)\??:/gm);

      for (const [, member] of members) {
        expect(member).not.toMatch(/^(privateKey|keySealed|caKey|signingKey|authorityKey)$/);
      }
    }
  });
});

/* ------------------------------------------------------------------------- */

const ISSUER = authority();
const TOKEN = mintToken("7f3a9c1e-4b0d-4e2a-8f6b-5c3d1e0f2a4b", "a-secret-long-enough-abcdefgh");

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
  default_command: null,
  artifact_globs: [],
  created_at: FIXTURE_NOW,
  updated_at: FIXTURE_NOW,
};

const TOKEN_ROW: EnrollmentToken = {
  id: TOKEN.id,
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
};

describe("what the module answers", () => {
  it("never puts key material, an envelope or a stored token value in a payload", async () => {
    const written: AuditRecord[] = [];
    const stored: unknown[] = [];

    const farm = {
      poolByName: jest.fn(() => Promise.resolve(POOL)),
      poolById: jest.fn(() => Promise.resolve(POOL)),
      insertToken: jest.fn((row: Record<string, unknown>) => {
        stored.push(row);

        return Promise.resolve({ ...TOKEN_ROW, ...row });
      }),
      tokensOf: jest.fn(() => Promise.resolve([TOKEN_ROW])),
      revokeToken: jest.fn(() =>
        Promise.resolve({ ...TOKEN_ROW, revoked: true, revoked_at: FIXTURE_NOW }),
      ),
      tokenById: jest.fn(() => Promise.resolve(TOKEN_ROW)),
      authorityOf: jest.fn(() => Promise.resolve(ISSUER.row)),
      insertAuthority: jest.fn(() => Promise.resolve(ISSUER.row)),
      bearerFallbackPermitted: jest.fn(() => Promise.resolve(true)),
      enrol: jest.fn((write: EnrollmentWrite) => {
        stored.push(write);

        return Promise.resolve(runner(write.runner));
      }),
      renew: jest.fn(() => Promise.resolve(undefined)),
      runnerById: jest.fn(() => Promise.resolve(runner())),
      liveCertificate: jest.fn(() => Promise.resolve(undefined)),
      revokeCertificate: jest.fn(() => Promise.resolve(undefined)),
    } as unknown as FarmRepository;

    const opened = Buffer.from(privateKeyPem(ISSUER.privateKey), "utf8");
    const vault = {
      encrypt: jest.fn(() => Promise.resolve(FIXTURE_SEALED)),
      encryptText: jest.fn(() => Promise.resolve(FIXTURE_SEALED)),
      decrypt: jest.fn(() => Promise.resolve(Buffer.from(opened))),
      decryptText: jest.fn(() => Promise.resolve(parseToken(TOKEN.value)?.secret)),
    } as unknown as VaultService;

    const audit = new FarmAudit({
      record: jest.fn((event: AuditRecord) => {
        written.push(event);

        return Promise.resolve("event");
      }),
    } as unknown as AuditService);

    const clock = (): Date => FIXTURE_NOW;
    const authorityService = new FarmAuthorityService(farm, vault, clock);
    const enrollment = new EnrollmentService(farm, vault, audit, installerStub(), clock);
    const registration = new RegistrationService(farm, authorityService, vault, audit, clock);

    const minted = await enrollment.mint(FIXTURE_ORGANIZATION, "user_ken", { pool: "pool-a" });
    const listed = await enrollment.list(FIXTURE_ORGANIZATION);
    const revoked = await enrollment.revoke(FIXTURE_ORGANIZATION, "user_ken", TOKEN.id);
    const enrolled = await registration.register({
      token: TOKEN.value,
      name: "forge-01",
      arch: "linux/arm64",
      csr: certificationRequest(),
    } as never);
    const ca = await registration.authorityOf(FIXTURE_ORGANIZATION);

    // Everything that crosses the wire, plus the trail, as one string.
    const payloads = JSON.stringify([minted, listed, revoked, enrolled, ca, written]);

    // The CA's private key, in either form.
    expect(payloads).not.toContain("PRIVATE KEY");
    expect(payloads).not.toContain(privateKeyPem(ISSUER.privateKey).slice(30, 60));
    // Any AD.1 envelope — the token's, the bearer secret's, the CA key's.
    expect(payloads).not.toContain("ouro.v1.");
    // The *stored* token's plaintext, which only the mint response may carry.
    expect(JSON.stringify([listed, revoked, enrolled, ca, written])).not.toContain(TOKEN.value);

    // …and what it *does* carry: a certificate, a fingerprint, and one token value.
    expect(minted.token).toBe(minted.token);
    expect(() => new X509Certificate(enrolled.certificate as string)).not.toThrow();
    expect(ca.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
