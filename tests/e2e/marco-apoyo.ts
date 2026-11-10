import type { Page } from "@playwright/test";

/** Taller del Cierre (seed-pagos.sql) y la sesión de Gil que siembra seed-pagos.sql: el marco y el fondo entran con ella. */
export const EMPRESA = "33333333-3333-4333-8333-333333333333";
export const INICIO = `/c/${EMPRESA}/consola`;
const GIL = "a".repeat(43);
const ORIGEN = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PUERTO ?? "3109"}`;

export async function entrar(page: Page, token = GIL) {
  await page.context().clearCookies();
  // `next start` corre en producción: la cookie de sesión lleva el prefijo __Host- (Secure, Path=/, sin Domain).
  await page.context().addCookies([
    { name: "__Host-sesion", value: token, domain: new URL(ORIGEN).hostname, path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
  ]);
}
