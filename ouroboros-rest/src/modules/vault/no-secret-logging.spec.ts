/**
 * The lint rule, driven through ESLint's own `RuleTester`.
 *
 * [#222](https://github.com/NobuData/ouroboros/issues/222)'s criterion is that "the lint
 * rule catches a deliberate violation", and every entry in `invalid` below is one — written
 * the way a developer debugging the vault at 2am would actually write it, rather than as a
 * synthetic string chosen to match the implementation.
 *
 * `RuleTester` rather than running ESLint over a fixture file on disk: the rule needs no
 * type information, so there is no program to build, no temporary file to leave behind if
 * the suite is interrupted, and no risk of a fixture full of deliberate violations being
 * picked up by `yarn lint` itself.
 *
 * The cases are plain JavaScript because the rule is: it reads identifiers and property
 * names, which TypeScript does not change the shape of. A `.ts` case would need a parser to
 * be configured here and would exercise the same three node types.
 */

import { RuleTester } from "eslint";

import {
  DENIED_WORDS,
  LOG_METHODS,
  namesSecret,
  noSecretLogging,
  words,
} from "./no-secret-logging";

describe("splitting an identifier into words", () => {
  it.each([
    ["sealedDek", ["sealed", "dek"]],
    ["MASTER_KEY", ["master", "key"]],
    ["plaintext_bytes", ["plaintext", "bytes"]],
    ["KEKMaterial", ["kek", "material"]],
    ["version", ["version"]],
    ["organizationId2", ["organization", "id"]],
  ])("splits %s", (name, expected) => {
    expect(words(name)).toEqual(expected);
  });
});

describe("which names count as secret material", () => {
  it.each(["secret", "plaintext", "dek", "sealedDek", "masterKey", "credentials", "passphrase"])(
    "%s does",
    (name) => {
      expect(namesSecret(name)).toBe(true);
    },
  );

  // `key` is deliberately not a denied word — see the rule's header. Half the vault's
  // vocabulary contains it, and a rule that fired on all of it would be switched off.
  it.each(["keyVersion", "keyAt", "KeyWrapper", "organizationId", "recordId", "wrapper", "sealed"])(
    "%s does not",
    (name) => {
      expect(namesSecret(name)).toBe(false);
    },
  );

  it("covers every method Nest's Logger publishes", () => {
    for (const method of ["log", "error", "warn", "debug", "verbose", "fatal"]) {
      expect(LOG_METHODS.has(method)).toBe(true);
    }
  });

  it("does not deny `key`, which would make the rule unusable in this module", () => {
    expect(DENIED_WORDS.has("key")).toBe(false);
    expect(DENIED_WORDS.has("dek")).toBe(true);
  });
});

const ruleTester = new RuleTester();

ruleTester.run("no-secret-logging", noSecretLogging, {
  valid: [
    // What the vault actually logs: identifiers. A workspace id, a record id, a key version
    // and a count are the four things a sweep has to say, and none of them is a secret.
    "this.logger.log(`workspace ${organizationId} swept onto version ${version}`);",
    "this.logger.warn(`record ${recordId} in ${organizationId} could not be re-encrypted`);",
    "console.log(keyVersion, wrapper.id, resealed);",

    // Naming a secret outside a log sink is the entire job of this module.
    "const plaintext = await this.vault.decrypt(organizationId, recordId, envelope);",
    "zeroize(dek);",
    "const row = { sealed_dek: wrapped.material, wrapper: wrapped.wrapper };",

    // A call that is not a log sink, even though it takes a secret-named argument.
    "store.write(plaintext);",
    "expect(plaintext).toEqual(secret);",

    // `key` on its own is not denied, so the vocabulary this module is built from is usable.
    "logger.debug(`key version ${keyVersion} is active`);",
  ],

  invalid: [
    // The direct version, and the most likely one: somebody wants to see the value.
    {
      code: "this.logger.debug(plaintext);",
      errors: [{ messageId: "secretInLog", data: { name: "plaintext" } }],
    },

    // Interpolated, which is how it would really be written — and the reason the rule walks
    // the whole argument subtree rather than looking at top-level arguments.
    {
      code: "this.logger.warn(`could not open ${sealedDek} for ${organizationId}`);",
      errors: [{ messageId: "secretInLog", data: { name: "sealedDek" } }],
    },

    // Buried in an object, which is what structured logging looks like. The key names it
    // even when the value does not.
    {
      code: "logger.error('decrypt failed', { secret: value, workspace: organizationId });",
      errors: [{ messageId: "secretInLog", data: { name: "secret" } }],
    },

    // Shorthand, where the key and the value are one node.
    {
      code: "logger.log({ plaintext });",
      errors: [{ messageId: "secretInLog", data: { name: "plaintext" } }],
    },

    // `console` counts, because a debugging line is exactly where this happens.
    {
      code: "console.log('kek', masterKey);",
      errors: [{ messageId: "secretInLog", data: { name: "masterKey" } }],
    },

    // A property access rather than a bare identifier.
    {
      code: "this.logger.verbose(row.sealed_dek.toString('base64'));",
      errors: [{ messageId: "secretInLog", data: { name: "sealed_dek" } }],
    },

    // A computed method name, so the rule cannot be sidestepped by spelling the call
    // differently.
    {
      code: "logger['error'](credentials);",
      errors: [{ messageId: "secretInLog", data: { name: "credentials" } }],
    },

    // Two in one call is two reports: fixing one and leaving the other must not read as a
    // clean file.
    {
      code: "logger.log(`${plaintext} for ${dek}`);",
      errors: [
        { messageId: "secretInLog", data: { name: "plaintext" } },
        { messageId: "secretInLog", data: { name: "dek" } },
      ],
    },

    // Nested inside a ternary inside a template literal — depth is not an escape.
    {
      code: "logger.warn(`value: ${verbose ? plaintext : '[redacted]'}`);",
      errors: [{ messageId: "secretInLog", data: { name: "plaintext" } }],
    },
  ],
});
