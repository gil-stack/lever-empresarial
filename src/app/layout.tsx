import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Geist, Geist_Mono, Sora } from "next/font/google";

import { COOKIE_TEMA, temaDesde } from "@/components/cromo/tema";

import "@/estilo/tokens.css";
import "@/estilo/arco.css";
import "@/estilo/marco.css";
import "@/estilo/telefono.css";
import "@/estilo/componentes.css";
import "@/estilo/proveedores.css";
import "./globals.css";
import "@/estilo/landing.css";

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const arco = Sora({
  subsets: ["latin"],
  variable: "--font-arco",
  display: "swap",
});

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: {
    default: "LEVER",
    template: "%s · LEVER",
  },
  description: "LEVER Pagos: control de gasto empresarial diseñado para razones sociales mexicanas.",
  applicationName: "LEVER Pagos",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0d10" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const tema = temaDesde((await cookies()).get(COOKIE_TEMA)?.value);
  return (
    <html
      lang="es"
      data-tema={tema === "auto" ? undefined : tema}
      className={`${sans.variable} ${mono.variable} ${arco.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
