import { expect, type Page, test } from "@playwright/test";

import { CLAVE, contar, idDe, sesionDe, vigilarConsola } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * Passkeys con el autenticador virtual de Chromium (CDP, dominio WebAuthn), detrás del encabezado Permissions-Policy de
 * la aplicación, que deja crear y pedir credenciales solo al mismo origen. En el portal, Lucía (Altamar, sin segundo
 * factor) registra una passkey en /entrar/seguridad y entra con ella; en Operación, la primera persona del personal
 * (sin segundo factor) la registra en su primer ingreso (/operacion/continuar) y entra con ella la siguiente vez.
 * El servidor de la prueba corre con NODE_ENV=production y AUTENTICACION_DOMINIOS=localhost (tests/e2e/entorno.ts).
 */

test.describe.configure({ mode: "serial" });

const PERSONAL = "personal-e2e@ejemplo.mx";

/** Un autenticador de plataforma con clave residente y verificación del usuario, como el de un teléfono o una laptop. */
async function autenticadorVirtual(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { credenciales: async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials };
}

/** La política que mandó el servidor en la última página: la prueba pasa por ella, no por una página sin encabezados. */
function politicaDe(encabezados: Record<string, string> | undefined): string {
  return encabezados?.["permissions-policy"] ?? "";
}

test("portal: Lucía registra una passkey en /entrar/seguridad y entra con ella", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const userId = await idDe(CORREOS.lucia);
  const autenticador = await autenticadorVirtual(page);
  const vigentes = () => contar("select 1 from auth_passkeys where user_id = $1 and revocada_en is null", [userId]);
  expect(await vigentes()).toBe(0);

  await sesionDe(context, CORREOS.lucia, { superficie: "cliente" });
  await page.goto("/entrar/seguridad");
  await expect(page.getByText("No hay passkeys.")).toBeVisible();
  await page.getByRole("button", { name: "Agregar una passkey" }).click();
  await expect(page.locator(".arco-lista")).toContainText("Este dispositivo");
  expect(await vigentes()).toBe(1);
  expect(await contar("select 1 from audit_log where accion = 'passkey_registrada' and actor_id = $1", [userId])).toBe(1);
  expect((await autenticador.credenciales()).map((credencial) => [credencial.rpId, credencial.isResidentCredential])).toEqual([["localhost", true]]);

  // Sin sesión, la entrada pide la contraseña y luego la passkey del mismo dispositivo.
  await context.clearCookies();
  const conPasskey = () => contar("select 1 from sessions where user_id = $1 and segundo_factor = 'passkey'", [userId]);
  await page.goto("/entrar");
  await page.getByLabel("Correo").fill(CORREOS.lucia);
  await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/entrar\/continuar/);
  await page.getByRole("button", { name: "Entrar con passkey" }).click();
  await expect(page).toHaveURL(/\/(consola|c\/[0-9a-f-]{36}\/consola|empresas)/);
  expect(await conPasskey()).toBe(1);
  expect(await contar("select 1 from auth_entradas where user_id = $1 and verificada_con = 'passkey'", [userId])).toBe(1);
  expect(await contar("select 1 from auth_passkeys where user_id = $1 and ultimo_uso_en is not null", [userId])).toBe(1);
  expect(await contar("select 1 from audit_log where accion = 'entrada_completa' and actor_id = $1", [userId])).toBe(1);
  expect(errores).toEqual([]);
  // Todo lo anterior pasó por la política de la aplicación: crear y pedir credenciales, solo en el mismo origen.
  const politica = politicaDe((await page.goto("/entrar/seguridad"))?.headers());
  expect(politica).toContain("publickey-credentials-create=(self)");
  expect(politica).toContain("publickey-credentials-get=(self)");
});

test("Operación: el primer ingreso registra una passkey en /operacion/continuar y la siguiente entrada la usa", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const userId = await idDe(PERSONAL);
  const autenticador = await autenticadorVirtual(page);
  expect(await contar("select 1 from auth_passkeys where user_id = $1", [userId])).toBe(0);
  const entrar = async () => {
    await page.goto("/operacion/entrar");
    await page.getByLabel("Correo").fill(PERSONAL);
    await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.waitForURL(/\/operacion\/continuar/);
  };

  // Primer ingreso: sin segundo factor, Operación pide registrar uno; la passkey lo registra y deja los códigos de respaldo.
  await entrar();
  await page.getByRole("button", { name: "Crear una passkey" }).click();
  await expect(page.getByRole("heading", { name: "Guarda tus códigos de respaldo." })).toBeVisible();
  expect(await contar("select 1 from auth_passkeys where user_id = $1 and nombre = 'Dispositivo de operación' and revocada_en is null", [userId])).toBe(1);
  expect((await autenticador.credenciales()).map((credencial) => credencial.rpId)).toEqual(["localhost"]);
  await page.getByRole("button", { name: "Abrir operación" }).click();
  await page.waitForURL(/\/operacion$/);

  // Siguiente entrada: contraseña y la passkey del mismo dispositivo. La persona tiene una sola sesión (cada entrada
  // completa borra las anteriores): cuenta la entrada verificada con passkey y la sesión que queda.
  await context.clearCookies();
  const entradasConPasskey = () => contar("select 1 from auth_entradas where user_id = $1 and verificada_con = 'passkey'", [userId]);
  const antes = await entradasConPasskey();
  await entrar();
  await page.getByRole("button", { name: "Entrar con passkey" }).click();
  await expect(page).toHaveURL(/\/operacion$/);
  expect(await entradasConPasskey()).toBe(antes + 1);
  expect(await contar("select 1 from sessions where user_id = $1", [userId])).toBe(1);
  expect(await contar("select 1 from sessions where user_id = $1 and superficie = 'sofipo' and segundo_factor = 'passkey'", [userId])).toBe(1);
  expect(await contar("select 1 from auth_passkeys where user_id = $1 and ultimo_uso_en is not null", [userId])).toBe(1);
  expect(errores).toEqual([]);
  const politica = politicaDe((await page.goto("/operacion"))?.headers());
  expect(politica).toContain("publickey-credentials-create=(self)");
  expect(politica).toContain("publickey-credentials-get=(self)");
});
