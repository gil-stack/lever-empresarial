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
          // same-origin, no no-referrer: con no-referrer el navegador manda «Origin: null» al enviar un formulario sin
          // JavaScript (o antes de que la página hidrate) y Next rechaza la acción de servidor con un 500. same-origin
          // sigue sin mandar la dirección a otros sitios, así que un enlace con token no sale de aquí.
          { key: "Referrer-Policy", value: "same-origin" },
          // Nada de la aplicación usa estas capacidades del navegador (ni el portapapeles: no hay botones de copiar). Si un
          // script ajeno llegara a la página, no puede pedirlas. Las passkeys de la entrada sí: solo este mismo origen
          // (tests/e2e/passkeys.spec.ts).
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), display-capture=(), " +
              "publickey-credentials-get=(self), publickey-credentials-create=(self)",
          },
        ],
      },
      // Va después de la regla general: la última que coincide gana, y sin esta
      // la descarga perdería su política aislada (sandbox).
      ...[
        "/consola/proveedores/documento/:id",
        "/c/:empresa/consola/proveedores/documento/:id",
        "/operacion/clientes/:id/expediente/documento/:documentoId",
        // Las descargas de PLD (Ola R2).
        "/operacion/pld/casos/:id/documento/:documentoId",
        "/operacion/pld/casos/:id/reporte",
        "/operacion/comite/sesiones/:id/acta",
        "/operacion/comite/actas/:actaId",
        "/operacion/reportes/archivo",
        "/operacion/conservacion/manifiesto",
      ].map((source) => ({
        source,
        headers: [{ key: "Content-Security-Policy", value: POLITICA_DESCARGA }],
      })),
    ];
  },
  serverExternalPackages: ["pg", "bcryptjs"],
  experimental: {
    serverActions: {
      // Vercel corta el cuerpo en 4.5 MB (413 antes de la acción). Con el mismo límite,
      // local y e2e fallan igual que producción; los archivos topan en 4 MB (src/dominio/archivos.ts).
      bodySizeLimit: "4.5mb",
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
