import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle so the Docker runtime stage
  // only needs .next/standalone + .next/static + public.
  output: "standalone",
};

export default nextConfig;
