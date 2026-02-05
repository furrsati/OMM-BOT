import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Output standalone build for better deployment compatibility
  output: "standalone",

  // Strict mode for better error detection
  reactStrictMode: true,

  // Configure environment variables that are safe to expose to the browser
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },

  // Disable image optimization since we don't use next/image extensively
  images: {
    unoptimized: true,
  },

  // Enable experimental features for better performance
  experimental: {
    // Optimize package imports
    optimizePackageImports: ["lucide-react", "recharts", "date-fns"],
  },

  // TypeScript configuration
  typescript: {
    // Type checking is done during development/CI, not build
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
