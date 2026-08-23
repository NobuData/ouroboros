/**
 * `ouroboros/no-secret-in-internal-response` — the lint rule that keeps credentials out of
 * the engine-facing surface.
 *
 * [#224](https://github.com/NobuData/ouroboros/issues/224)'s last acceptance criterion is
 * that *the lint rule catches a deliberately added internal endpoint that returns secret
 * material*. This is that rule. It is the structural half of decision **P3**: `lease.ts`
 * and `lease.resources.ts` are written so that there is nowhere for a secret to go, and this
 * is what refuses the field that would create somewhere.
 *
 * ---------------------------------------------------------------------------
 * **What it does.** Inside `src/modules/internal/` — the whole of the engine-facing surface
 * — it reports any *property name* that names credential material, in the three places a
 * response shape is written:
 *
 *   * a **type**: an `interface` member or an object type's member, which is where a
 *     resource is declared;
 *   * a **returned object literal**, at any depth, which is where one is built;
 *   * a **class property**, which is what a DTO is.
 *
 * Names are split into words on camelCase and non-letters first, so `apiKey`, `api_key`,
 * `accessToken` and `sealedSecret` are all caught and `keyboardShortcut` is not.
 *
 * ---------------------------------------------------------------------------
 * **`key` and `token` are denied here and `key` is *not* denied by
 * `no-secret-logging.mjs`.** That difference is deliberate and is the reason this is a
 * second rule rather than a wider first one. In the vault, `key` is half the vocabulary —
 * `keyVersion`, `keyAt`, `KeyWrapper` — and a rule that fired on all of it would be turned
 * off within a week. On this surface it is the opposite: a response field whose name
 * contains `key` or `token` is, on the balance of every API anybody has ever written, a
 * credential. The two rules therefore have different word lists because they are protecting
 * against different mistakes in different places, and `words()` is shared because splitting
 * an identifier is the same problem in both.
 *
 * ---------------------------------------------------------------------------
 * **Why names rather than types.** The same argument the logging rule makes: a rule that
 * tracked a decrypted buffer into a response body is the rule everybody wants and nobody can
 * write, because the value arrives as a `Buffer`, becomes a `string`, and is assigned to a
 * field. What is reliably true is that whoever adds the field names it after what it holds —
 * an endpoint returning an Anthropic key calls it `apiKey`, not `field7` — so the rule
 * catches the habit. False positives are possible and are a feature: renaming
 * `tokenBudget` to `budgetTokens` costs nothing and leaves the next reader in no doubt.
 * There is no options object and no allow-list, because an escape hatch on a rule like this
 * becomes the thing that gets used.
 *
 * Plain JavaScript rather than TypeScript, because `eslint.config.mjs` imports it and
 * ESLint's configuration is loaded by Node before any compiler runs. `no-secret-responses.d.ts`
 * beside it is what lets `no-secret-responses.spec.ts` drive it through ESLint's `RuleTester`.
 */

import { words } from "../vault/no-secret-logging.mjs";

/**
 * The words that name credential material in a response.
 *
 * A superset of the logging rule's list on the two entries that matter here — `key` and
 * `token` — for the reason this file's header gives. `bearer` and `authorization` are here
 * because they name the header a credential travels on, and a field named after that header
 * is a field carrying its value.
 *
 * **`token` is denied and `tokens` is not**, which is the one place this list has to know
 * what product it is in. In Ouroboros the plural is a *unit of text*, not a credential:
 * `token_usage` is the table, `inputTokens` and `outputTokens` are the counts an invocation
 * reports, and a rule that refused them would refuse the usage capture AB.1 requires. The
 * singular is the credential — `accessToken`, `apiToken`, `refreshToken` — and every one of
 * those is still caught. A field genuinely holding several credentials and named for it is
 * a case this list would miss, and it is one nobody has ever written.
 */
export const DENIED_RESPONSE_WORDS = new Set([
  "key",
  "keys",
  "token",
  "secret",
  "secrets",
  "credential",
  "credentials",
  "password",
  "passwords",
  "passphrase",
  "plaintext",
  "dek",
  "deks",
  "kek",
  "material",
  "unsealed",
  "unwrapped",
  "bearer",
  "authorization",
]);

/**
 * Does this property name name credential material?
 *
 * @param {string} name - The property name.
 * @returns {boolean} `true` when any of its words is in {@link DENIED_RESPONSE_WORDS}.
 */
export function namesResponseSecret(name) {
  return words(name).some((word) => DENIED_RESPONSE_WORDS.has(word));
}

/**
 * The name a property key is written with, when it has one.
 *
 * A computed key — `{ [name]: value }` — has no name to read, and is deliberately not
 * reported: the rule catches the habit of naming a field after what it holds, and a computed
 * key is not that habit. It is also vanishingly rare in a response shape.
 *
 * @param {{type: string, name?: string, value?: unknown}} key - The key node.
 * @param {boolean} computed - Whether the key was written in brackets.
 * @returns {string | undefined} The name, or `undefined` when there is none to read.
 */
function keyName(key, computed) {
  if (computed) {
    return undefined;
  }

  if (key.type === "Identifier" && typeof key.name === "string") {
    return key.name;
  }

  if (key.type === "Literal" && typeof key.value === "string") {
    return key.value;
  }

  return undefined;
}

/**
 * Every property key written anywhere inside a subtree.
 *
 * A hand-rolled walk rather than an ESLint selector, for the reason the logging rule gives:
 * the interesting keys are at arbitrary depth — inside a nested object, inside an array of
 * them, inside a ternary — and a selector deep enough to reach them would also reach out of
 * the `return`.
 *
 * @param {unknown} node - An AST node, or anything reachable from one.
 * @param {(node: object, name: string) => void} report - Called with each offending key.
 * @param {WeakSet<object>} [seen] - Nodes already visited, so a shorthand property that puts
 *   one node at both `key` and `value` is reported once.
 */
function walkKeys(node, report, seen = new WeakSet()) {
  if (node === null || typeof node !== "object" || seen.has(node)) {
    return;
  }

  seen.add(node);

  if (Array.isArray(node)) {
    for (const child of node) {
      walkKeys(child, report, seen);
    }
    return;
  }

  const candidate = /** @type {{type?: string, key?: object, computed?: boolean}} */ (node);

  if (typeof candidate.type !== "string") {
    return;
  }

  if (candidate.type === "Property" && candidate.key !== undefined) {
    const name = keyName(
      /** @type {{type: string, name?: string, value?: unknown}} */ (candidate.key),
      candidate.computed === true,
    );

    if (name !== undefined && namesResponseSecret(name)) {
      report(candidate.key, name);
    }
  }

  for (const [property, value] of Object.entries(node)) {
    // `parent` is ESLint's back-reference and would walk the whole program; `range` and
    // `loc` are position data with nothing to find in them.
    if (property === "parent" || property === "range" || property === "loc") {
      continue;
    }

    walkKeys(value, report, seen);
  }
}

/**
 * The rule, in ESLint's flat-config rule shape.
 *
 * @type {import("eslint").Rule.RuleModule}
 */
export const noSecretResponses = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow naming credential material in a shape the internal surface returns " +
        "(issue #224, AD.3). Workers are given addresses; keys never leave the control plane.",
    },
    schema: [],
    messages: {
      secretInResponse:
        "`{{name}}` names credential material and must not be a field of anything the " +
        "internal surface returns. Workers never hold provider credentials (issue #224, " +
        "decision P3): a cloud provider is reached through POST /internal/llm/invoke, and a " +
        "lease carries an address. If this is not a credential, rename it so the next " +
        "reader does not have to ask.",
    },
  },

  create(context) {
    /**
     * Report one offending name.
     *
     * @param {object} node - The key node to point at.
     * @param {string} name - The name that was refused.
     */
    const report = (node, name) => {
      context.report({
        node: /** @type {import("estree").Node} */ (node),
        messageId: "secretInResponse",
        data: { name },
      });
    };

    /**
     * Check a declared member of a type or a class.
     *
     * @param {{key?: object, computed?: boolean}} node - The member.
     */
    const checkMember = (node) => {
      if (node.key === undefined) {
        return;
      }

      const name = keyName(
        /** @type {{type: string, name?: string, value?: unknown}} */ (node.key),
        node.computed === true,
      );

      if (name !== undefined && namesResponseSecret(name)) {
        report(node.key, name);
      }
    };

    return {
      // The declared shape: `interface LeaseResource { … }`, `type X = { … }`.
      TSPropertySignature: checkMember,
      // A DTO, which is a class — and the request half of the surface, where a field named
      // for a credential would mean a worker sending one.
      PropertyDefinition: checkMember,
      // The built shape: everything a handler, a mapper or a service hands back.
      ReturnStatement(node) {
        walkKeys(node.argument, report);
      },
    };
  },
};
