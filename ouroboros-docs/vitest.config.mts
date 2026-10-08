import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for the site's configuration, module contract and React components. The
 * config and contract tests run in Node; component tests (`tests/components/`) opt into
 * jsdom with a `@vitest-environment jsdom` comment. Nothing here builds or serves the site.
 *
 * Docusaurus' `@docusaurus/*` client modules only exist inside a Docusaurus build, so the
 * ones the components import are replaced by small stand-ins from `tests/support/`.
 */
export default defineConfig({
  // The site's tsconfig leaves JSX for Docusaurus to compile (`jsx: preserve`); the tests
  // compile it themselves, with React's automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@docusaurus/Link": fileURLToPath(new URL("./tests/support/Link.tsx", import.meta.url)),
      "@docusaurus/useBaseUrl": fileURLToPath(
        new URL("./tests/support/useBaseUrl.ts", import.meta.url),
      ),
      "@theme/Layout": fileURLToPath(new URL("./tests/support/Layout.tsx", import.meta.url)),
      "@theme/ThemedImage": fileURLToPath(
        new URL("./tests/support/ThemedImage.tsx", import.meta.url),
      ),
      "@theme-original/MDXComponents": fileURLToPath(
        new URL("./tests/support/MDXComponents.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    setupFiles: ["tests/support/setup.ts"],
    css: { modules: { classNameStrategy: "non-scoped" } },
  },
});
