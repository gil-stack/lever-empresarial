import { expect, test, type Page } from "@playwright/test";

import { CLAVE, altamar, codigoTotp, consultar, contar, dobleClic, sesionDe, vigilarConsola } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * Personas y nómina en Altamar E2E: alta de una persona con nómina, cambio de
 * la CLABE de nómina que exige un segundo factor reciente y preparación del
 * lote vencido. Cada envío se hace con doble clic real y la base confirma que
 * quedó una sola operación.
 */

test.describe.configure({ mode: "serial" });

const en = (ruta: string) => `/c/${altamar()}${ruta}`;
const hoy = () => process.env.E2E_TODAY ?? new Date().toISOString().slice(0, 10);
const LUIS = "Luis Ramos";

/** CLABE de 18 dígitos con el dígito de control de ponderación 3, 7, 1. */
function clabe(base17: string): string {
  const pesos = [3, 7, 1];
  const suma = [...base17].reduce((total, d, i) => total + ((Number(d) * pesos[i % 3]!) % 10), 0);
  return `${base17}${(10 - (suma % 10)) % 10}`;
}

async function empleado(nombre: string): Promise<{ id: string; clabe: string | null }> {
  const [fila] = await consultar<{ id: string; clabe: string | null }>(
    "select id, clabe from employees where company_id = $1 and nombre = $2",
    [altamar(), nombre],
  );
  if (!fila) throw new Error(`No existe ${nombre} en Altamar E2E.`);
  return fila;
}

async function entrarComoLaura(page: Page): Promise<void> {
  await page.goto("/entrar");
  await page.getByLabel("Correo").fill(CORREOS.laura);
  await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/entrar\/continuar/);
  await page.getByLabel("Código de la app autenticadora").fill(await codigoTotp(CORREOS.laura));
  await page.getByRole("button", { name: "Entrar con el código" }).click();
  await expect(page.getByRole("navigation", { name: "Secciones" })).toBeVisible();
}

test("alta de una persona con nómina: doble clic guarda una sola ficha, un perfil y una CLABE", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, CORREOS.laura);
  const clabeLuis = clabe("01218000118359719");
  const personas = () => contar("select 1 from employees where company_id = $1 and nombre = $2", [altamar(), LUIS]);
  expect(await personas()).toBe(0);

  await page.goto(en("/consola/personas/nueva"));
  await page.getByLabel("Nombre completo").fill(LUIS);
  await page.getByLabel("Fecha de ingreso").fill(hoy());
  await page.getByLabel("Área", { exact: true }).selectOption({ label: "Operación" });
  await page.getByLabel("Neto por pago").fill("8500");
  await page.getByLabel("Frecuencia").selectOption("mensual");
  await page.getByLabel("Primer pago").fill(hoy());
  await page.locator('input[name="destino"][value="clabe"]').check();
  await page.getByLabel("CLABE", { exact: true }).fill(clabeLuis);
  await page.getByLabel("Usuario de plataforma").selectOption("no");
  const alta = await dobleClic(page.getByRole("button", { name: "Dar de alta colaborador" }), { esperar: /\/consola\/personas\/[0-9a-f-]{36}$/ });
  expect(alta.envios).toBe(1);
  await expect(page.getByRole("heading", { name: LUIS, exact: true })).toBeVisible();

  const luis = await empleado(LUIS);
  expect(await personas()).toBe(1);
  expect(page.url()).toContain(luis.id);
  expect(luis.clabe).toBe(clabeLuis);
  const [perfil] = await consultar<{ neto: number; frecuencia: string; proximo: string; destino: string }>(
    "select neto_centavos::int as neto, frecuencia, proximo_pago_en::text as proximo, destino from employee_payroll_profiles where employee_id = $1",
    [luis.id],
  );
  expect(perfil).toEqual({ neto: 850000, frecuencia: "mensual", proximo: hoy(), destino: "clabe" });
  expect(await contar("select 1 from employee_payroll_clabes where employee_id = $1", [luis.id])).toBe(1);
  expect(await contar("select 1 from audit_log where accion = 'alta_persona' and identificador = $1", [luis.id])).toBe(1);
  expect(errores).toEqual([]);
});

test("cambio de CLABE de nómina: con factor viejo pide «Confirma que eres tú»; tras volver a entrar, doble clic = un cambio", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const ana = await empleado("Ana Torres");
  const nueva = clabe("01418000201234567");
  expect(ana.clabe).not.toBe(nueva);
  const historial = () => contar("select 1 from employee_payroll_clabes where employee_id = $1", [ana.id]);
  const cambios = () => contar("select 1 from audit_log where accion = 'cambiar_clabe_nomina' and identificador = $1", [ana.id]);
  const [historialAntes, cambiosAntes] = [await historial(), await cambios()];

  // Sesión con el segundo factor de hace 31 minutos: la ventana es de 30.
  await sesionDe(context, CORREOS.laura, { factorHaceMinutos: 31 });
  await page.goto(en(`/consola/personas/${ana.id}`));
  await page.locator("#nomina-clabe").fill(nueva);
  await page.getByRole("button", { name: "Cambiar CLABE de nómina" }).click();
  await expect(page.getByText("Confirma que eres tú")).toBeVisible();
  await expect(page.getByText("Cambiar la CLABE de nómina exige haber verificado tu segundo factor en los últimos 30 minutos.")).toBeVisible();
  expect((await empleado("Ana Torres")).clabe).toBe(ana.clabe);
  expect(await historial()).toBe(historialAntes);
  expect(await cambios()).toBe(cambiosAntes);

  // Sale desde el menú de la cuenta y vuelve a entrar con contraseña y código.
  await page.locator(".cuenta .menu-desplegable-boton").click();
  await page.getByRole("menuitem", { name: "Salir" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/consola"));
  await entrarComoLaura(page);

  await page.goto(en(`/consola/personas/${ana.id}`));
  await page.locator("#nomina-clabe").fill(nueva);
  const envio = await dobleClic(page.getByRole("button", { name: "Cambiar CLABE de nómina" }));
  expect(envio.envios).toBe(1);
  await expect(page.getByText("La CLABE de nómina cambió y la anterior quedó en el historial.")).toBeVisible();
  expect((await empleado("Ana Torres")).clabe).toBe(nueva);
  expect(await historial()).toBe(historialAntes + 1);
  expect(await contar("select 1 from employee_payroll_clabes where employee_id = $1 and vigente_hasta is null", [ana.id])).toBe(1);
  expect(await cambios()).toBe(cambiosAntes + 1);
  // La bitácora guarda solo terminaciones, nunca los 18 dígitos.
  const [evento] = await consultar<{ cambio: string }>(
    "select cambio::text as cambio from audit_log where accion = 'cambiar_clabe_nomina' and identificador = $1 order by ocurrido_en desc limit 1",
    [ana.id],
  );
  expect(evento?.cambio).not.toContain(nueva);
  await expect(page.locator(".clabe-historial tbody tr")).toHaveCount(historialAntes + 1);
  expect(errores).toEqual([]);
});

test("preparar el lote vencido: doble clic = un lote con sus renglones y el calendario avanza", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, CORREOS.laura);
  const luis = await empleado(LUIS);
  const lotes = () => contar("select 1 from payroll_batches where company_id = $1", [altamar()]);
  const lotesAntes = await lotes();
  const [elegibles] = await consultar<{ n: number; total: number }>(
    `select count(*)::int as n, coalesce(sum(p.neto_centavos), 0)::int as total
     from employee_payroll_profiles p join employees e on e.id = p.employee_id
     where p.company_id = $1 and p.activa and p.proximo_pago_en = $2::date and e.alta_en <= p.proximo_pago_en`,
    [altamar(), hoy()],
  );
  expect(elegibles?.n).toBeGreaterThan(0);

  await page.goto(en("/consola/personas/nomina"));
  const lote = await dobleClic(page.getByRole("button", { name: /^Preparar nómina del / }), { esperar: /\/consola\/personas\/nomina\/[0-9a-f-]{36}$/ });
  expect(lote.envios).toBe(1);
  const loteId = page.url().split("/").at(-1)!;
  expect(await lotes()).toBe(lotesAntes + 1);
  const [guardado] = await consultar<{ fecha: string; total: number }>(
    "select fecha_pago::text as fecha, total_centavos::int as total from payroll_batches where id = $1",
    [loteId],
  );
  expect(guardado).toEqual({ fecha: hoy(), total: elegibles!.total });
  expect(await contar("select 1 from payroll_batch_items where batch_id = $1", [loteId])).toBe(elegibles!.n);
  expect(await contar("select 1 from payroll_batch_items where batch_id = $1 and employee_id = $2", [loteId, luis.id])).toBe(1);
  expect(await contar("select 1 from audit_log where accion = 'preparar_nomina' and identificador = $1", [loteId])).toBe(1);
  const [perfil] = await consultar<{ proximo: string }>(
    "select proximo_pago_en::text as proximo from employee_payroll_profiles where employee_id = $1",
    [luis.id],
  );
  expect(perfil!.proximo > hoy()).toBe(true);
  await expect(page.locator("tbody tr")).toHaveCount(elegibles!.n);

  // Ya no queda nada vencido: el botón espera la siguiente fecha.
  await page.goto(en("/consola/personas/nomina"));
  await expect(page.getByRole("button", { name: "Preparar nómina vencida" })).toBeDisabled();
  expect(errores).toEqual([]);
});
