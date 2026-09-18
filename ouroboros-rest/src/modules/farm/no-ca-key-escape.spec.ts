/**
 * The lint rule, driven through ESLint's own `RuleTester`.
 *
 * AH.2's ([#250](https://github.com/NobuData/ouroboros/issues/250)) fourth acceptance
 * criterion — *the CA private key never leaves the vault service, verified by lint and a grep
 * test* — is held by this rule and by `farm.secrecy.spec.ts`. Every entry in `invalid` below
 * is a line somebody would actually write while being helpful: returning the key so a caller
 * can sign something itself, logging it while debugging an enrollment, caching it because
 * unwrapping per signature seemed wasteful.
 *
 * Two testers, because the rule covers two grammars: a returned object and a class property
 * are JavaScript, and an `interface` member is TypeScript — the *declaration* half, which is
 * what somebody writes before they write the code that fills it in.
 *
 * `RuleTester` rather than running ESLint over a fixture on disk: no program to build, no
 * temporary file to leave behind, and no risk of a fixture full of deliberate violations being
 * picked up by `yarn lint` itself — which is also why `eslint.config.mjs` exempts this file.
 */

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import { namesAuthorityKey, noCaKeyEscape, KEY_QUALIFIERS, KEY_WORDS } from "./no-ca-key-escape";
import { DENIED_WORDS } from "../vault/no-secret-logging";

describe("which names count as the CA's private key", () => {
  it.each([
    "keySealed",
    "key_sealed",
    "authorityKey",
    "caKey",
    "signingKey",
    "privateKey",
    "CA_KEY",
    "unwrappedAuthorityKey",
    "pkcs8",
    "pkcs8Bytes",
  ])("%s does", (name) => {
    expect(namesAuthorityKey(name)).toBe(true);
  });

  it.each([
    "publicKey",
    "keyIdentifier",
    "keyUsage",
    "KeyObject",
    "certificate",
    "fingerprint",
    "serial",
    "authority",
    "authorityPublicKey",
    "monkey",
  ])("%s does not", (name) => {
    expect(namesAuthorityKey(name)).toBe(false);
  });

  it("needs `key` beside a qualifier, never `key` alone", () => {
    // `keyIdentifier`, `publicKey`, `keyUsage` and `KeyObject` are ordinary vocabulary in a
    // module that issues certificates. A rule that fired on all of them would be turned off
    // within a week — which is `no-secret-logging`'s own argument for leaving `key` out of its
    // list, applied here from the other side.
    expect(DENIED_WORDS.has("key")).toBe(false);
    expect(KEY_QUALIFIERS.has("sealed")).toBe(true);
    expect(namesAuthorityKey("key")).toBe(false);
  });

  it("denies `pkcs` on its own, because it has no other use here", () => {
    // Without its version digit, because `words()` splits on non-letters — so `pkcs8` and
    // `pkcs1` are one word to this rule, which is the right granularity.
    expect(KEY_WORDS.has("pkcs")).toBe(true);
    expect(namesAuthorityKey("pkcs8")).toBe(true);
  });

  it("permits anything that says `public`, whatever else is beside it", () => {
    // `authorityPublicKey` is the CA's public half: it goes into an authority key identifier
    // and is in every certificate this service issues. Refusing the one name that most clearly
    // says *not the private one* is how a rule gets turned off.
    expect(namesAuthorityKey("authorityPublicKey")).toBe(false);
    expect(namesAuthorityKey("caPublicKey")).toBe(false);
  });
});

const javascript = new RuleTester();

javascript.run("no-ca-key-escape (values)", noCaKeyEscape, {
  valid: [
    // What the farm actually passes around: certificates, serials and fingerprints.
    "function resource(row) { return { certificate: row.certificate_pem, fingerprint: row.fingerprint }; }",
    "const identifier = keyIdentifier(authorityPublicKey);",
    "const parsed = new X509Certificate(authority.certificate_pem);",
    "certificate.verify(issuer.publicKey);",
    // A computed key has no name to read.
    "const shape = { [field]: value };",
  ],

  invalid: [
    // The criterion, verbatim: somebody returns the key so a caller can sign something itself.
    {
      code: "async function open(row) { return { authorityKey: await vault.decrypt(row.key_sealed) }; }",
      errors: [
        { messageId: "keyOutsideAuthority", data: { name: "authorityKey" } },
        { messageId: "keyOutsideAuthority", data: { name: "key_sealed" } },
      ],
    },

    // Logging it while debugging an enrollment.
    {
      code: 'logger.debug("signing with", caKey);',
      errors: [{ messageId: "keyOutsideAuthority", data: { name: "caKey" } }],
    },

    // Caching it, because unwrapping per signature seemed wasteful. It is the decision
    // `farm.authority.ts` argues against, and this is where the second implementation of it
    // would start.
    {
      code: "class Cache { privateKey = null; }",
      errors: [{ messageId: "keyOutsideAuthority", data: { name: "privateKey" } }],
    },

    // A quoted property key, which is the obvious way round a rule that only watched
    // identifiers.
    {
      code: 'const row = { "key_sealed": sealed };',
      errors: [{ messageId: "keyOutsideAuthority", data: { name: "key_sealed" } }],
    },

    // Reading the column at all, anywhere but the one exempt file.
    {
      code: "const sealed = authority.key_sealed;",
      errors: [{ messageId: "keyOutsideAuthority", data: { name: "key_sealed" } }],
    },
  ],
});

const typescript = new RuleTester({ languageOptions: { parser: tseslint.parser } });

typescript.run("no-ca-key-escape (declarations)", noCaKeyEscape, {
  valid: [
    "interface AuthorityResource { certificate: string; fingerprint: string; notAfter: string }",
    "interface Signed { publicKey: KeyObject; serial: string }",
  ],

  invalid: [
    // The declaration half: the shape somebody writes before they write the handler.
    {
      code: "interface AuthorityResource { certificate: string; privateKey: string }",
      errors: [{ messageId: "keyOutsideAuthority", data: { name: "privateKey" } }],
    },
    {
      code: "type Row = { key_sealed: string };",
      errors: [{ messageId: "keyOutsideAuthority", data: { name: "key_sealed" } }],
    },
  ],
});
