import type { NextConfig } from "next";

import { POLITICA_DESCARGA } from "./src/server/pagos-proveedores/descarga";

const nextConfig: NextConfig = {
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
      // Va después de la regla general: la última que coincide gana, y sin esta
      // la descarga perdería su política aislada.
      ...["/consola/proveedores/documento/:id", "/c/:empresa/consola/proveedores/documento/:id"].map((source) => ({
        source,
        headers: [{ key: "Content-Security-Policy", value: POLITICA_DESCARGA }],
      })),
    ];
  },
  serverExternalPackages: ["pg", "bcryptjs"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  agentRules: false,
};

export default nextConfig;
