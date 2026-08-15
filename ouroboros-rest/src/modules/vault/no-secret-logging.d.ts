/**
 * Types for `no-secret-logging.mjs`.
 *
 * The rule itself has to be plain JavaScript, because `eslint.config.mjs` imports it and
 * ESLint's configuration is loaded by Node before any compiler runs. This declaration is
 * what lets `no-secret-logging.spec.ts` import it and drive it through ESLint's
 * `RuleTester` under the same strict compiler settings as everything else — so the rule is
 * *tested* by TypeScript even though it is not *written* in it.
 *
 * The import specifier in the spec is extensionless (`./no-secret-logging`), which is what
 * makes both resolvers agree: TypeScript finds this file, and Jest finds the `.mjs` through
 * its `moduleFileExtensions`.
 */

import type { ESLint, Rule } from "eslint";

/** Method names treated as log sinks — `log`, `warn`, `error`, `debug`, `verbose`, `fatal`, … */
export declare const LOG_METHODS: ReadonlySet<string>;

/** The words that name secret material. `key` is deliberately absent; see the rule's header. */
export declare const DENIED_WORDS: ReadonlySet<string>;

/**
 * Split an identifier into lower-cased words, on camelCase and non-letter boundaries.
 *
 * @param name - The identifier or property name.
 * @returns Its words, lower-cased.
 */
export declare function words(name: string): string[];

/**
 * Does this name name secret material?
 *
 * @param name - The identifier or property name.
 * @returns `true` when any of its words is in {@link DENIED_WORDS}.
 */
export declare function namesSecret(name: string): boolean;

/** The rule: no secret-named identifier may appear inside a call to a log sink. */
export declare const noSecretLogging: Rule.RuleModule;

/** The plugin `eslint.config.mjs` registers the rule through, as `ouroboros/…`. */
export declare const ouroborosPlugin: ESLint.Plugin;
