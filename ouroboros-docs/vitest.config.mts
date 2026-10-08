import { defineConfig } from "vitest/config";

/**
 * Unit tests for the site's configuration and module contract. They read the config and
 * manifest in Node; nothing here builds or serves the site.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
