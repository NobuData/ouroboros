// @ts-check
import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * ESLint flat config for ouroboros-docs.
 *
 * The recommended JavaScript and TypeScript sets over the site's own code — the config
 * files, `src/` and `scripts/`. Docusaurus' generated `.docusaurus/` cache and the built
 * site are not code anybody wrote, so they are ignored. Formatting is Prettier's job and
 * is checked separately by `yarn format:check`.
 */
export default tseslint.config(
  { ignores: ["build/**", ".docusaurus/**", "node_modules/**"] },

  eslint.configs.recommended,
  tseslint.configs.recommended,

  {
    languageOptions: {
      // The config files and scripts run in Node; `src/` runs in the browser.
      globals: { ...globals.node, ...globals.browser },
    },
  },
);
