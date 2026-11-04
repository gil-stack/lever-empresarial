import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "bcryptjs"],
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
  agentRules: false,
};

export default nextConfig;
