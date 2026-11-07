import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

import { hoyEnMexico } from "../../src/dominio/personas";

const empresa = () => process.env.E2E_COMPANY_ID ?? "";
const hoy = () => hoyEnMexico(new Date());
const CLABE = "002180701150123452";
// Fuera del árbol versionado (test-results está en .gitignore); E2E_CAPTURAS la cambia, igual que en Pagos a proveedores.
const EVIDENCIA = process.env.E2E_CAPTURAS ?? "test-results/personas";

async function abrir(page: Page, ruta: string): Promise<void> {
  await page.goto(`/c/${empresa()}${ruta}`);
}

async function captura(page: Page, nombre: string): Promise<void> {
  if (process.env.E2E_SIN_CAPTURAS) return;
  mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: join(EVIDENCIA, `${nombre}.png`), fullPage: true });
}

async function iniciarAlta(page: Page, nombre: string, neto: string): Promise<void> {
  await abrir(page, "/consola/personas/nueva");
  await page.getByLabel("Nombre completo").fill(nombre);
  await page.getByLabel("Fecha de ingreso").fill(hoy());
  await page.getByLabel("Área", { exact: true }).selectOption({ label: "Tesorería E2E" });
  await page.getByLabel("Presupuesto individual mensual").fill("5000");
  await page.getByLabel("Neto por pago").fill(neto);
  await page.getByLabel("Frecuencia").selectOption("mensual");
  await page.getByLabel("Primer pago").fill(hoy());
}

async function terminarAlta(page: Page, nombre: string): Promise<string> {
  const altaFormulario = await page.locator('input[name="alta"]').inputValue();
  const pagoFormulario = await page.locator('input[name="primerPago"]').inputValue();
  await page.getByRole("button", { name: "Dar de alta colaborador" }).click();
  await page.waitForURL(/\/consola\/personas\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: nombre, exact: true })).toBeVisible();
  const id = page.url().split("/").at(-1);
  const cliente = new Client({ connectionString: process.env.E2E_OWNER_DATABASE_URL });
  await cliente.connect();
  const guardado = await cliente.query<{ alta: string; proximo: string }>(
    "select e.alta_en::text as alta, p.proximo_pago_en::text as proximo from employees e join employee_payroll_profiles p on p.employee_id = e.id where e.id = $1",
    [id],
  );
  await cliente.end();
  expect({ altaFormulario, pagoFormulario, guardado: guardado.rows[0] }).toEqual({
    altaFormulario,
    pagoFormulario,
    guardado: { alta: altaFormulario, proximo: pagoFormulario },
  });
  return page.url();
}

test("recorrido completo de colaboradores, presupuesto, nómina, tarjeta y baja", async ({ page, context, baseURL }) => {
  // `next start` corre en producción: la cookie de sesión lleva el prefijo __Host- (Secure, Path=/, sin Domain).
  // Con `url` http Playwright quita `secure` y Chromium rechaza el prefijo; con domain + path queda host-only.
  const host = new URL(baseURL ?? "http://localhost").hostname;
  await context.addCookies([
    { name: "__Host-sesion", value: process.env.E2E_SESSION_TOKEN ?? "", domain: host, path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
  ]);

  await abrir(page, "/consola/personas/areas");
  await page.getByLabel("Área", { exact: true }).fill("Tesorería E2E");
  await page.getByLabel("Presupuesto mensual").fill("100000");
  await page.getByRole("checkbox", { name: /Es un área de tesorería/ }).check();
  await page.getByRole("button", { name: "Crear área" }).click();
  await expect(page.getByText("El área quedó creada con su presupuesto.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tesorería E2E" })).toBeVisible();
  await captura(page, "01-area-presupuesto");

  await iniciarAlta(page, "Operativo Nómina", "10000");
  await page.locator('input[name="destino"][value="tarjeta"]').check();
  await page.getByLabel("Usuario de plataforma").selectOption("no");
  const operativo = await terminarAlta(page, "Operativo Nómina");
  await expect(page.getByText("Solicitud interna pendiente de emisión")).toBeVisible();
  await expect(page.getByText("Sin usuario", { exact: true })).toBeVisible();
  await captura(page, "02-solo-tarjeta");

  await iniciarAlta(page, "Tesorería Mixta", "20000");
  await page.locator('input[name="destino"][value="tarjeta"]').check();
  await page.getByLabel("Usuario de plataforma").selectOption("nueva");
  await page.getByLabel("Correo").fill("tesoreria-e2e@ejemplo.mx");
  await page.getByRole("checkbox", { name: "Administrador", exact: true }).check();
  await page.getByRole("checkbox", { name: "Liberador", exact: true }).check();
  const tesoreria = await terminarAlta(page, "Tesorería Mixta");
  await expect(page.getByText("Invitación pendiente", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Solicitud interna pendiente de emisión")).toBeVisible();
  await captura(page, "03-acceso-y-tarjeta");

  await iniciarAlta(page, "Contadora Externa", "5000");
  await page.getByLabel("CLABE", { exact: true }).fill(CLABE);
  await page.getByLabel("Usuario de plataforma").selectOption("no");
  await terminarAlta(page, "Contadora Externa");
  await expect(page.getByText("002 180 70115012345 2", { exact: false })).toBeVisible();

  await abrir(page, "/consola/personas");
  await page.locator("#q").fill("Operativo");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Operativo Nómina", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tesorería Mixta", exact: true })).toHaveCount(0);
  await captura(page, "04-directorio-filtros");

  await page.goto(tesoreria);
  await page.locator("#nomina-neto").fill("21000");
  await page.getByRole("button", { name: "Guardar programación" }).click();
  await expect(page.getByText("La nómina quedó programada.")).toBeVisible();

  await abrir(page, "/consola/personas/nomina");
  const fechaBoton = await page.locator('input[name="fechaPago"]').inputValue();
  const verificacion = new Client({ connectionString: process.env.E2E_OWNER_DATABASE_URL });
  await verificacion.connect();
  const perfiles = await verificacion.query<{
    nombre: string;
    proximo: string;
    alta: string;
    baja: string | null;
    activa: boolean;
    neto: number;
    destino: string;
  }>(`
    select e.nombre, p.proximo_pago_en::text as proximo, e.alta_en::text as alta,
           e.baja_en::text as baja, p.activa, p.neto_centavos::int as neto, p.destino
    from employee_payroll_profiles p
    join employees e on e.id = p.employee_id and e.company_id = p.company_id
    where p.company_id = $1 order by e.nombre
  `, [empresa()]);
  await verificacion.end();
  expect(perfiles.rows).toHaveLength(3);
  const elegibles = perfiles.rows.filter((perfil) =>
    perfil.activa && perfil.proximo === fechaBoton && perfil.alta <= perfil.proximo &&
    (perfil.baja === null || perfil.proximo <= perfil.baja),
  );
  expect(elegibles.length, JSON.stringify({ fechaBoton, perfiles: perfiles.rows }, null, 2)).toBeGreaterThan(0);
  const totalElegible = elegibles.reduce((total, perfil) => total + perfil.neto, 0);
  const pendientesElegibles = elegibles.filter((perfil) => perfil.destino === "tarjeta").length;
  const totalVisible = `$${(totalElegible / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  await page.getByRole("button", { name: /^Preparar nómina del / }).click();
  await page.waitForURL(/\/consola\/personas\/nomina\/[0-9a-f-]{36}$/);
  await expect(page.getByText(totalVisible, { exact: true }).first()).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(elegibles.length);
  await expect(page.getByText("Preparada", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Destino pendiente", { exact: true })).toHaveCount(pendientesElegibles);
  await page.reload();
  await expect(page.getByText(totalVisible, { exact: true }).first()).toBeVisible();
  await captura(page, "05-lote-revision");

  await page.goto(operativo);
  await page.getByLabel("Día").selectOption(String(Number(hoy().slice(8, 10))));
  await page.getByLabel("Mes").selectOption(hoy().slice(5, 7));
  await page.getByLabel("Año").selectOption(hoy().slice(0, 4));
  await page.getByRole("button", { name: "Registrar la baja" }).click();
  await expect(page.getByText("La baja quedó registrada.", { exact: false })).toBeVisible();
  await expect(page.getByText("De baja", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Sin solicitud pendiente")).toBeVisible();
  await captura(page, "06-baja-desaprovisionada");

  const owner = process.env.E2E_OWNER_DATABASE_URL;
  if (!owner) throw new Error("Falta la base dueña desechable para la prueba de volumen.");
  const cliente = new Client({ connectionString: owner });
  await cliente.connect();
  const area = await cliente.query<{ id: string }>("select id from cost_centers where nombre = $1", ["Tesorería E2E"]);
  await cliente.query(`
    with semilla as (
      select g, gen_random_uuid() as id from generate_series(1, 200) as g
    ), insertadas as (
      insert into employees (
        id, company_id, user_id, jefe_id, cost_center_id, nombre, alta_en, baja_en,
        clabe, clabe_digito_valido, presupuesto_mensual_centavos, alta_llave
      )
      select id, $1, null, null, $2, 'Carga ' || g, current_date, null, null, false, null, null
      from semilla
      returning id
    )
    insert into audit_log (
      id, operator_id, company_id, actor_tipo, actor_id, superficie,
      accion, entidad, identificador
    )
    select gen_random_uuid(), (select operator_id from companies where id = $1),
      $1, 'miembro', $3, 'cliente', 'alta_persona', 'employees', id
    from insertadas
  `, [empresa(), area.rows[0]?.id, process.env.E2E_ADMIN_ID]);
  await cliente.end();

  await abrir(page, "/consola/personas");
  const inicio = Date.now();
  await abrir(page, "/consola/personas?q=Carga%20199");
  await expect(page.getByRole("link", { name: "Carga 199", exact: true })).toBeVisible();
  expect(Date.now() - inicio).toBeLessThan(15_000);
  await expect(page.locator("tbody tr")).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await abrir(page, "/consola/personas");
  await page.locator("#q").fill("Operativo");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  // El tema se elige en Apariencia, desde el menú de la cuenta, y se regresa al directorio filtrado.
  const directorio = page.url();
  await page.locator(".cuenta .menu-desplegable-boton").click();
  await page.getByRole("menuitem", { name: "Apariencia", exact: true }).click();
  await page.locator(".temas").getByRole("button", { name: "Oscuro", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-tema", "oscuro");
  await page.goto(directorio);
  await expect(page.locator("html")).toHaveAttribute("data-tema", "oscuro");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await captura(page, "07-directorio-movil-oscuro");
});
