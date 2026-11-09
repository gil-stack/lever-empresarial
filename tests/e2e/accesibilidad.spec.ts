import { expect, test } from "@playwright/test";

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
// logotipo («lever» y su línea, pegados). El enlace se nombra con su contenido: el logotipo (role="img", «Lever Empresas») y
// un texto solo para el lector de pantalla.
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
