import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";

import { altamar, sesionDe } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * Lo que axe marcaba en el marco del portal y de Operación: el nombre del enlace del logotipo y los landmarks del
 * teléfono. Solo lee: no cambia datos.
 */

/** Taller del Cierre (seed-pagos.sql), de demostración: el logotipo lleva a Resumen. */
const TALLER = "33333333-3333-4333-8333-333333333333";
const GIL = "gil-pagos@ejemplo.mx";

// WCAG 2.5.3 (axe: label-content-name-mismatch): con `aria-label` en el enlace, su nombre no contenía el texto visible del
// logotipo («lever» y su línea, pegados). El enlace se nombra con su contenido: el logotipo va `decorativo` (aria-hidden) y
// un solo texto para el lector de pantalla lo nombra, empezando por lo que se ve («Lever Empresas, ir a Resumen»).
test.describe("el enlace del logotipo se nombra con lo que muestra", () => {
  for (const [donde, ventana] of [
    ["escritorio", { width: 1440, height: 900 }],
    ["teléfono", { width: 390, height: 844 }],
  ] as const) {
    test(`portal en ${donde}: «ir a Resumen» o «ir a Aprobaciones», según quién entra, y lleva ahí`, async ({ page, context }) => {
      await page.setViewportSize(ventana);
      await sesionDe(context, GIL);
      await page.goto(`/c/${TALLER}/consola/movimientos`);
      const marca = page.locator("a.marca").filter({ visible: true });
      await expect(marca, "sin aria-label").not.toHaveAttribute("aria-label");
      await expect(marca).toHaveAccessibleName("Lever Empresas, ir a Resumen");
      await marca.click();
      await expect(page).toHaveURL(new RegExp(`/c/${TALLER}/consola$`));
      // Una liberadora no ve Resumen: el logotipo la lleva a Aprobaciones.
      await sesionDe(context, CORREOS.rosa);
      await page.goto(`/c/${altamar()}/consola/fiscal`);
      await expect(marca, "sin aria-label").not.toHaveAttribute("aria-label");
      await expect(marca).toHaveAccessibleName("Lever Empresas, ir a Aprobaciones");
      await marca.click();
      await expect(page).toHaveURL(new RegExp(`/c/${altamar()}/consola/aprobaciones$`));
    });
  }

  test("portada y Recuperar: «Lever Empresas, inicio»", async ({ page }) => {
    for (const [ruta, clase] of [
      ["/", "arco-header-marca"],
      ["/recuperar", "arco-marca"],
    ] as const) {
      await page.goto(ruta);
      const marca = page.locator(`a.${clase}`);
      await expect(marca, `${ruta}: sin aria-label`).not.toHaveAttribute("aria-label");
      await expect(marca, ruta).toHaveAccessibleName("Lever Empresas, inicio");
    }
  });
});

// axe (`region`): en el teléfono, la barra de arriba (logotipo, «Cargando…» y «Secciones») y el aviso regulatorio del final
// quedaban fuera de todo landmark. La barra es la navegación «Menú» (el portal ya tiene su banner arriba del contenido) y el
// aviso, el pie de la página. El componente de la barra es compartido: también en Operación.
test.describe("en el teléfono, la barra de arriba y el pie van en su landmark", () => {
  test("portal: la barra es la navegación «Menú» y el aviso regulatorio, el pie; en escritorio no se ven", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await sesionDe(context, GIL);
    await page.goto(`/c/${TALLER}/consola/movimientos`);
    const menu = page.getByRole("navigation", { name: "Menú", exact: true });
    await expect(menu.getByRole("link", { name: "Lever Empresas, ir a Resumen" })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Secciones" })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toContainText("El saldo vive con el participante de la CLABE.");
    // En escritorio la barra y el pie del teléfono no se muestran: el aviso va en el lateral.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole("contentinfo")).toHaveCount(0);
  });

  test("Operación: la misma barra es la navegación «Menú»", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
    await page.goto("/operacion/clientes");
    await expect(page.getByRole("navigation", { name: "Menú", exact: true }).getByRole("button", { name: "Secciones" })).toBeVisible();
  });
});

// N17 (axe: scrollable-region-focusable): una tabla que no cabe se desplaza dentro de su contenedor, y sin nada enfocable ahí
// el teclado no llegaba a ella (en Safari, ni con Tab ni con Alt+Tab). Cada contenedor es una región con nombre y parada de
// Tab. El nombre es «Tabla de …»: la sección que la contiene ya lleva el título, y dos regiones con el mismo nombre chocan.
const TABLAS_DEMO = [
  ["conciliacion", "Tabla de lo conciliado recientemente"],
  ["tarjetas", "Tabla de todas las tarjetas"],
  ["movimientos", "Tabla de compras de octubre"],
  ["fiscal", "Tabla de la DIOT de octubre"],
  ["cuenta", "Tabla de movimientos de la cuenta"],
  ["internacional", "Tabla de pagos enviados"],
  ["credito", "Tabla de pagos programados"],
  ["gasolina", "Tabla de cargas de gasolina"],
] as const;

test.describe("las tablas que se desplazan se alcanzan con el teclado", () => {
  test("cada tabla de las vistas de demostración es una región con nombre y parada de Tab", async ({ page, context }) => {
    await sesionDe(context, GIL);
    for (const [modulo, nombre] of TABLAS_DEMO) {
      await page.goto(`/c/${TALLER}/consola/${modulo}`);
      const tabla = page.getByRole("region", { name: nombre, exact: true });
      await expect(tabla, modulo).toHaveAttribute("tabindex", "0");
      await expect(tabla.locator("table"), modulo).toHaveCount(1);
    }
  });

  test("Fiscal a 1440: Tab llega a la DIOT, que no cabe, y las flechas la desplazan", async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await sesionDe(context, GIL);
    await page.goto(`/c/${TALLER}/consola/fiscal`);
    const diot = page.getByRole("region", { name: "Tabla de la DIOT de octubre", exact: true });
    await expect(diot).toBeVisible();
    expect(await diot.evaluate((nodo) => nodo.scrollWidth > nodo.clientWidth), "la DIOT no cabe a 1440").toBe(true);
    // El clic en el texto de antes de la tabla deja ahí el punto de partida del Tab, como lo haría una persona.
    await page.locator('section[aria-labelledby="fiscal-diot"] .demo-antes-de-tabla').click();
    await page.keyboard.press("Tab");
    await expect(diot).toBeFocused();
    for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowRight");
    await expect.poll(() => diot.evaluate((nodo) => nodo.scrollLeft), "ArrowRight desplaza la tabla").toBeGreaterThan(0);
  });
});

/** Las violaciones de axe en la página, solo de las reglas pedidas: «regla: selector | selector». */
async function violaciones(page: Page, reglas: string[]): Promise<string[]> {
  await page.evaluate(axe.source);
  return page.evaluate(async (soloEstas) => {
    const resultado = await (window as unknown as { axe: typeof axe }).axe.run(document, { runOnly: soloEstas });
    return resultado.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  }, reglas);
}

// axe (`landmark-unique`): en Proveedores conviven el buscador de la barra de arriba y el de la mesa, los dos
// `role="search"` y sin nombre: un lector de pantalla los anunciaba como dos «búsqueda» iguales. Cada uno se nombra
// con lo que busca; el de la mesa cambia con la vista (facturas o directorio).
test.describe("cada buscador de Proveedores tiene su propio nombre", () => {
  for (const ventana of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`Proveedores a ${ventana.width}: el de la barra y el de la mesa se distinguen y axe no marca landmark-unique`, async ({ page, context }) => {
      await page.setViewportSize(ventana);
      await sesionDe(context, GIL);
      for (const [vista, mesa] of [
        ["pagos", "Filtrar facturas y obligaciones"],
        ["proveedores", "Filtrar el directorio de proveedores"],
      ] as const) {
        await page.goto(`/c/${TALLER}/consola/proveedores?vista=${vista}`);
        await expect(page.locator("form.buscador-pagos"), vista).toBeVisible();
        expect(await violaciones(page, ["landmark-unique"]), vista).toEqual([]);
        await expect(page.getByRole("search", { name: mesa, exact: true }), vista).toHaveCount(1);
        // Gil administra Taller: la barra busca personas.
        await expect(page.getByRole("search", { name: "Buscar persona", exact: true }), vista).toHaveCount(1);
      }
    });
  }
});

// Sin JavaScript (o con él apagado), el menú de la persona no abre y «Salir» vivía solo ahí: no había forma de cerrar
// la sesión. Junto al menú queda «Salir» a la vista (en <noscript>), con la misma acción del servidor.
test.describe("sin JavaScript se puede salir", () => {
  test.use({ javaScriptEnabled: false });

  for (const ventana of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`a ${ventana.width}: «Salir» está a la vista, cierra la sesión y la consola ya no abre`, async ({ page, context }) => {
      await page.setViewportSize(ventana);
      await sesionDe(context, GIL);
      await page.goto(`/c/${TALLER}/consola/personas`);
      const salir = page.getByRole("button", { name: "Salir", exact: true });
      await expect(salir).toBeVisible();
      await salir.click();
      await expect(page).toHaveURL(/\/$/);
      expect((await context.cookies()).find((cookie) => cookie.name === "__Host-sesion")?.value ?? "").toBe("");
      await page.goto(`/c/${TALLER}/consola/personas`);
      await expect(page).toHaveURL(/\/entrar/);
    });
  }
});
