/**
 * The lint rule, driven through ESLint's own `RuleTester`.
 *
 * [#224](https://github.com/NobuData/ouroboros/issues/224)'s last acceptance criterion is
 * that *the lint rule catches a deliberately added internal endpoint that returns secret
 * material*, and every entry in `invalid` below is one — written the way somebody would
 * actually write it while making a worker's life easier, rather than as a synthetic string
 * chosen to match the implementation. The one at the top of that list is the criterion
 * verbatim: a second internal endpoint, added in good faith, that hands back the provider's
 * API key.
 *
 * Two testers, because the rule covers two grammars. A returned object literal and a class
 * property are JavaScript, so espree reads them; an `interface` member is TypeScript, and
 * that is the *declaration* half — the shape somebody writes before they write the handler.
 * Both matter: a resource is declared in one place and built in another, and a rule that
 * only caught one would be a rule somebody routes around without meaning to.
 *
 * `RuleTester` rather than running ESLint over a fixture on disk: no program to build, no
 * temporary file to leave behind, and no risk of a fixture full of deliberate violations
 * being picked up by `yarn lint` itself — which is also why `eslint.config.mjs` exempts this
 * file from the rule it is testing.
 */

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import {
  DENIED_RESPONSE_WORDS,
  namesResponseSecret,
  noSecretResponses,
} from "./no-secret-responses";
import { DENIED_WORDS } from "../vault/no-secret-logging";

describe("which property names count as credential material", () => {
  it.each([
    "apiKey",
    "api_key",
    "accessToken",
    "refreshToken",
    "token",
    "providerSecret",
    "credential",
    "password",
    "passphrase",
    "bearerToken",
    "authorization",
    "keys",
    "plaintext",
    "dek",
  ])("%s does", (name) => {
    expect(namesResponseSecret(name)).toBe(true);
  });

  it.each([
    "baseUrl",
    "organizationId",
    "provider",
    "run",
    "expiresAt",
    "ttlSeconds",
    "inputTokens",
    "outputTokens",
    "keyboardShortcut",
    "monkey",
  ])("%s does not", (name) => {
    expect(namesResponseSecret(name)).toBe(false);
  });

  it("denies `key`, which the logging rule deliberately does not", () => {
    // The reason this is a second rule rather than a wider first one. In the vault, `key` is
    // half the vocabulary — `keyVersion`, `KeyWrapper` — and a rule that fired on all of it
    // would be turned off within a week. On a response, a field whose name contains `key` is
    // a credential.
    expect(DENIED_RESPONSE_WORDS.has("key")).toBe(true);
    expect(DENIED_WORDS.has("key")).toBe(false);
  });

  it("denies `token` and permits `tokens`", () => {
    // The one place this list has to know what product it is in. The plural is a unit of
    // text here — `token_usage`, `inputTokens` — and the singular is a credential. A rule
    // that refused the plural would refuse the usage capture AB.1 requires.
    expect(DENIED_RESPONSE_WORDS.has("token")).toBe(true);
    expect(DENIED_RESPONSE_WORDS.has("tokens")).toBe(false);
    expect(namesResponseSecret("inputTokens")).toBe(false);
    expect(namesResponseSecret("accessToken")).toBe(true);
  });
});

const javascript = new RuleTester();

javascript.run("no-secret-in-internal-response (built shapes)", noSecretResponses, {
  valid: [
    // What the lease surface actually returns: an address, a scope and two times.
    `function leaseResource(lease) {
       return {
         id: lease.id,
         provider: lease.provider,
         run: lease.run,
         organizationId: lease.organizationId,
         baseUrl: lease.baseUrl,
         expiresAt: lease.expiresAt.toISOString(),
         ttlSeconds: lease.ttlSeconds,
       };
     }`,

    // Usage capture, which is the case a cruder word list breaks: these are units of text.
    "function usage() { return { inputTokens: 10, outputTokens: 20, costCents: null }; }",

    // Naming a secret *outside* a returned shape is not this rule's business — the
    // invocation gateway will hold a decrypted credential in request scope, by design.
    "const secret = await vault.decryptText(organizationId, connectionId, envelope);",
    "adapter.invoke({ apiKey: secret, payload });",

    // A computed key has no name to read, and is not the habit this rule catches.
    "function shape() { return { [field]: value }; }",
  ],

  invalid: [
    // The criterion, verbatim: a second internal endpoint that hands back the key, added by
    // somebody being helpful about a worker's latency.
    {
      code: `async function connection(id) {
               const row = await connections.find(id);
               return { id: row.id, baseUrl: row.base_url, apiKey: await vault.decryptText(row.org, id, row.secret) };
             }`,
      errors: [{ messageId: "secretInResponse", data: { name: "apiKey" } }],
    },

    // The same mistake spelled the other way round, which is how a "short-lived token" would
    // arrive — the thing decision P3 exists to refuse.
    {
      code: "function lease() { return { baseUrl, expiresAt, accessToken: minted }; }",
      errors: [{ messageId: "secretInResponse", data: { name: "accessToken" } }],
    },

    // Shorthand, where the key and the value are one node.
    {
      code: "function lease() { return { baseUrl, token }; }",
      errors: [{ messageId: "secretInResponse", data: { name: "token" } }],
    },

    // Nested, because a resource is often assembled a level down.
    {
      code: "function lease() { return { provider: { kind: 'anthropic', credential: value } }; }",
      errors: [{ messageId: "secretInResponse", data: { name: "credential" } }],
    },

    // Inside an array of them, which is what a listing looks like.
    {
      code: "function list() { return { items: rows.map((row) => ({ id: row.id, password: row.password })) }; }",
      errors: [{ messageId: "secretInResponse", data: { name: "password" } }],
    },

    // A quoted key is the same key.
    {
      code: "function lease() { return { 'api_key': value }; }",
      errors: [{ messageId: "secretInResponse", data: { name: "api_key" } }],
    },

    // A DTO is a class, and the request half matters too: a field named for a credential
    // there would mean a worker *sending* one.
    {
      code: "class LeaseRequestDto { provider; run; apiKey; }",
      errors: [{ messageId: "secretInResponse", data: { name: "apiKey" } }],
    },

    // Two in one shape is two reports: fixing one and leaving the other must not read as a
    // clean file.
    {
      code: "function lease() { return { apiKey, refreshToken }; }",
      errors: [
        { messageId: "secretInResponse", data: { name: "apiKey" } },
        { messageId: "secretInResponse", data: { name: "refreshToken" } },
      ],
    },
  ],
});

const typescript = new RuleTester({ languageOptions: { parser: tseslint.parser } });

typescript.run("no-secret-in-internal-response (declared shapes)", noSecretResponses, {
  valid: [
    // `LeaseResource`, as it is actually declared.
    `interface LeaseResource {
       readonly id: string;
       readonly provider: string;
       readonly baseUrl: string;
       readonly expiresAt: string;
       readonly ttlSeconds: number;
     }`,

    // The usage event, for the `tokens` case again — this time as a declaration.
    `interface InvokeUsageEvent {
       readonly inputTokens: number;
       readonly outputTokens: number;
     }`,
  ],

  invalid: [
    // The declaration half of the criterion: the field is written into the resource type
    // first, and the handler that fills it comes after.
    {
      code: `interface ConnectionResource {
               readonly id: string;
               readonly baseUrl: string;
               readonly apiKey: string;
             }`,
      errors: [{ messageId: "secretInResponse", data: { name: "apiKey" } }],
    },

    // A type alias is the same declaration wearing different syntax.
    {
      code: "type Minted = { readonly baseUrl: string; readonly token: string };",
      errors: [{ messageId: "secretInResponse", data: { name: "token" } }],
    },

    // The one that would read most innocently in a diff, and is the exact thing mockup 07's
    // original copy promised: a short-lived credential handed to a worker.
    {
      code: "interface ScopedLease { readonly expiresAt: string; readonly shortLivedSecret: string }",
      errors: [{ messageId: "secretInResponse", data: { name: "shortLivedSecret" } }],
    },
  ],
});
