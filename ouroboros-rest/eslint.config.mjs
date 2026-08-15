// @ts-check
import eslint from "@eslint/js";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";
import tseslint from "typescript-eslint";

import { ouroborosPlugin } from "./src/modules/vault/no-secret-logging.mjs";

/**
 * ESLint flat config for ouroboros-rest (docs/CONVENTIONS.md § 6).
 *
 * Two things about it are deliberate:
 *
 *   * The TypeScript rules are the *type-checked* set. The whole point of a strict
 *     `tsconfig` is that the types are trustworthy, and the rules that read them are
 *     the ones that catch a floating promise or an `any` leaking out of a library.
 *   * Prettier runs as a lint rule rather than as a second command. `docs/CONVENTIONS.md`
 *     § 3 lists formatting as something `yarn lint` covers, so a badly formatted file
 *     fails CI the same way a badly typed one does — there is no separate check to
 *     forget. `yarn format` is the fixer, not the gate.
 */
export default tseslint.config(
  // Build output and coverage reports are generated: linting them reports on code
  // nobody wrote and nobody can fix.
  { ignores: ["dist/**", "coverage/**"] },

  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  prettierRecommended,

  {
    languageOptions: {
      // Node for the application, Jest for the spec files beside it. Neither adds a
      // browser global — nothing in this module runs in one.
      globals: { ...globals.node, ...globals.jest },
      parserOptions: {
        // Resolves each file through the tsconfig that actually owns it, so the
        // type-aware rules above see the same types `yarn typecheck` does.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    rules: {
      // A leading underscore is how this codebase says "this parameter is part of the
      // signature and deliberately unread" — a framework callback that only wants its
      // second argument, or a table-driven test whose first column is the case name.
      // `tsconfig.json`'s noUnusedParameters already reads it that way; this is the same
      // rule for the linter, so the two do not disagree about the same file.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  {
    // Issue #28's acceptance criterion, as a rule rather than as a review habit: every
    // consumer reads configuration through the typed AppConfigService, and nothing
    // outside src/modules/config/ names an environment variable at all. A module that
    // reaches for process.env directly gets an unvalidated string, skips the redaction
    // rules, and moves the failure from boot to the first request that needed the value.
    //
    // Five kinds of file are exempt and all of them are boundaries rather than
    // exceptions: src/main.ts is the process entry point, which is *where* the environment
    // is read, and its spec is what proves it reads the real one. The integration suites
    // (#30) are the third — they are handed a database by whoever runs them, exactly as
    // the process is handed one by its operator, and there is nothing typed to read it
    // through before an application has been built around it. src/testing/ (#37) is the
    // fourth, and it is the same boundary seen from the other side: it is the thing that
    // *does* the handing, so `OURO_DATABASE_URL` is its output rather than its input.
    //
    // The fifth is src/auth/auth.config.ts (#700), and it is the first one for the same
    // reason src/main.ts is: it is a *second* process entry point. `@better-auth/cli` runs
    // it with no application anywhere, so there is no AppConfigService to read through —
    // it validates the environment itself, through the same `loadConfiguration` main.ts
    // uses, and hands the result to the same factory the application does.
    files: ["src/**/*.ts"],
    ignores: [
      "src/main.ts",
      "src/main.spec.ts",
      "src/auth/auth.config.ts",
      "src/auth/auth.config.spec.ts",
      "src/modules/config/**/*.ts",
      "src/testing/**/*.ts",
      "src/**/*.integration-spec.ts",
    ],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Read configuration through AppConfigService (src/modules/config). " +
            "Only src/main.ts touches process.env — see issue #28.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node:process",
              importNames: ["env"],
              message:
                "Read configuration through AppConfigService (src/modules/config) — issue #28.",
            },
            {
              name: "process",
              importNames: ["env"],
              message:
                "Read configuration through AppConfigService (src/modules/config) — issue #28.",
            },
          ],
        },
      ],
    },
  },

  {
    // Issue #222's last acceptance criterion, as a rule rather than as reviewer vigilance:
    // decrypted material lives only in request scope and never reaches a log. The rule
    // reports any identifier naming secret material — `secret`, `plaintext`, `dek`, `kek`,
    // `credential`, `password`, `master`, `material` — inside a call to a log sink. It is
    // deliberately loud rather than clever; `src/modules/vault/no-secret-logging.mjs` argues
    // why a name-based rule is the honest shape and why there is no allow-list.
    //
    // Applied to the whole service rather than to `src/modules/vault/` alone, because the
    // vault is where plaintext is *produced* and the modules that will consume it — AD.2's
    // credential lifecycle (#223), the provider adapters (#217/#218/#220) — are where it
    // would actually be logged. A rule scoped to the producer would be a rule that never
    // fired on the mistake it exists to catch.
    //
    // `src/modules/config/` is the one exemption, and it is the same shape as the
    // `process.env` exemption above: that directory names secrets *because* it is what
    // redacts them, so `SECRET_VARIABLES` and `redactDatabaseUrl` are the rule working
    // correctly and reporting the file that implements it.
    files: ["src/**/*.ts"],
    ignores: ["src/modules/config/**/*.ts"],
    plugins: { ouroboros: ouroborosPlugin },
    rules: { "ouroboros/no-secret-logging": "error" },
  },

  {
    // `unbound-method` is about a method that has been separated from its object and will
    // therefore be called with the wrong `this`. In a spec, `expect(repository.list)` does
    // exactly that separation and never calls anything — it hands Jest the mock so it can be
    // asked what it was called with — so every occurrence in a test file is a false positive.
    // This is the disable typescript-eslint's own documentation recommends for the case; the
    // alternative is `eslint-plugin-jest`'s rule, which is the same exemption plus a
    // dependency.
    //
    // Narrowed to the two suffixes that *are* tests, so a `this`-losing bug in application
    // code is still an error.
    files: ["**/*.spec.ts", "**/*.integration-spec.ts"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
    },
  },

  {
    // This file, the two jest configs and `jest.esm-transform.cjs` are configuration, not
    // application code: they are outside `tsconfig.json`'s `include`, so the type-aware
    // rules have no program to read them against. They are still linted and still
    // formatted — only the rules that need types are dropped.
    files: ["**/*.mjs", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    // `require` is what a `.cjs` file is for. Jest loads a transform synchronously, so
    // `jest.esm-transform.cjs` cannot be an ES module and cannot import one — which is
    // the same constraint the file exists to work around, seen from the other side.
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
