import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: false,
  // No custom turbopack.root – let Next.js handle it
};

export default nextConfig;
