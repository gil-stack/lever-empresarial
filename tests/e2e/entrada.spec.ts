import { expect, test, type Page } from "@playwright/test";

import { CLAVE, codigoTotp, contar, dobleClic, idDe, vigilarConsola } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * Entrada de cliente con contraseña y app autenticadora, y el tope de intentos
 * sin revelar qué correos tienen cuenta (#57): con un correo real y con uno que
 * no existe, el mismo texto, el mismo marcado, la misma dirección y el mismo
 * tiempo del servidor (piso de 1.5 s).
 */

const MALA = "otra-clave-99";
const PISO_MS = 1_500;
const INEXISTENTE = "nadie@altamar-e2e.mx";

test("entra con contraseña y código TOTP: doble clic abre una sola entrada y una sola sesión", async ({ page }) => {
  const errores = vigilarConsola(page);
  const userId = await idDe(CORREOS.entrada);
  const entradas = () => contar("select 1 from auth_entradas where user_id = $1", [userId]);
  const sesiones = () => contar("select 1 from sessions where user_id = $1", [userId]);
  const [entradasAntes, sesionesAntes] = [await entradas(), await sesiones()];

  await page.goto("/entrar");
  await page.getByLabel("Correo").fill(CORREOS.entrada);
  await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  const continuar = await dobleClic(page.getByRole("button", { name: "Continuar" }), { esperar: /\/entrar\/continuar/ });
  expect(continuar.envios).toBe(1);
  expect(await entradas()).toBe(entradasAntes + 1);

  // Un código equivocado no abre sesión y lo dice junto al campo.
  await page.getByLabel("Código de la app autenticadora").fill("000000");
  await page.getByRole("button", { name: "Entrar con el código" }).click();
  await expect(page.locator("#factor-error")).toBeVisible();
  expect(await sesiones()).toBe(sesionesAntes);

  await page.getByLabel("Código de la app autenticadora").fill(await codigoTotp(CORREOS.entrada));
  const codigo = await dobleClic(page.getByRole("button", { name: "Entrar con el código" }), { esperar: /\/(consola|c\/[0-9a-f-]{36}\/consola|empresas)/ });
  expect(codigo.envios).toBe(1);
  expect(await sesiones()).toBe(sesionesAntes + 1);
  expect(await contar("select 1 from audit_log where accion = 'entrada_completa' and actor_id = $1", [userId])).toBe(1);
  await expect(page.getByRole("navigation", { name: "Secciones" })).toBeVisible();
  expect(errores).toEqual([]);
});

type Respuesta = { servidor: number; texto: string; marcado: string; direccion: string };

/** Un intento en el mismo formulario de /entrar: el rechazo deja la página donde está. */
async function intentar(page: Page, correo: string, contrasena: string): Promise<Respuesta> {
  const aviso = page.locator('.alerta[role="alert"]');
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Contraseña", { exact: true }).fill(contrasena);
  const envio = page.waitForResponse((r) => r.request().method() === "POST");
  await page.getByRole("button", { name: "Continuar" }).click();
  const respuesta = await envio;
  await page.waitForFunction(() => !document.querySelector('form[aria-busy="true"], button[aria-busy="true"]'));
  await expect(aviso).toBeVisible();
  // Del envío al primer byte: la acción ya terminó (sin el pintado del navegador).
  const t = respuesta.request().timing();
  return {
    servidor: Math.round(t.responseStart - t.requestStart),
    texto: (await aviso.innerText()).replace(/\s+/g, " ").trim(),
    marcado: await aviso.evaluate((n) => n.outerHTML),
    direccion: new URL(page.url()).pathname + new URL(page.url()).search,
  };
}

test("el tope de intentos no revela si el correo tiene cuenta: mismo texto y mismo tiempo", async ({ page }) => {
  test.setTimeout(240_000);
  const errores = vigilarConsola(page);
  const userId = await idDe(CORREOS.tope);
  expect(await contar("select 1 from users where correo = $1", [INEXISTENTE])).toBe(0);
  const fallos = () => contar("select 1 from audit_log where accion = 'entrada_fallida' and identificador = $1", [userId]);
  const entradas = () => contar("select 1 from auth_entradas where user_id = $1", [userId]);
  expect(await fallos()).toBe(0);
  const entradasAntes = await entradas();

  const diferencias: number[] = [];
  await page.goto("/entrar");
  await expect(page.locator('.alerta[role="alert"]')).toHaveCount(0);
  // Ocho fallos llevan la cuenta real al tope; el noveno intento es con la contraseña correcta.
  for (let i = 1; i <= 9; i += 1) {
    const contrasena = i <= 8 ? MALA : CLAVE;
    // Se alterna quién va primero para que el orden no sesgue el tiempo.
    const [real, nadie] = i % 2 === 1
      ? [await intentar(page, CORREOS.tope, contrasena), await intentar(page, INEXISTENTE, contrasena)]
      : await (async () => {
        const n = await intentar(page, INEXISTENTE, contrasena);
        return [await intentar(page, CORREOS.tope, contrasena), n];
      })();
    const donde = `intento ${i}${i === 9 ? " (contraseña correcta, cuenta en el tope)" : ""}`;
    expect(real.texto, donde).toBe(nadie.texto);
    expect(real.texto, donde).toContain("Si fallaste varias veces, espera quince minutos.");
    expect(real.marcado, donde).toBe(nadie.marcado);
    expect(real.direccion, donde).toBe(nadie.direccion);
    expect(real.servidor, donde).toBeGreaterThanOrEqual(PISO_MS);
    expect(nadie.servidor, donde).toBeGreaterThanOrEqual(PISO_MS);
    diferencias.push(Math.abs(real.servidor - nadie.servidor));
  }
  const mediana = [...diferencias].sort((a, b) => a - b)[Math.floor(diferencias.length / 2)]!;
  console.log(`[tope] diferencias en el servidor (ms): ${diferencias.join(", ")} · mediana ${mediana}`);
  expect(Math.max(...diferencias), `diferencias: ${diferencias.join(", ")}`).toBeLessThanOrEqual(250);
  expect(mediana).toBeLessThanOrEqual(60);
  // La bitácora anota los 8 fallos; el intento en el tope no se anota y la contraseña correcta no abrió entrada.
  expect(await fallos()).toBe(8);
  expect(await entradas()).toBe(entradasAntes);
  expect(errores).toEqual([]);
});
