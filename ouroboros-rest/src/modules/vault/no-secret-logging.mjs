/**
 * `ouroboros/no-secret-logging` — the ESLint rule that keeps decrypted material out of log
 * sinks.
 *
 * [#222](https://github.com/NobuData/ouroboros/issues/222)'s last acceptance criterion asks
 * that "decrypted material is never logged" be *enforced by a lint rule plus redaction
 * tests, not by reviewer vigilance*. This is the lint rule; `redaction.spec.ts` is the
 * tests. They cover different failures and both are needed: the tests prove that the paths
 * exercised today log nothing sensitive, and this rule catches the line somebody adds
 * tomorrow while debugging a path the tests do not reach.
 *
 * ---------------------------------------------------------------------------
 * **What it does.** Inside a call to a log sink — `console.*`, or any `.log`/`.warn`/
 * `.error`/`.debug`/`.verbose`/`.fatal` on anything, which is Nest's `Logger` and every
 * logger this codebase might acquire — it reports any identifier or property name that
 * *names* secret material: `secret`, `plaintext`, `dek`, `kek`, `credential`, `password`,
 * `passphrase`, `master`, `material`, `unsealed`, `unwrapped`, and their plurals. Names are
 * split on camelCase and underscores first, so `sealedDek`, `master_key` and `plaintextKey`
 * are all caught and `keyVersion` is not.
 *
 * ---------------------------------------------------------------------------
 * **Why a name-based rule rather than a taint analysis.** A rule that actually tracked a
 * decrypted buffer to a log call is the rule everybody wants and nobody can write against
 * an untyped `unknown[]` argument list — the plaintext arrives as a `Buffer`, is
 * interpolated into a template literal, and is a `string` by the time it reaches the sink.
 * What is reliably true is that a developer logging a secret while debugging names the
 * variable after the thing it holds, because that is what makes the log line useful to
 * them. So the rule catches the *habit*, which is what the criterion is really about, and
 * it is deliberately loud rather than clever.
 *
 * That means false positives are possible and are a feature: `secretCount` is refused, and
 * renaming it to `sealedCount` costs nothing and leaves the next reader in no doubt. There
 * is no options object and no allow-list, for the same reason — an escape hatch on a rule
 * like this becomes the thing that gets used.
 *
 * ---------------------------------------------------------------------------
 * Plain JavaScript rather than TypeScript because `eslint.config.mjs` has to `import` it,
 * and ESLint's config is loaded by Node before any compiler runs. `no-secret-logging.d.ts`
 * beside it is what lets `no-secret-logging.spec.ts` drive it through ESLint's `RuleTester`.
 */

/**
 * Method names that mean "this goes somewhere a person will read it later".
 *
 * Nest's `Logger` publishes `log`, `error`, `warn`, `debug`, `verbose` and `fatal`;
 * `console` publishes those and more. `info` and `trace` are here because a codebase that
 * acquires a second logger will bring them.
 */
export const LOG_METHODS = new Set([
  "log",
  "info",
  "warn",
  "error",
  "debug",
  "verbose",
  "fatal",
  "trace",
  "dir",
]);

/**
 * The words that name secret material.
 *
 * Matched against a name's *words* rather than as substrings, so `keyVersion` and
 * `masterless` behave predictably — see {@link words}. `key` is deliberately absent: it
 * appears in `keyVersion`, `keyAt`, `KeyWrapper` and half the vault's vocabulary, and a rule
 * that fired on all of them would be turned off within a week.
 */
export const DENIED_WORDS = new Set([
  "secret",
  "secrets",
  "plaintext",
  "dek",
  "deks",
  "kek",
  "credential",
  "credentials",
  "password",
  "passwords",
  "passphrase",
  "master",
  "material",
  "unsealed",
  "unwrapped",
]);

/**
 * Split an identifier into lower-cased words.
 *
 * Handles the three shapes this codebase writes: `sealedDek` → `sealed`, `dek`;
 * `MASTER_KEY` → `master`, `key`; `plaintext_bytes` → `plaintext`, `bytes`. The second
 * replacement is what keeps an acronym run from swallowing the word after it, so
 * `KEKMaterial` splits rather than reading as one word.
 *
 * @param {string} name - The identifier or property name.
 * @returns {string[]} Its words, lower-cased.
 */
export function words(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

/**
 * Does this name name secret material?
 *
 * @param {string} name - The identifier or property name.
 * @returns {boolean} `true` when any of its words is in {@link DENIED_WORDS}.
 */
export function namesSecret(name) {
  return words(name).some((word) => DENIED_WORDS.has(word));
}

/**
 * Is this call expression a call to a log sink?
 *
 * Any member call whose method is in {@link LOG_METHODS}: `this.logger.warn(...)`,
 * `console.error(...)`, `logger['log'](...)`. The receiver is deliberately not checked —
 * requiring it to be named `logger` or `console` would miss every logger given a different
 * name, and a `.warn()` on something that is not a logger is rare enough that catching it
 * costs nothing.
 *
 * @param {import("estree").Node} callee - The call's callee.
 * @returns {boolean} `true` when it looks like a log sink.
 */
function isLogSink(callee) {
  if (callee.type !== "MemberExpression") {
    return false;
  }

  const { property, computed } = callee;

  if (!computed && property.type === "Identifier") {
    return LOG_METHODS.has(property.name);
  }

  if (computed && property.type === "Literal" && typeof property.value === "string") {
    return LOG_METHODS.has(property.value);
  }

  return false;
}

/**
 * Every name written anywhere inside a subtree.
 *
 * A hand-rolled walk rather than an ESLint selector because the interesting names are at
 * arbitrary depth — inside a template literal, inside an object passed as context, inside a
 * ternary — and a selector deep enough to reach them would also reach out of the call.
 *
 * Property *keys* are visited as well as values: `logger.debug({ plaintext })` and
 * `logger.debug({ plaintext: value })` are the same mistake, and only the key names it.
 *
 * @param {unknown} node - An AST node, or anything reachable from one.
 * @param {(node: {type: string, name?: string}, name: string) => void} report - Called with
 *   each node that carries a denied name.
 * @param {WeakSet<object>} [seen] - Nodes already visited. Not an optimisation: shorthand
 *   properties put *the same* `Identifier` node at both `key` and `value`, so `{ plaintext }`
 *   would otherwise be reported twice for one mistake.
 */
function walkNames(node, report, seen = new WeakSet()) {
  if (node === null || typeof node !== "object") {
    return;
  }

  if (seen.has(node)) {
    return;
  }

  seen.add(node);

  if (Array.isArray(node)) {
    for (const child of node) {
      walkNames(child, report, seen);
    }
    return;
  }

  const candidate = /** @type {{type?: string, name?: string}} */ (node);

  if (typeof candidate.type !== "string") {
    return;
  }

  if (candidate.type === "Identifier" && typeof candidate.name === "string") {
    if (namesSecret(candidate.name)) {
      report(/** @type {{type: string, name: string}} */ (candidate), candidate.name);
    }
  }

  for (const [key, value] of Object.entries(node)) {
    // `parent` is ESLint's back-reference and would walk the whole program; `range` and
    // `loc` are position data with nothing to find in them.
    if (key === "parent" || key === "range" || key === "loc") {
      continue;
    }

    walkNames(value, report, seen);
  }
}

/**
 * The rule, in ESLint's flat-config rule shape.
 *
 * @type {import("eslint").Rule.RuleModule}
 */
export const noSecretLogging = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow naming secret material in a call to a log sink (issue #222, AD.1). " +
        "Decrypted credentials live in request scope and never reach a log.",
    },
    schema: [],
    messages: {
      secretInLog:
        "`{{name}}` names secret material and must not be passed to a log sink. Decrypted " +
        "material lives only in request scope and is never logged (issue #222). Log an " +
        "identifier — a workspace id, a record id, a key version — instead.",
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        if (!isLogSink(node.callee)) {
          return;
        }

        // One report per *position*, not per node. A shorthand property (`logger.log({
        // plaintext })`) puts an identifier at both `key` and `value`, and some parsers make
        // those two distinct objects covering the same source range — which is one mistake
        // and must read as one error. Keying on the range is parser-agnostic where node
        // identity is not.
        const reported = new Set();

        // Arguments only. The callee's own identifiers are the logger and the method, and a
        // logger that happened to be called `secretLogger` is not the mistake this catches.
        walkNames(node.arguments, (found, name) => {
          const range = /** @type {{range?: [number, number]}} */ (found).range;
          const position = range === undefined ? name : `${range[0]}:${range[1]}`;

          if (reported.has(position)) {
            return;
          }

          reported.add(position);
          context.report({ node: found, messageId: "secretInLog", data: { name } });
        });
      },
    };
  },
};

/**
 * The plugin `eslint.config.mjs` registers, so the rule is named `ouroboros/no-secret-logging`.
 *
 * @type {import("eslint").ESLint.Plugin}
 */
export const ouroborosPlugin = {
  rules: { "no-secret-logging": noSecretLogging },
};
