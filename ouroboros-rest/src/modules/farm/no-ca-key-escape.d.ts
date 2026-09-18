/**
 * Types for `no-ca-key-escape.mjs`.
 *
 * The rule itself has to be plain JavaScript, because `eslint.config.mjs` imports it and
 * ESLint's configuration is loaded by Node before any compiler runs. This declaration is what
 * lets `no-ca-key-escape.spec.ts` import it and drive it through ESLint's `RuleTester` under
 * the same strict compiler settings as everything else — so the rule is *tested* by TypeScript
 * even though it is not *written* in it. `vault/no-secret-logging.d.ts` is the precedent.
 */

import type { Rule } from "eslint";

/** The words that, standing beside `key`, make a name a CA private key. */
export declare const KEY_QUALIFIERS: ReadonlySet<string>;

/** Names that are key material on their own — `pkcs`, which covers `pkcs8`. */
export declare const KEY_WORDS: ReadonlySet<string>;

/**
 * Does this name name a CA private key?
 *
 * @param name - The identifier or property name.
 * @returns `true` when it does.
 */
export declare function namesAuthorityKey(name: string): boolean;

/** The rule: CA key material may be named only in the service that unwraps it. */
export declare const noCaKeyEscape: Rule.RuleModule;
