import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";

import { altamar, ORIGEN, sesionDe } from "./apoyo";
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

  // Las dos tablas del historial de Aprobaciones: la de pagos se prueba con el rechazado de seed-pagos.sql (Taller). La de
  // lotes de nómina solo existe después de que nomina.spec prepara uno en Altamar, en otra parte de la e2e y sin orden
  // fijo; sembrar uno aquí le quitaría a esa prueba el lote vencido. La cubre tests/tablas-desplazables.test.ts.
  test("Aprobaciones · historial a 390: la tabla de decisiones de pagos es una región con nombre y foco, y axe no marca scrollable-region-focusable", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await sesionDe(context, GIL);
    await page.goto(`/c/${TALLER}/consola/aprobaciones?vista=historial`);
    const tabla = page.getByRole("region", { name: "Tabla de decisiones de pagos a proveedores", exact: true });
    await expect(tabla).toHaveAttribute("tabindex", "0");
    await expect(tabla.locator("tbody tr")).not.toHaveCount(0);
    await tabla.focus();
    await expect(tabla).toBeFocused();
    expect(await violaciones(page, ["scrollable-region-focusable"])).toEqual([]);
  });

  // Las de Operación (Clientes, Comisiones y Bitácora) también: en el teléfono la cartera y la bitácora no caben.
  test("Operación a 390: las tablas de Clientes, Comisiones y Bitácora son regiones con nombre y foco, y axe no marca scrollable-region-focusable", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
    const revisadas: string[] = [];
    for (const [ruta, nombre] of [
      ["/operacion/clientes", "Tabla de la cartera de clientes"],
      ["/operacion/comisiones", "Tabla de versiones de comisiones"],
      ["/operacion/bitacora", "Tabla de eventos de la bitácora"],
    ] as const) {
      await page.goto(ruta);
      const tabla = page.getByRole("region", { name: nombre, exact: true });
      if (!(await tabla.count())) continue; // Sin filas la página muestra «Sin …» en lugar de la tabla.
      await expect(tabla, ruta).toHaveAttribute("tabindex", "0");
      expect(await violaciones(page, ["scrollable-region-focusable"]), ruta).toEqual([]);
      revisadas.push(ruta);
    }
    // La cartera siempre tiene empresas de la siembra: al menos esa se revisó.
    expect(revisadas).toContain("/operacion/clientes");
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
// N19: en el teléfono las barras pegadas arriba (la móvil y la del título) tapaban lo que llega por un ancla: «Directorio»
// quedaba en y=0, debajo de 172 px de barras. El documento lleva scroll-padding-top con lo que tapan (BarraSuperior lo
// mide; sin JavaScript, el alto de cada caso en marco.css).
async function llegadaPorAncla(page: Page, ruta: string, ancla: string): Promise<{ arriba: number; barras: number; desplazado: number }> {
  await page.goto(`${ruta}#${ancla}`);
  await page.waitForTimeout(300);
  return page.evaluate((id) => {
    const barras = Math.max(0, ...[...document.querySelectorAll(".barra-movil, .barra-superior")].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect().bottom));
    return { arriba: document.getElementById(id)!.getBoundingClientRect().top, barras, desplazado: window.scrollY };
  }, ancla);
}

test.describe("N19: lo que llega por un ancla queda debajo de las barras", () => {
  test("portal a 390 con JavaScript: «Directorio» de Personas", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await sesionDe(context, GIL);
    const { arriba, barras, desplazado } = await llegadaPorAncla(page, `/c/${TALLER}/consola/personas`, "directorio-titulo");
    expect(desplazado, "la página bajó hasta el ancla").toBeGreaterThan(0);
    expect(arriba, `el título en y=${arriba}, las barras hasta y=${barras}`).toBeGreaterThanOrEqual(barras);
  });

  test("portal y Operación a 390 sin JavaScript: «Directorio» y «Registrar prospecto»", async ({ browser }) => {
    const sinJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const page = await sinJs.newPage();
    await sesionDe(sinJs, GIL);
    const portal = await llegadaPorAncla(page, `/c/${TALLER}/consola/personas`, "directorio-titulo");
    expect(portal.desplazado).toBeGreaterThan(0);
    expect(portal.arriba, `portal: título en y=${portal.arriba}, barras hasta y=${portal.barras}`).toBeGreaterThanOrEqual(portal.barras);
    await sesionDe(sinJs, CORREOS.op1, { superficie: "sofipo" });
    const operacion = await llegadaPorAncla(page, "/operacion/clientes/nuevo", "prospecto-titulo");
    expect(operacion.arriba, `Operación: título en y=${operacion.arriba}, barras hasta y=${operacion.barras}`).toBeGreaterThanOrEqual(operacion.barras);
    await sinJs.close();
  });
});

// trece-N1 (revisión del #59): las barras pegadas arriba eran translúcidas (el fondo al 70 %). Con la página desplazada,
// lo que pasa por debajo se ve a través: a 390, un botón oscuro bajo «Operación SOFIPO» dejaba el texto en 3.27:1. axe
// solo mide lo que hay debajo en ese momento; esta prueba calcula el peor caso: compone el fondo de la barra sobre negro
// y sobre blanco puros y pide AA a cada texto a la vista (4.5:1, o 3:1 si es grande).
async function contrasteConCualquierCosaDebajo(page: Page, ruta: string, tema: string, conJs = true): Promise<string[]> {
  // `sesionDe` borra las cookies: el tema va después de abrir la sesión, y se comprueba que la página lo tomó.
  await page.context().addCookies([{ name: "tema", value: tema, url: ORIGEN }]);
  await page.goto(ruta, { waitUntil: conJs ? "networkidle" : "load" });
  await expect(page.locator("html")).toHaveAttribute("data-tema", tema);
  // Sin transición en las barras, el fondo que se mide es el final (en su atributo style: la CSP del #62 no deja meter
  // un <style> sin nonce). Una página corta no se desplaza y la barra de escritorio seguiría sin fondo (nada pasa
  // debajo): se alarga para que sí.
  await page.evaluate(() => {
    for (const barra of document.querySelectorAll<HTMLElement>(".barra-movil, .barra-superior")) barra.style.transition = "none";
    document.body.style.paddingBottom = "3000px";
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  // Con JavaScript, la barra de escritorio toma su fondo al desplazarse (`data-desplazada`); sin él, lo lleva siempre.
  const escritorio = page.locator(".barra-superior");
  if (conJs && (await escritorio.isVisible())) await expect(escritorio).toHaveAttribute("data-desplazada", "");
  return page.evaluate(() => {
    type Rgba = [number, number, number, number];
    const leer = (css: string): Rgba => {
      const n = (css.match(/-?[\d.]+%?/g) ?? []).map((x) => (x.endsWith("%") ? parseFloat(x) / 100 : parseFloat(x)));
      if (css.startsWith("color(srgb")) return [n[0]! * 255, n[1]! * 255, n[2]! * 255, n[3] ?? 1];
      return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
    };
    const sobre = ([r, g, b, a]: Rgba, [R, G, B]: Rgba): Rgba => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a), 1];
    const luz = ([r, g, b]: Rgba) => {
      const c = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
    };
    const razon = (x: Rgba, y: Rgba) => { const [a, b] = [luz(x), luz(y)].sort((p, q) => q - p); return (a! + 0.05) / (b! + 0.05); };
    const fallas: string[] = [];
    for (const barra of document.querySelectorAll<HTMLElement>(".barra-movil, .barra-superior")) {
      if (!barra.getClientRects().length) continue;
      for (const el of barra.querySelectorAll<HTMLElement>("*")) {
        const texto = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join("").trim();
        const caja = el.getBoundingClientRect();
        const estilo = getComputedStyle(el);
        if (!texto || !caja.width || !caja.height || estilo.visibility === "hidden" || el.closest("[hidden], .solo-lector")) continue;
        // Los fondos desde la barra hasta el texto (la barra primero).
        const capas: Rgba[] = [];
        for (let x: HTMLElement | null = el; x; x = x === barra ? null : x.parentElement) capas.unshift(leer(getComputedStyle(x).backgroundColor));
        const grande = parseFloat(estilo.fontSize) >= 24 || (parseFloat(estilo.fontSize) >= 18.66 && Number(estilo.fontWeight) >= 700);
        for (const [nombre, debajo] of [["negro", [0, 0, 0, 1]], ["blanco", [255, 255, 255, 1]]] as const) {
          const fondo = capas.reduce((acum, capa) => sobre(capa, acum), debajo as Rgba);
          const r = razon(sobre(leer(estilo.color), fondo), fondo);
          if (r < (grande ? 3 : 4.5)) fallas.push(`«${texto.slice(0, 30)}» (${barra.className.split(" ")[0]}) con ${nombre} debajo: ${r.toFixed(2)}:1`);
        }
      }
    }
    return fallas;
  });
}

test.describe("trece-N1: las barras de arriba conservan AA con cualquier cosa debajo", () => {
  for (const tema of ["claro", "oscuro", "lever"]) {
    for (const ventana of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      test(`${tema} a ${ventana.width}: portal y Operación, desplazados al fondo`, async ({ page, context }) => {
        await page.setViewportSize(ventana);
        await sesionDe(context, GIL);
        expect.soft(await contrasteConCualquierCosaDebajo(page, `/c/${TALLER}/consola/personas`, tema), "portal").toEqual([]);
        await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
        expect.soft(await contrasteConCualquierCosaDebajo(page, "/operacion/clientes", tema), "Operación").toEqual([]);
      });
    }
  }

  for (const tema of ["claro", "oscuro", "lever"]) {
    test(`sin JavaScript, ${tema} a 390 y 1440: la barra lleva su fondo siempre`, async ({ browser }) => {
      for (const ventana of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        const sinJs = await browser.newContext({ javaScriptEnabled: false, viewport: ventana });
        const page = await sinJs.newPage();
        await sesionDe(sinJs, GIL);
        expect.soft(await contrasteConCualquierCosaDebajo(page, `/c/${TALLER}/consola/personas`, tema, false), `portal a ${ventana.width}`).toEqual([]);
        await sesionDe(sinJs, CORREOS.op1, { superficie: "sofipo" });
        expect.soft(await contrasteConCualquierCosaDebajo(page, "/operacion/clientes", tema, false), `Operación a ${ventana.width}`).toEqual([]);
        await sinJs.close();
      }
    });
  }
});

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

  // A 390, «Salir» en la primera fila le quitaba ancho al título («Per…»). Va en su propia fila: ningún texto a la
  // vista se corta con puntos suspensivos, ni en los títulos largos. Los textos solo para lector (recortados a 1 px)
  // no cuentan.
  test("a 390 ningún texto a la vista se recorta, con «Salir» debajo", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await sesionDe(context, GIL);
    for (const [ruta, titulo] of [
      ["personas", "Personas"],
      ["internacional", "Pagos internacionales"],
      ["proveedores", "Proveedores"],
    ] as const) {
      await page.goto(`/c/${TALLER}/consola/${ruta}`);
      await expect(page.locator(".barra-titulo"), ruta).toHaveText(titulo);
      await expect(page.getByRole("button", { name: "Salir", exact: true }), ruta).toBeVisible();
      const cortados = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((nodo) => {
            const caja = nodo.getBoundingClientRect();
            if (caja.width <= 1 || caja.bottom < 0 || caja.top > innerHeight) return false;
            const estilo = getComputedStyle(nodo);
            return estilo.textOverflow === "ellipsis" && nodo.scrollWidth > nodo.clientWidth;
          })
          .map((nodo) => `${nodo.className}: ${nodo.textContent?.trim()}`),
      );
      expect(cortados, ruta).toEqual([]);
    }
  });
});
