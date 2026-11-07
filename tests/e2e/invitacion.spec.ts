import { expect, test, type Page } from "@playwright/test";

import { CLAVE, bahia, codigoDeSemilla, codigoTotp, consultar, contar, correosPara, dobleClic, enlaceDe, sesionDe, vigilarConsola } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * Cuentas: Operación invita al primer administrador de Bahía E2E, el doble clic
 * en «Reenviar invitación» emite una sola invitación nueva (y un solo correo),
 * el enlace viejo deja de servir, el nuevo crea la cuenta con app autenticadora
 * y después la persona recupera su contraseña por correo. Los correos salen del
 * proveedor falso (tests/e2e/correo-local) y la prueba abre los enlaces que traen.
 * «Perdí el segundo factor» vive en operacion.spec.ts, donde se aprueba.
 */

test.describe.configure({ mode: "serial" });

const BRUNO = { nombre: "Bruno Salas", correo: "bruno@bahia-e2e.mx" };
const CLAVE_NUEVA = "otra-clave-segura-34";
let semillaBruno = "";

const invitacionesDe = (correo: string) => correosPara(correo).filter((c) => c.texto.includes("/invitacion/"));
const restablecimientosDe = (correo: string) => correosPara(correo).filter((c) => c.texto.includes("/recuperar/"));

async function entrar(page: Page, correo: string, contrasena: string): Promise<void> {
  await page.goto("/entrar");
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Contraseña", { exact: true }).fill(contrasena);
  await page.getByRole("button", { name: "Continuar" }).click();
}

test("invitación del primer administrador: el doble clic en «Reenviar» emite una sola y el enlace nuevo crea la cuenta", async ({ page, context }) => {
  test.setTimeout(120_000);
  const errores = vigilarConsola(page);
  const invitaciones = () => contar("select 1 from invitations where company_id = $1", [bahia()]);
  expect(await invitaciones()).toBe(0);
  expect(invitacionesDe(BRUNO.correo)).toHaveLength(0);

  await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
  await page.goto(`/operacion/clientes/${bahia()}`);
  await page.getByLabel("Nombre").fill(BRUNO.nombre);
  await page.getByLabel("Correo").fill(BRUNO.correo);
  const enviar = await dobleClic(page.getByRole("button", { name: "Enviar invitación" }), { esperar: /aviso=invitacion_enviada/ });
  expect(enviar.envios).toBe(1);
  await expect(page.getByText("Invitación enviada. El enlace anterior ya no sirve.")).toBeVisible();
  expect(await invitaciones()).toBe(1);
  await expect.poll(() => invitacionesDe(BRUNO.correo).length).toBe(1);
  const primera = invitacionesDe(BRUNO.correo)[0]!;

  // La ventana contra reenvíos seguidos es de 2 s: se espera a que pase, no se duerme a ciegas.
  const [emitida] = await consultar<{ ms: string }>(
    "select (extract(epoch from emitida_en) * 1000)::bigint::text as ms from invitations where company_id = $1",
    [bahia()],
  );
  await expect.poll(() => Date.now() - Number(emitida!.ms), { timeout: 10_000 }).toBeGreaterThan(2_500);

  const reenviar = await dobleClic(page.getByRole("button", { name: "Reenviar invitación" }), { esperar: /aviso=invitacion_enviada/ });
  expect(reenviar.envios).toBe(1);
  expect(await invitaciones()).toBe(2);
  expect(await contar("select 1 from invitations where company_id = $1 and revocada_en is null", [bahia()])).toBe(1);
  await expect.poll(() => invitacionesDe(BRUNO.correo).length).toBe(2);
  const segunda = invitacionesDe(BRUNO.correo)[1]!;
  expect(segunda.idempotencia).not.toBe(primera.idempotencia);

  // El enlace viejo ya no sirve; el nuevo crea la cuenta.
  await context.clearCookies();
  await page.goto(enlaceDe(primera, /\/invitacion\//));
  await expect(page.getByRole("heading", { name: "Esta invitación ya no sirve." })).toBeVisible();
  await page.goto(enlaceDe(segunda, /\/invitacion\//));
  await expect(page.getByRole("heading", { name: "Te invitaron a Bahía E2E." })).toBeVisible();
  await page.getByLabel("Contraseña nueva").fill(CLAVE);
  await page.getByLabel("Repite la contraseña").fill(CLAVE);
  const aceptar = await dobleClic(page.getByRole("button", { name: "Aceptar la invitación" }), { esperar: /\/entrar\/continuar/ });
  expect(aceptar.envios).toBe(1);
  expect(await contar("select 1 from invitations where company_id = $1 and usada_en is not null", [bahia()])).toBe(1);

  await expect(page.getByRole("heading", { name: "Registra cómo vas a entrar." })).toBeVisible();
  semillaBruno = (await page.locator(".arco-semilla").innerText()).trim();
  await page.getByLabel("Código que muestra la app").fill(codigoDeSemilla(semillaBruno));
  const confirmar = await dobleClic(page.getByRole("button", { name: "Confirmar el código" }));
  expect(confirmar.envios).toBe(1);
  await page.getByRole("checkbox", { name: "Ya los guardé en un lugar seguro" }).check();
  await page.getByRole("button", { name: "Entrar al portal" }).click();
  await expect(page.getByRole("navigation", { name: "Secciones" })).toBeVisible();

  const [cuenta] = await consultar<{ roles: string; estado: string; totp: number }>(
    `select string_agg(r.rol, ',' order by r.rol) as roles, m.estado,
            (select count(*)::int from auth_totp t where t.user_id = u.id and t.confirmado_en is not null and t.revocado_en is null) as totp
     from users u join memberships m on m.user_id = u.id and m.company_id = $2
     join membership_roles r on r.user_id = u.id and r.company_id = $2
     where u.correo = $1 group by u.id, m.estado`,
    [BRUNO.correo, bahia()],
  );
  expect(cuenta).toEqual({ roles: "administrador", estado: "activa", totp: 1 });
  expect(errores).toEqual([]);
});

test("recuperar la contraseña por correo: un enlace, cierra las sesiones y entra con la nueva y su factor de siempre", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  expect(semillaBruno).not.toBe("");
  const restablecimientos = () => contar("select 1 from password_resets r join users u on u.id = r.user_id where u.correo = $1", [BRUNO.correo]);
  const vivas = () => contar("select 1 from sessions s join users u on u.id = s.user_id where u.correo = $1 and s.expires_at > now()", [BRUNO.correo]);
  expect(await restablecimientos()).toBe(0);
  expect(await vivas()).toBeGreaterThan(0);

  await context.clearCookies();
  await page.goto("/entrar");
  await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
  await page.waitForURL(/\/recuperar$/);
  await page.getByLabel("Correo").fill(BRUNO.correo);
  const pedir = await dobleClic(page.getByRole("button", { name: "Enviar el enlace" }));
  expect(pedir.envios).toBe(1);
  await expect(page.getByText("Si ese correo tiene cuenta, te llega un enlace en unos minutos.", { exact: false })).toBeVisible();
  // El correo sale después de responder (after()): se espera a que llegue.
  await expect.poll(() => restablecimientosDe(BRUNO.correo).length).toBe(1);
  expect(await restablecimientos()).toBe(1);

  await page.goto(enlaceDe(restablecimientosDe(BRUNO.correo)[0]!, /\/recuperar\//));
  await page.getByLabel("Contraseña nueva").fill(CLAVE_NUEVA);
  await page.getByLabel("Repite la contraseña").fill(CLAVE_NUEVA);
  const guardar = await dobleClic(page.getByRole("button", { name: /Guardar/ }));
  expect(guardar.envios).toBe(1);
  await expect(page.getByText("Cerramos todas tus sesiones. Entra con la contraseña nueva y tu segundo factor de siempre.")).toBeVisible();
  expect(await contar("select 1 from password_resets r join users u on u.id = r.user_id where u.correo = $1 and r.usado_en is not null", [BRUNO.correo])).toBe(1);
  expect(await vivas()).toBe(0);

  // La contraseña vieja ya no entra; la nueva sí, con el mismo factor.
  await entrar(page, BRUNO.correo, CLAVE);
  await expect(page.locator('.alerta[role="alert"]')).toContainText("El correo o la contraseña no coinciden.");
  await entrar(page, BRUNO.correo, CLAVE_NUEVA);
  await page.waitForURL(/\/entrar\/continuar/);
  await page.getByLabel("Código de la app autenticadora").fill(await codigoTotp(BRUNO.correo, semillaBruno));
  await page.getByRole("button", { name: "Entrar con el código" }).click();
  await expect(page.getByRole("navigation", { name: "Secciones" })).toBeVisible();
  expect(errores).toEqual([]);
});
