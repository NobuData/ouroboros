// @ts-check
import eslint from "@eslint/js";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";
import tseslint from "typescript-eslint";

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
    // This file and jest.config.mjs are configuration, not application code: they are
    // outside `tsconfig.json`'s `include`, so the type-aware rules have no program to
    // read them against. They are still linted and still formatted — only the rules
    // that need types are dropped.
    files: ["**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
