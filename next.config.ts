import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: process.env.E2E_SERVER_ACTIONS === "1" ? ["127.0.0.1", "localhost"] : undefined,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
  serverExternalPackages: ["pg", "bcryptjs"],
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
      // Solo para la prueba de navegador local. Nunca un origen opaco («null»):
      // aceptarlo abriría las acciones a iframes con sandbox y a file://.
      allowedOrigins: process.env.E2E_SERVER_ACTIONS === "1"
        ? [`127.0.0.1:${process.env.E2E_PUERTO ?? "3107"}`, `localhost:${process.env.E2E_PUERTO ?? "3107"}`]
        : undefined,
    },
  },
  agentRules: false,
};

export default nextConfig;
