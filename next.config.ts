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
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      // Va después de la regla general: la última que coincide gana, y sin esta
      // la descarga perdería su política aislada.
      ...[
        "/consola/proveedores/documento/:id",
        "/c/:empresa/consola/proveedores/documento/:id",
        // El comprobante de un pago de cobranza baja igual que el documento de un proveedor (r63-N5).
        "/consola/cobros/comprobante/:id",
        "/c/:empresa/consola/cobros/comprobante/:id",
      ].map((source) => ({
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
