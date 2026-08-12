// @ts-check
import eslint from "@eslint/js";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * ESLint flat config for the e2e suite (docs/CONVENTIONS.md § 6).
 *
 * Deliberately the same shape as `ouroboros-rest/eslint.config.mjs` — the type-checked
 * TypeScript rules plus Prettier as a lint rule rather than a second command — so that
 * `yarn lint` means the same thing here as it does in a module.
 *
 * One rule is this directory's own, and it is the reason the file is worth reading: the
 * suite may not import a module's *application* code. See below.
 */
export default tseslint.config(
  { ignores: ["playwright-report/**", "test-results/**", "blob-report/**"] },

  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  prettierRecommended,

  {
    languageOptions: {
      // Node only. The specs run in Node and drive a browser over the wire — nothing in
      // this directory is bundled into a page, so a browser global here is a mistake.
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    rules: {
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
    // The one rule that is specific to this suite.
    //
    // An end-to-end test earns its cost by going through the same door a user does: over
    // HTTP, against a running container. The moment it imports a service's own code it
    // stops proving the deployment and starts proving the source tree — a route handler
    // called directly passes while the container that would have served it is broken.
    //
    // Two files are exempt, and they are exempt in `support/session.ts` and nowhere else:
    // `auth/session.ts` and `auth/signing.ts`, which mint the session cookie the browser
    // carries. That is a *credential format*, not behaviour, and sharing it is the point —
    // duplicating the HMAC here would let the two drift until the suite was signing
    // cookies the running service rejects. The narrow allowance is what keeps it from
    // becoming the general habit this rule exists to prevent.
    //
    // **The exception is no longer used, and the rule now covers every file.**
    // [#703](https://github.com/NobuData/ouroboros/issues/703) deleted the module
    // `support/session.ts` imported: a session is a database row now rather than a signed
    // cookie, and there is nothing left to import. The `ignores` entry is kept so that the
    // reasoning above survives for whoever restores signing in — #705 and #709 — and so
    // that they have to decide again rather than inherit the allowance by accident.
    files: ["**/*.ts"],
    ignores: ["support/session.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/ouroboros-rest/**", "**/ouroboros-ui/**", "**/ouroboros-engine/**"],
              message:
                "An e2e test reaches a service over HTTP, not by importing it. " +
                "The one exception is support/session.ts — see eslint.config.mjs.",
            },
          ],
        },
      ],
    },
  },

  {
    // Configuration files sit outside the type-aware program, as they do in every module.
    files: ["**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
