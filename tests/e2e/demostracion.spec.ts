import { expect, test, type APIResponse, type BrowserContext, type Request } from "@playwright/test";

import { MODULOS_DEMO, PRODUCTOS } from "../../src/dominio/demo/productos";
import { CIFRAS_DE_EJEMPLO, NOMBRES_DE_EJEMPLO } from "../../src/server/demo/centinelas";
import { altamar, sesionDe, vigilarConsola } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * Modo demostración (Ola 2b): los módulos sin proveedor pintan los datos de
 * ejemplo de Altamar Logística solo en una empresa de demostración. Una
 * empresa real ve «Disponible pronto» y no recibe ni una cifra ni un nombre de
 * ejemplo: se revisa el cuerpo de la respuesta (HTML y carga RSC), no solo lo
 * que se ve. Solo lee: no cambia datos.
 */

/** Taller del Cierre (seed-pagos.sql) está marcada como demostración; Altamar E2E es real. */
const TALLER = "33333333-3333-4333-8333-333333333333";
const GIL = "gil-pagos@ejemplo.mx";

/**
 * Los centinelas, sin «Altamar» suelto: la empresa real de esta suite se llama
 * Altamar E2E y su nombre sale en la tarjeta del lateral. El de la
 * demostración, «Altamar Logística», sí se busca.
 */
const CENTINELAS = [...NOMBRES_DE_EJEMPLO.filter((nombre) => nombre !== "Altamar"), "Altamar Logística", ...CIFRAS_DE_EJEMPLO];

/** El HTML y la carga RSC de una página con la sesión del contexto. */
async function htmlYRsc(context: BrowserContext, ruta: string): Promise<{ html: APIResponse; rsc: APIResponse }> {
  const html = await context.request.get(ruta, { maxRedirects: 0 });
  // Next valida el parámetro _rsc contra los encabezados del enrutador y redirige (307) al bueno:
  // se sigue a mano para conservar el encabezado RSC.
  let rsc = await context.request.get(ruta, { headers: { RSC: "1" }, maxRedirects: 0 });
  const destino = rsc.headers().location;
  if (rsc.status() === 307 && destino?.includes("_rsc")) rsc = await context.request.get(destino, { headers: { RSC: "1" }, maxRedirects: 0 });
  return { html, rsc };
}

test("empresa real: cada módulo de demostración dice «Disponible pronto» y ni el HTML ni la carga RSC traen datos de ejemplo", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, CORREOS.laura);
  for (const modulo of MODULOS_DEMO) {
    const ruta = `/c/${altamar()}/consola/${modulo}`;
    const { html, rsc } = await htmlYRsc(context, ruta);
    expect(html.status(), ruta).toBe(200);
    expect(rsc.status(), `${ruta} (RSC)`).toBe(200);
    expect(rsc.headers()["content-type"], `${ruta} (RSC)`).toContain("text/x-component");
    const cuerpos = { html: await html.text(), rsc: await rsc.text() };
    for (const [tipo, cuerpo] of Object.entries(cuerpos)) {
      expect(cuerpo, `${ruta} (${tipo})`).toContain("Disponible pronto");
      expect(cuerpo, `${ruta} (${tipo})`).toContain(PRODUCTOS[modulo].producto);
      expect(cuerpo.includes("Datos de ejemplo"), `${ruta} (${tipo}) lleva el aviso de demostración`).toBe(false);
      expect(CENTINELAS.filter((centinela) => cuerpo.includes(centinela)), `${ruta} (${tipo})`).toEqual([]);
    }
  }
  // Lo mismo se ve en pantalla, con un clic desde el lateral.
  await page.goto(`/c/${altamar()}/consola/aprobaciones`);
  await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Tarjetas", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${altamar()}/consola/tarjetas$`));
  await expect(page.getByRole("heading", { level: 2, name: PRODUCTOS.tarjetas.titulo })).toBeVisible();
  await expect(page.getByText("Disponible pronto")).toBeVisible();
  expect(errores).toEqual([]);
});

test("empresa de demostración: cada módulo pinta el aviso y los datos de ejemplo, con los botones de dinero apagados", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, GIL);
  for (const modulo of MODULOS_DEMO) {
    const ruta = `/c/${TALLER}/consola/${modulo}`;
    const respuesta = await context.request.get(ruta, { maxRedirects: 0 });
    expect(respuesta.status(), ruta).toBe(200);
    const html = await respuesta.text();
    expect(html, ruta).toContain("Datos de ejemplo de Altamar Logística");
    expect(html.includes("Disponible pronto"), `${ruta} dice «Disponible pronto» en una empresa de demostración`).toBe(false);
  }
  await page.goto(`/c/${TALLER}/consola/cuenta`);
  await expect(page.locator("#contenido")).toContainText("$1,284,560.40");
  // Ningún botón que movería dinero o crearía algo está encendido.
  const encendidos = await page.locator("#contenido button:not([disabled])").evaluateAll((botones) =>
    botones.map((boton) => boton.textContent?.trim() ?? ""));
  expect(encendidos).toEqual([]);
  expect(errores).toEqual([]);
});

test("Movimientos: Enter y Tab en «Monto desde» filtran con una sola navegación cada uno", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, GIL);
  for (const [tecla, monto] of [["Enter", "2000"], ["Tab", "3000"]] as const) {
    await page.goto(`/c/${TALLER}/consola/movimientos`);
    await expect(page.getByRole("link", { name: "Limpiar filtros" })).toHaveCount(0);
    const navegaciones: string[] = [];
    // Los enlaces de periodo llevan el mismo monto y Next los precarga: esas no son navegaciones.
    const contar = (peticion: Request) => {
      if (peticion.headers()["next-router-prefetch"]) return;
      if (new URL(peticion.url()).searchParams.get("desde") === monto) navegaciones.push(`${peticion.method()} ${peticion.url()}`);
    };
    page.on("request", contar);
    // Teclas reales: el «change» del monto sale al oprimir Enter o al salir con Tab, no con fill.
    await page.locator("#movimientos-desde").click();
    await page.keyboard.type(monto);
    await page.keyboard.press(tecla);
    await expect(page).toHaveURL(new RegExp(`[?&]desde=${monto}(&|$)`));
    await expect(page.getByRole("link", { name: "Limpiar filtros" })).toBeVisible();
    // Un envío repetido saldría en el mismo turno; un segundo da tiempo de sobra a que aparezca.
    await page.waitForTimeout(1000);
    page.off("request", contar);
    expect(navegaciones, `${tecla} en «Monto desde»`).toHaveLength(1);
  }
  expect(errores).toEqual([]);
});
