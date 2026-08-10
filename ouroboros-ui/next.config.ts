import { dirname } from "node:path";
import type { NextConfig } from "next";

/**
 * Next.js configuration for the product UI.
 *
 * Both options exist for the production image (#47) and for nothing else; the
 * development server behaves identically with or without them.
 */
const nextConfig: NextConfig = {
  /**
   * Emit `.next/standalone` — `server.js` plus only the `node_modules` files the build
   * actually traced — so the runtime image carries no package manager, no lockfile and
   * no dev dependency. It is what keeps that image far under the 300 MB the issue
   * budgets, and it is why `Dockerfile`'s runtime stage installs nothing.
   */
  output: "standalone",

  /**
   * Trace from the repository root rather than from this directory.
   *
   * This module is a Yarn workspace and `nodeLinker: node-modules` hoists its
   * dependencies to the root `node_modules` — one directory *above* the default tracing
   * root, which is the project directory. Left at the default, the trace would resolve
   * every dependency to a path outside its root and copy none of them, and the image
   * would build cleanly and then fail to start on a missing module.
   */
  outputFileTracingRoot: dirname(__dirname),
};

export default nextConfig;
