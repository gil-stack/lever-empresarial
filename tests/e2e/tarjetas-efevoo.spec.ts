import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { CLAVE, codigoTotp, consultar, contar, dobleClic, sesionDe } from "./apoyo";
import { CORREOS } from "./siembra";
import { EMPLEADOS_CEIBA } from "./siembra-efevoo";

/**
 * Tarjetas (Efevoo) en la ficha del cliente de Operación, contra el Efevoo
 * falso (tests/efevoo/servidor-falso.ts; la e2e nunca llama al sandbox):
 * O1 alta, O2 depósito de prueba, O3 asignar y activar, O4 cancelar, con doble
 * clic real y conteo en la base, más los casos de error 401 (fallida), 901
 * (incierta) y timeout (incierta, conciliada después). Un grupo serial: cada
 * paso usa lo que dejó el anterior en Ceiba E2E (siembra-efevoo.ts).
 */
test.describe.configure({ mode: "serial" });

const EVIDENCIA = process.env.E2E_CAPTURAS ?? "test-results/efevoo";
const ceiba = () => {
  const id = process.env.E2E_CEIBA_ID;
  if (!id) throw new Error("Falta E2E_CEIBA_ID (siembra-efevoo.ts).");
  return id;
};
const efevoo = () => {
  const url = process.env.E2E_EFEVOO_URL;
  if (!url) throw new Error("Falta E2E_EFEVOO_URL (entorno.ts levanta el Efevoo falso).");
  return url;
};
type EstadoFalso = {
  clientes: { id: number; saldoCentavos: number }[];
  tarjetas: { id: number; estado: string; email: string; transacciones: unknown[] }[];
};
async function estadoFalso(): Promise<EstadoFalso> {
  return (await (await fetch(`${efevoo()}/estado`)).json()) as EstadoFalso;
}
async function simular(falla: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${efevoo()}/simular`, { method: "POST", body: JSON.stringify(falla) });
  expect(r.status).toBe(200);
}
async function captura(page: Page, nombre: string): Promise<void> {
  if (process.env.E2E_SIN_CAPTURAS) return;
  mkdirSync(EVIDENCIA, { recursive: true });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.screenshot({ path: `${EVIDENCIA}/${nombre}.png`, fullPage: true });
}
async function entrarAOperacion(page: Page, correo: string): Promise<void> {
  await page.goto("/operacion/entrar");
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/operacion\/continuar/);
  await page.getByLabel("Código de la app autenticadora").fill(await codigoTotp(correo));
  await page.getByRole("button", { name: "Entrar con el código" }).click();
  await page.waitForURL(/\/operacion$/);
}
const ops = (tipo: string, estado?: string) =>
  contar(`select 1 from efevoo_operaciones where company_id = $1 and tipo = $2${estado ? " and estado = $3" : ""}`,
    estado ? [ceiba(), tipo, estado] : [ceiba(), tipo]);

/** Llena el formulario de asignación (los datos del titular no vuelven tras un rechazo: se escriben cada vez). */
async function llenarAsignacion(page: Page, datos: { empleado: string; terminacion: string; ultimos8: string; correo?: string }): Promise<void> {
  await page.getByLabel("Empleado").selectOption({ label: datos.empleado });
  await page.getByLabel("Plástico del inventario").selectOption({ label: `Terminación ${datos.terminacion}` });
  await page.getByLabel("Últimos 8 dígitos del plástico").fill(datos.ultimos8);
  await page.getByLabel("Nombre(s)").fill("PAULA");
  await page.getByLabel("Primer apellido").fill("CEIBA");
  await page.getByLabel("Segundo apellido").fill("ROBLES");
  await page.getByLabel("Nombre a embozar en la tarjeta").fill("PAULA CEIBA");
  await page.getByLabel("Teléfono").fill("5500000001");
  await page.getByLabel("Correo del titular").fill(datos.correo ?? `titular-${datos.terminacion}@lever.test`);
  await page.getByLabel("País de nacimiento").fill("México");
  await page.getByLabel("Domicilio").fill("Calle Prueba 1, CDMX");
}

test.describe("Tarjetas (Efevoo) en Operación", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await entrarAOperacion(page, CORREOS.op1);
  });
  test.afterAll(async () => {
    await page.close();
  });

  test("O1: alta de la empresa en Efevoo con doble clic deja un solo cliente", async () => {
    await page.goto(`/operacion/clientes/${ceiba()}`);
    await expect(page.getByRole("heading", { name: "Tarjetas (Efevoo)" })).toBeVisible();
    await expect(page.getByText("Pruebas (sandbox)")).toBeVisible();
    await captura(page, "o1-antes-del-alta");
    const { envios } = await dobleClic(page.getByRole("button", { name: "Dar de alta en Efevoo" }), { esperar: /aviso=efevoo_alta_confirmada/ });
    expect(envios).toBeGreaterThanOrEqual(1);
    await expect(page.getByText("Empresa dada de alta en Efevoo.")).toBeVisible();
    expect(await ops("alta_cliente")).toBe(1);
    expect((await estadoFalso()).clientes).toHaveLength(1);
    await expect(page.getByRole("button", { name: "Dar de alta en Efevoo" })).toHaveCount(0);
    await captura(page, "o1-alta-confirmada");
  });

  test("O2: depósito de prueba, con su error junto al campo y doble clic", async () => {
    await page.getByLabel("Monto del depósito de prueba (pesos)").fill("abc");
    await page.getByRole("button", { name: "Depositar dinero de prueba" }).click();
    await expect(page.locator("#aviso-efevoo-deposito-campo")).toHaveText("Escribe un monto en pesos, de $0.01 a $100,000.00.");
    await expect(page.getByLabel("Monto del depósito de prueba (pesos)")).toHaveAttribute("aria-invalid", "true");
    expect(await ops("deposito_prueba")).toBe(0);
    await page.getByLabel("Monto del depósito de prueba (pesos)").fill("1000.00");
    await dobleClic(page.getByRole("button", { name: "Depositar dinero de prueba" }), { esperar: /aviso=efevoo_deposito_confirmado/ });
    expect(await ops("deposito_prueba", "confirmada")).toBe(1);
    expect((await estadoFalso()).clientes[0]!.saldoCentavos).toBe(100_000);
    await expect(page.getByText("$1,000.00").first()).toBeVisible();
    await captura(page, "o2-deposito-confirmado");
  });

  test("O3: asignar y activar una tarjeta; los datos del titular no se guardan en Lever", async () => {
    // Un correo real en sandbox se rechaza antes de llamar a Efevoo.
    await llenarAsignacion(page, { empleado: EMPLEADOS_CEIBA[0], terminacion: "1363", ultimos8: "40001363", correo: "paula@gmail.com" });
    await page.getByRole("button", { name: "Asignar y activar la tarjeta" }).click();
    await expect(page.locator("#aviso-efevoo-asignar-campo")).toContainText("En el ambiente de pruebas el correo del titular es de prueba");
    await expect(page.getByLabel("Correo del titular")).toHaveAttribute("aria-invalid", "true");
    // Los últimos 8 tienen que terminar en la terminación del plástico elegido.
    await llenarAsignacion(page, { empleado: EMPLEADOS_CEIBA[0], terminacion: "1363", ultimos8: "40009999" });
    await page.getByRole("button", { name: "Asignar y activar la tarjeta" }).click();
    await expect(page.locator("#aviso-efevoo-asignar-campo")).toContainText("Escribe los últimos 8 dígitos del plástico");
    expect(await ops("asignacion")).toBe(0);
    await captura(page, "o3-error-ultimos8");

    await llenarAsignacion(page, { empleado: EMPLEADOS_CEIBA[0], terminacion: "1363", ultimos8: "40001363" });
    await dobleClic(page.getByRole("button", { name: "Asignar y activar la tarjeta" }), { esperar: /aviso=efevoo_tarjeta_activada/ });
    const tarjeta = page.locator("li[data-tarjeta='1363']");
    await expect(tarjeta).toContainText("PAULA CEIBA");
    await expect(tarjeta).toContainText("Activa");
    expect(await ops("asignacion", "confirmada")).toBe(1);
    expect(await ops("activacion", "confirmada")).toBe(1);
    const enFalso = (await estadoFalso()).tarjetas.find((t) => t.id === 557)!;
    expect([enFalso.estado, enFalso.email]).toEqual(["active", "titular-1363@lever.test"]);
    // Ni el correo, ni el teléfono, ni los apellidos, ni los últimos 8 quedan en Lever.
    const guardado = JSON.stringify(await consultar("select * from efevoo_tarjetas t full join efevoo_operaciones o on o.tarjeta_id = t.id where coalesce(t.company_id, o.company_id) = $1", [ceiba()]));
    const bitacora = JSON.stringify(await consultar("select cambio, motivo from audit_log where entidad = 'efevoo_operaciones' and company_id = $1", [ceiba()]));
    for (const dato of ["titular-1363@lever.test", "5500000001", "ROBLES", "40001363", "Calle Prueba"]) {
      expect(guardado).not.toContain(dato);
      expect(bitacora).not.toContain(dato);
    }
    await captura(page, "o3-tarjeta-activa");
  });

  test("O3 con 401 de Efevoo: la asignación queda fallida y se puede volver a pedir", async () => {
    await simular({ metodo: "assignCard", falla: "401" });
    await llenarAsignacion(page, { empleado: EMPLEADOS_CEIBA[1], terminacion: "0168", ultimos8: "40000168" });
    await page.getByRole("button", { name: "Asignar y activar la tarjeta" }).click();
    await page.waitForURL(/aviso=efevoo_fallida/);
    await expect(page.locator("li[data-operacion='asignacion'][data-estado='fallida']")).toContainText("Código 401");
    expect((await estadoFalso()).tarjetas.find((t) => t.id === 563)!.email).toBe("");
    await captura(page, "o3-asignacion-401");
    await llenarAsignacion(page, { empleado: EMPLEADOS_CEIBA[1], terminacion: "0168", ultimos8: "40000168" });
    await page.getByRole("button", { name: "Asignar y activar la tarjeta" }).click();
    await page.waitForURL(/aviso=efevoo_tarjeta_activada/);
    await expect(page.locator("li[data-tarjeta='0168']")).toContainText("Activa");
  });

  test("O4: cancelar pide la terminación escrita y es irreversible", async () => {
    const tarjeta = page.locator("li[data-tarjeta='0168']");
    await tarjeta.getByText("Cancelar ****0168").click();
    await tarjeta.getByLabel("Motivo de la cancelación").fill("La persona dejó la empresa");
    await tarjeta.getByLabel("Escribe la terminación (0168) para confirmar").fill("1111");
    await tarjeta.getByRole("button", { name: "Cancelar la tarjeta ****0168" }).click();
    await expect(page.locator("#aviso-efevoo-cancelar-0168-campo")).toHaveText("Escribe la terminación de la tarjeta para confirmar la cancelación.");
    expect(await ops("cancelacion")).toBe(0);
    await captura(page, "o4-error-confirmacion");
    // El desplegable sigue abierto con el aviso y el motivo escrito.
    await expect(tarjeta.locator("details.efevoo-cancelar")).toHaveAttribute("open", "");
    await expect(tarjeta.getByLabel("Motivo de la cancelación")).toHaveValue("La persona dejó la empresa");
    await tarjeta.getByLabel("Escribe la terminación (0168) para confirmar").fill("0168");
    await dobleClic(tarjeta.getByRole("button", { name: "Cancelar la tarjeta ****0168" }), { esperar: /aviso=efevoo_tarjeta_cancelada/ });
    await expect(page.locator("li[data-tarjeta='0168']")).toContainText("Cancelada");
    expect(await ops("cancelacion", "confirmada")).toBe(1);
    expect((await estadoFalso()).tarjetas.find((t) => t.id === 563)!.estado).toBe("cancelled");
    await captura(page, "o4-cancelada");
  });

  test("timeout al cancelar: queda incierta, sin reintento, y la conciliación la confirma", async () => {
    test.setTimeout(90_000);
    await simular({ metodo: "cancelCard", falla: "timeout", idCard: 557 });
    const tarjeta = page.locator("li[data-tarjeta='1363']");
    await tarjeta.getByText("Cancelar ****1363").click();
    await tarjeta.getByLabel("Motivo de la cancelación").fill("Robo de la tarjeta reportado");
    await tarjeta.getByLabel("Escribe la terminación (1363) para confirmar").fill("1363");
    await tarjeta.getByRole("button", { name: "Cancelar la tarjeta ****1363" }).click();
    await page.waitForURL(/aviso=efevoo_incierta/, { timeout: 40_000 });
    const incierta = page.locator("li[data-operacion='cancelacion'][data-estado='incierta']");
    await expect(incierta).toContainText("Código timeout");
    await captura(page, "timeout-incierta");
    await incierta.getByRole("button", { name: "Conciliar con Efevoo" }).click();
    await page.waitForURL(/aviso=efevoo_conciliada/);
    await expect(page.locator("li[data-tarjeta='1363']")).toContainText("Cancelada");
    expect(await ops("cancelacion", "confirmada")).toBe(2);
    await captura(page, "timeout-conciliada");
  });

  test("901 en el depósito: queda incierto y la conciliación espera los 10 minutos", async () => {
    await simular({ metodo: "clientBalance", falla: "901" });
    await page.getByLabel("Monto del depósito de prueba (pesos)").fill("50.00");
    await page.getByRole("button", { name: "Depositar dinero de prueba" }).click();
    await page.waitForURL(/aviso=efevoo_incierta/);
    const incierto = page.locator("li[data-operacion='deposito_prueba'][data-estado='incierta']");
    await expect(incierto).toContainText("Código 901");
    await incierto.getByRole("button", { name: "Conciliar con Efevoo" }).click();
    await page.waitForURL(/aviso=efevoo_espera/);
    await expect(page.getByText("Todavía no aparece en Efevoo.")).toBeVisible();
    expect(await ops("deposito_prueba", "incierta")).toBe(1);
    await captura(page, "901-incierto-espera");
  });
});

test("una persona de la empresa no llega a la sección de Efevoo en Operación", async ({ browser }) => {
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  await sesionDe(contexto, CORREOS.laura);
  await pagina.goto(`/operacion/clientes/${ceiba()}`);
  await expect(pagina).toHaveURL(/\/operacion\/entrar/);
  await expect(pagina.getByRole("heading", { name: "Tarjetas (Efevoo)" })).toHaveCount(0);
  await contexto.close();
});
