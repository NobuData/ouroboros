import type { NextConfig } from "next";

/**
 * Next.js configuration for the product UI.
 *
 * Deliberately empty. The scaffold (#39) needs no option that is not already the
 * framework default — Turbopack is the default bundler in Next 16, and the App Router
 * needs no opting in. `output: "standalone"` belongs to the production image
 * (#47), which is the change that gains something from it.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
