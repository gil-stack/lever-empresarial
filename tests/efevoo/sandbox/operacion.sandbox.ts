import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { clienteHttpEfevoo } from "../../../src/server/efevoo/cliente";
import { leerConfigEfevoo } from "../../../src/server/efevoo/config";
import { CLAVE, codigoTotp, consultar } from "../../e2e/apoyo";
import { CORREOS } from "../../e2e/siembra";
import { EMPLEADOS_CEIBA } from "../../e2e/siembra-efevoo";

/**
 * Validación con clics contra el sandbox REAL de Efevoo (E1, criterio 3). Ceiba E2E se da de alta de verdad en el
 * sandbox (correo @lever.test); el depósito, la asignación y la cancelación se intentan con clics y se documenta lo
 * que responde Efevoo (al 2026-11-12, clientBalance y assignCard fallan del lado de Efevoo; ver investigacion.md).
 * Cada paso deja su captura y lo que dijo Efevoo, sin la llave ni datos personales, en docs/evidencia/efevoo/sandbox/.
 */
test.describe.configure({ mode: "serial" });

const EVIDENCIA = "docs/evidencia/efevoo/sandbox";
const ceiba = () => process.env.E2E_CEIBA_ID!;
const registro: Record<string, unknown> = { fecha: new Date().toISOString() };

async function captura(page: Page, nombre: string): Promise<void> {
  mkdirSync(EVIDENCIA, { recursive: true });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.screenshot({ path: `${EVIDENCIA}/${nombre}.png`, fullPage: true });
}
async function operaciones() {
  return consultar<{ tipo: string; estado: string; referencia: string; codigo_efevoo: string | null; id_efevoo: string | null; creada_en: Date }>(
    "select tipo, estado, referencia, codigo_efevoo, id_efevoo, creada_en from efevoo_operaciones where company_id = $1 order by creada_en", [ceiba()]);
}
const aviso = (page: Page) => new URL(page.url()).searchParams.get("aviso");

test.describe("Efevoo sandbox real: Operación con clics", () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto("/operacion/entrar");
    await page.getByLabel("Correo").fill(CORREOS.op1);
    await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.waitForURL(/\/operacion\/continuar/);
    await page.getByLabel("Código de la app autenticadora").fill(await codigoTotp(CORREOS.op1));
    await page.getByRole("button", { name: "Entrar con el código" }).click();
    await page.waitForURL(/\/operacion$/);
  });
  test.afterAll(async () => {
    registro.operaciones = await operaciones();
    mkdirSync(EVIDENCIA, { recursive: true });
    writeFileSync(`${EVIDENCIA}/resultado.json`, `${JSON.stringify(registro, null, 2)}\n`);
    await page.close();
  });

  test("O1: alta de Ceiba E2E en el sandbox", async () => {
    await page.goto(`/operacion/clientes/${ceiba()}`);
    await expect(page.getByText("Pruebas (sandbox)")).toBeVisible();
    await captura(page, "o1-antes");
    const antes = Date.now();
    await page.getByRole("button", { name: "Dar de alta en Efevoo" }).click();
    await page.waitForURL(/aviso=/, { timeout: 40_000 });
    registro.o1 = { aviso: aviso(page), ms: Date.now() - antes };
    expect(aviso(page)).toBe("efevoo_alta_confirmada");
    const [vinculo] = await consultar<{ idep_cliente: number }>("select idep_cliente from efevoo_clientes where company_id = $1", [ceiba()]);
    // Lo que tiene Efevoo de la empresa (datos de prueba de Ceiba, sin llave).
    const config = leerConfigEfevoo().config!;
    const enEfevoo = await clienteHttpEfevoo(config).leerCliente(vinculo!.idep_cliente);
    registro.o1EnEfevoo = { idepCliente: enEfevoo.idepCliente, estatus: enEfevoo.estatus, saldoCentavos: enEfevoo.saldoCentavos, correoDePrueba: /@lever\.test$/.test(enEfevoo.correo ?? "") };
    await expect(page.getByText("Cliente en Efevoo")).toBeVisible();
    await captura(page, "o1-alta-confirmada");
  });

  test("O2: depósito de prueba (clientBalance)", async () => {
    await page.goto(`/operacion/clientes/${ceiba()}`);
    await page.getByLabel("Monto del depósito de prueba (pesos)").fill("100.00");
    await page.getByRole("button", { name: "Depositar dinero de prueba" }).click();
    await page.waitForURL(/aviso=/, { timeout: 40_000 });
    registro.o2 = { aviso: aviso(page) };
    await captura(page, "o2-deposito");
    expect(["efevoo_deposito_confirmado", "efevoo_incierta", "efevoo_fallida"]).toContain(aviso(page));
    if (aviso(page) === "efevoo_incierta") {
      // Sin referencia ni respuesta legible: la conciliación espera los 10 minutos (y no reintenta).
      await page.goto(`/operacion/clientes/${ceiba()}`);
      await page.locator("li[data-operacion='deposito_prueba'][data-estado='incierta']").getByRole("button", { name: "Conciliar con Efevoo" }).click();
      await page.waitForURL(/aviso=/);
      registro.o2Conciliacion = aviso(page);
      await captura(page, "o2-conciliacion");
    }
  });

  test("O3: asignar un plástico del inventario real", async () => {
    await page.goto(`/operacion/clientes/${ceiba()}`);
    const inventario = await page.getByLabel("Plástico del inventario").locator("option").allTextContents();
    registro.o3Inventario = inventario.filter((t) => t.startsWith("Terminación"));
    expect((registro.o3Inventario as string[]).length).toBeGreaterThan(0);
    const terminacion = (registro.o3Inventario as string[])[0]!.replace("Terminación ", "");
    await page.getByLabel("Empleado").selectOption({ label: EMPLEADOS_CEIBA[0] });
    await page.getByLabel("Plástico del inventario").selectOption({ label: `Terminación ${terminacion}` });
    // Los últimos 8 se leen del plástico físico, que Lever no tiene en el sandbox: se mandan los 4 conocidos con relleno.
    await page.getByLabel("Últimos 8 dígitos del plástico").fill(`0000${terminacion}`);
    await page.getByLabel("Nombre(s)").fill("PRUEBA");
    await page.getByLabel("Primer apellido").fill("LEVER");
    await page.getByLabel("Segundo apellido").fill("");
    await page.getByLabel("Nombre a embozar en la tarjeta").fill("PRUEBA LEVER");
    await page.getByLabel("Teléfono").fill("5500000001");
    await page.getByLabel("Correo del titular").fill("titular-sandbox-e1@lever.test");
    await page.getByLabel("País de nacimiento").fill("México");
    await page.getByLabel("Domicilio").fill("Calle Prueba 1, CDMX");
    await page.getByRole("button", { name: "Asignar y activar la tarjeta" }).click();
    await page.waitForURL(/aviso=/, { timeout: 40_000 });
    registro.o3 = { aviso: aviso(page), terminacion };
    await captura(page, "o3-asignacion");
    expect(["efevoo_tarjeta_activada", "efevoo_tarjeta_asignada_sin_activar", "efevoo_fallida", "efevoo_incierta"]).toContain(aviso(page));
  });
});
