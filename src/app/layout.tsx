import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { IBM_Plex_Mono, Inter, Sora } from "next/font/google";

import { COOKIE_TEMA, FONDO_DEL_TEMA, temaDesde } from "@/components/cromo/tema";

import "@/estilo/tokens.css";
import "@/estilo/arco.css";
import "@/estilo/marco.css";
import "@/estilo/telefono.css";
import "@/estilo/componentes.css";
import "@/estilo/proveedores.css";
import "./globals.css";
import "@/estilo/landing.css";

/** Cuerpo: la pila del sistema primero y, donde no hay SF, Inter. */
const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

/** Sora: títulos, cifras y la palabra «lever». */
const arco = Sora({
  subsets: ["latin"],
  weight: ["200", "300", "400", "500", "600"],
  variable: "--font-arco",
  display: "swap",
});

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: {
    default: "Lever Empresas",
    template: "%s · Lever Empresas",
  },
  description: "Lever Empresas: control de gasto empresarial diseñado para razones sociales mexicanas.",
  applicationName: "Lever Empresas",
};

async function temaElegido() {
  return temaDesde((await cookies()).get(COOKIE_TEMA)?.value);
}

export async function generateViewport(): Promise<Viewport> {
  const tema = await temaElegido();
  return {
    themeColor: FONDO_DEL_TEMA[tema],
    colorScheme: tema === "claro" ? "light" : "dark",
    width: "device-width",
    initialScale: 1,
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const tema = await temaElegido();
  return (
    <html lang="es" data-tema={tema} className={`${sans.variable} ${mono.variable} ${arco.variable}`}>
      <body>{children}</body>
    </html>
  );
}
