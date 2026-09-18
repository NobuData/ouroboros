/**
 * `ouroboros/no-ca-key-escape` — the rule that keeps a workspace's CA private key inside the
 * one service allowed to hold it.
 *
 * AH.2's ([#250](https://github.com/NobuData/ouroboros/issues/250)) fourth acceptance
 * criterion: *the CA private key never leaves the vault service — verified by lint and a grep
 * test*. This is the lint; `farm.secrecy.spec.ts` is the grep test. They catch different
 * failures and both are needed — the spec proves that the paths the farm has today return
 * nothing sensitive, and this rule catches the line somebody adds tomorrow to a path the spec
 * does not reach.
 *
 * ---------------------------------------------------------------------------
 * **What it does, and how blunt it is.** It reports any identifier or property name that
 * *names* CA key material — a name whose words include `key` together with one of `sealed`,
 * `private`, `ca`, `authority` or `signing`, or the word `pkcs8` on its own — **anywhere in
 * the file**. Not in a log call, not in a return: anywhere.
 *
 * That is deliberately blunter than `ouroboros/no-secret-logging`, and the reason is that the
 * property being protected is different in kind. That rule is about a *habit* — somebody
 * logging a plaintext while debugging — so it fires at the sink. This one is about an
 * *architecture*: there is exactly one file in this service that is allowed to be holding a
 * CA private key at all, and every other file mentioning one is either a leak or a second
 * implementation of the thing the first file exists to be. A rule that fired only at a
 * response boundary would permit the second, and the second is how the first eventually
 * becomes untrue.
 *
 * ---------------------------------------------------------------------------
 * **The exemptions are in `eslint.config.mjs`, not here, and there are two.**
 *
 *   * `farm.authority.ts` — the service that unwraps the key, uses it for one signature and
 *     zeroizes it. It is the file the rule exists to make singular.
 *   * `farm/x509/` — the encoder, which takes a `KeyObject` as a parameter and has no
 *     dependency on this service at all: it imports no repository, no DTO and no resource, so
 *     there is no path from it to a response. Its own header is where that is argued.
 *
 * There is no options object and no inline allow-list, for `no-secret-logging`'s reason: an
 * escape hatch on a rule like this becomes the thing that gets used. Adding a third file to
 * the exemptions is an edit to the ESLint configuration, which is a diff a reviewer sees.
 *
 * ---------------------------------------------------------------------------
 * Plain JavaScript rather than TypeScript because `eslint.config.mjs` has to `import` it, and
 * ESLint's configuration is loaded by Node before any compiler runs. `no-ca-key-escape.d.ts`
 * beside it is what lets `no-ca-key-escape.spec.ts` drive it through ESLint's `RuleTester`.
 */

import { words } from "../vault/no-secret-logging.mjs";

/**
 * The words that, standing beside `key`, make a name a CA private key.
 *
 * `key` alone is not enough and could not be: `keyIdentifier`, `publicKey`, `keyUsage` and
 * `KeyObject` are ordinary vocabulary in a module that issues certificates, and a rule that
 * fired on all of them would be turned off within a week — which is `no-secret-logging`'s own
 * argument for leaving `key` out of *its* list.
 */
export const KEY_QUALIFIERS = new Set(["sealed", "private", "ca", "authority", "signing"]);

/**
 * Names that are key material on their own, without a qualifier.
 *
 * `pkcs` is the encoding family a private key is exported in and has no other use here; a
 * variable called anything containing it is holding one. The word is matched without its
 * version digit because {@link words} splits on non-letters — `pkcs8` and `pkcs1` are one
 * word to this rule, which is the right granularity.
 */
export const KEY_WORDS = new Set(["pkcs"]);

/**
 * The word that makes a `key` name harmless, whatever else is beside it.
 *
 * `authorityPublicKey` is the CA's *public* half — it goes into an authority key identifier,
 * it is in every certificate this service issues, and it is not a secret in any sense. Without
 * this the rule would refuse the one name that most clearly says *not the private one*, which
 * is the kind of false positive that gets a rule turned off.
 */
const PUBLIC = "public";

/**
 * Does this name name a CA private key?
 *
 * @param {string} name - The identifier or property name.
 * @returns {boolean} `true` when it does.
 */
export function namesAuthorityKey(name) {
  const parts = words(name);

  if (parts.includes(PUBLIC)) {
    return false;
  }

  if (parts.some((word) => KEY_WORDS.has(word))) {
    return true;
  }

  return parts.includes("key") && parts.some((word) => KEY_QUALIFIERS.has(word));
}

/**
 * The rule, in ESLint's flat-config rule shape.
 *
 * @type {import("eslint").Rule.RuleModule}
 */
export const noCaKeyEscape = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow naming CA private key material outside the one service that unwraps it " +
        "(issue #250, AH.2). The farm CA's key is sealed by AD.1 and exists in memory for " +
        "the duration of one signature.",
    },
    schema: [],
    messages: {
      keyOutsideAuthority:
        "`{{name}}` names the farm CA's private key, which may only be handled in " +
        "`farm.authority.ts` (issue #250). The key is sealed by AD.1, unwrapped for one " +
        "signature and zeroized; a second file that can name it is a second place it can " +
        "escape from. Pass the certificate, the serial or the fingerprint instead.",
    },
  },

  create(context) {
    /**
     * Report a name, once per source position.
     *
     * A shorthand property puts the same identifier at both `key` and `value`, and some
     * parsers make those distinct objects over one range — which is one mistake and must read
     * as one error. Keying on the range is parser-agnostic where node identity is not.
     */
    const reported = new Set();

    /**
     * @param {import("estree").Node & { range?: [number, number] }} node - Where to point.
     * @param {string} name - The name that was written, which a `Literal` carries as its value
     *   rather than as a `name` — hence the explicit argument.
     * @returns {void}
     */
    const report = (node, name) => {
      const at = node.range ? `${node.range[0]}:${node.range[1]}` : name;

      if (reported.has(at)) return;

      reported.add(at);
      context.report({ node, messageId: "keyOutsideAuthority", data: { name } });
    };

    return {
      Identifier(node) {
        if (namesAuthorityKey(node.name)) report(node, node.name);
      },

      // A quoted property key is an `Identifier` in no parser — `{ "key_sealed": value }` is a
      // `Literal` — and it is the obvious way round a rule that only watched identifiers.
      Literal(node) {
        if (typeof node.value === "string" && namesAuthorityKey(node.value)) {
          report(node, node.value);
        }
      },
    };
  },
};
