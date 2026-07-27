import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma's generated client (custom output path, not node_modules) ships
  // its native query engine binary alongside itself. Next.js's serverless
  // bundler doesn't trace that automatically for a custom output location,
  // so every route that touches the database needs it included explicitly.
  outputFileTracingIncludes: {
    "/*": ["./src/generated/prisma/**/*"],
  },
};

export default nextConfig;
