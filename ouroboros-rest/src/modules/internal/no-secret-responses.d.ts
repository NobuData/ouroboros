/**
 * Types for `no-secret-responses.mjs`.
 *
 * The rule itself has to be plain JavaScript, because `eslint.config.mjs` imports it and
 * ESLint's configuration is loaded by Node before any compiler runs. This declaration is
 * what lets `no-secret-responses.spec.ts` import it and drive it through ESLint's
 * `RuleTester` under the same strict compiler settings as everything else — so the rule is
 * *tested* by TypeScript even though it is not *written* in it. The same arrangement
 * `no-secret-logging.d.ts` established for the vault's rule.
 */

import type { Rule } from "eslint";

/**
 * The words that name credential material in a response.
 *
 * Wider than the logging rule's on `key` and `token`; see the rule's header for why the two
 * lists differ rather than being shared.
 */
export declare const DENIED_RESPONSE_WORDS: ReadonlySet<string>;

/**
 * Does this property name name credential material?
 *
 * @param name - The property name.
 * @returns `true` when any of its words is denied.
 */
export declare function namesResponseSecret(name: string): boolean;

/** The rule: no credential-named property in anything the internal surface returns. */
export declare const noSecretResponses: Rule.RuleModule;
