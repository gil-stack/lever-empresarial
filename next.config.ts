import type { NextConfig } from "next";

import { POLITICA_DESCARGA } from "./src/server/pagos-proveedores/descarga";

const nextConfig: NextConfig = {
  allowedDevOrigins: process.env.E2E_SERVER_ACTIONS === "1" ? ["127.0.0.1", "localhost"] : undefined,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          // La política de contenido (CSP) la pone el proxy con un nonce por petición: src/nucleo/csp.ts.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          // Todo *.leverpagos.com responde por https (Vercel DNS con comodín y certificado). Sin preload: lo decide Gil.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
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
      // Solo para la prueba de navegador local. Nunca un origen opaco («null»):
      // aceptarlo abriría las acciones a iframes con sandbox y a file://.
      allowedOrigins: process.env.E2E_SERVER_ACTIONS === "1"
        ? [`127.0.0.1:${process.env.E2E_PUERTO ?? "3109"}`, `localhost:${process.env.E2E_PUERTO ?? "3109"}`]
        : undefined,
    },
  },
  agentRules: false,
};

export default nextConfig;
