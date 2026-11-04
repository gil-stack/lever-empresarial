import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Sora, Fraunces, Geist, Geist_Mono } from "next/font/google";

import { COOKIE_TEMA, temaDesde } from "@/components/cromo/tema";

import "@/estilo/tokens.css";
import "@/estilo/marco.css";
import "@/estilo/telefono.css";
import "@/estilo/componentes.css";
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

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
});

const displayCursiva = Fraunces({
  subsets: ["latin"],
  variable: "--font-display-cursiva",
  display: "swap",
  style: "italic",
  axes: ["SOFT", "WONK", "opsz"],
});

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: {
    default: "ARCO",
    template: "%s · ARCO",
  },
  description: "Control de gasto empresarial diseñado para una razón social mexicana.",
  applicationName: "ARCO",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f1ec" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0d" },
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
      className={`${sans.variable} ${mono.variable} ${arco.variable} ${display.variable} ${displayCursiva.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
