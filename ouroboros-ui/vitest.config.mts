import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Vitest + Testing Library, per the bundled Next.js guide
 * (`node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`).
 *
 * The guide reaches for the `vite-tsconfig-paths` plugin; Vite 8 resolves tsconfig
 * `paths` itself, and says so on startup if the plugin is installed anyway. The option
 * below is what makes the `@/*` alias resolve in tests, so a test imports a module by
 * exactly the specifier the application uses.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    // The DOM implementation React Testing Library renders into.
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Tests live in __tests__/, mirroring the app/ tree. Keeping them out of app/
    // means no test file can ever be mistaken for a route segment.
    include: ["__tests__/**/*.test.{ts,tsx}"],
  },
});
