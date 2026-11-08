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

test("Movimientos: un gesto del ratón en «7 días» que no lo elige no retrasa el siguiente filtro", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, GIL);
  // Ninguno de estos gestos hace clic en el periodo: soltar fuera, clic derecho y clic central.
  const gestos: [string, (centro: { x: number; y: number }) => Promise<void>][] = [
    [
      "bajar en «7 días» y soltar fuera",
      async (centro) => {
        const titulo = await page.locator("#movimientos-mapa").boundingBox();
        await page.mouse.move(centro.x, centro.y);
        await page.mouse.down();
        await page.mouse.move(titulo!.x + 20, titulo!.y + titulo!.height / 2, { steps: 5 });
        await page.mouse.up();
      },
    ],
    ...(["right", "middle"] as const).map((boton): [string, (centro: { x: number; y: number }) => Promise<void>] => [
      `clic ${boton === "right" ? "derecho" : "central"} en «7 días»`,
      async (centro) => {
        await page.mouse.move(centro.x, centro.y);
        await page.mouse.down({ button: boton });
        await page.mouse.up({ button: boton });
      },
    ]),
  ];
  for (const [gesto, hacer] of gestos) {
    await page.goto(`/c/${TALLER}/consola/movimientos`);
    const navegaciones: string[] = [];
    const contar = (peticion: Request) => {
      if (peticion.headers()["next-router-prefetch"]) return;
      if (new URL(peticion.url()).searchParams.get("desde") === "5000") navegaciones.push(peticion.url());
    };
    page.on("request", contar);
    // Cuánto tarda el formulario en salir después del «change» del monto: de inmediato, o medio segundo si espera un clic.
    await page.locator("#movimientos-desde").evaluate((campo: HTMLInputElement) => {
      const marcas = ((window as unknown as { marcasN4: Record<string, number> }).marcasN4 = {});
      campo.addEventListener("change", () => (marcas.cambio = performance.now()));
      campo.form!.addEventListener("submit", () => (marcas.envio = performance.now()));
    });
    const boton = await page.locator('[aria-label="Periodo"]').getByText("7 días", { exact: true }).boundingBox();
    await hacer({ x: boton!.x + boton!.width / 2, y: boton!.y + boton!.height / 2 });
    // Sin otro toque: al monto se llega con el teclado.
    await page.locator("#movimientos-desde").focus();
    await page.keyboard.type("5000");
    await page.keyboard.press("Tab");
    await expect(page, gesto).toHaveURL(/[?&]desde=5000(&|$)/);
    await expect(page, gesto).not.toHaveURL(/[?&]periodo=7(&|$)/);
    const { cambio, envio } = await page.evaluate(() => (window as unknown as { marcasN4: Record<string, number> }).marcasN4);
    expect(envio - cambio, `${gesto}: milisegundos entre el cambio y el envío`).toBeLessThan(250);
    await page.waitForTimeout(1000);
    page.off("request", contar);
    expect(navegaciones, `${gesto}: un cambio, una navegación`).toHaveLength(1);
  }
  expect(errores).toEqual([]);
});

test("Movimientos: «Limpiar filtros», «Atrás» y «Adelante» dejan los campos como dice la dirección", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, GIL);
  const ruta = `/c/${TALLER}/consola/movimientos`;
  const persona = page.getByLabel("Persona", { exact: true });
  const area = page.getByLabel("Área", { exact: true });
  const monto = page.locator("#movimientos-desde");
  const limpiar = page.getByRole("link", { name: "Limpiar filtros" });
  const consulta = () => new URL(page.url()).searchParams;
  await page.goto(ruta);
  const alguien = (await persona.locator("option").nth(1).getAttribute("value"))!;
  const unArea = (await area.locator("option").nth(1).getAttribute("value"))!;
  /** Después de limpiar, otro filtro solo lleva lo suyo: ni la persona ni el monto de antes. */
  const elSiguienteVaSolo = async (desde: string) => {
    await expect(persona, `${desde}: Persona vacía`).toHaveValue("");
    await expect(monto, `${desde}: monto vacío`).toHaveValue("");
    await area.selectOption(unArea);
    await expect.poll(() => consulta().get("area")).toBe(unArea);
    expect(consulta().get("persona") ?? "", `${desde}: el filtro siguiente no arrastra la persona`).toBe("");
    expect(consulta().get("desde") ?? "", `${desde}: el filtro siguiente no arrastra el monto`).toBe("");
  };

  // A mano: persona con el selector y monto con Enter.
  await persona.selectOption(alguien);
  await expect.poll(() => consulta().get("persona")).toBe(alguien);
  await monto.click();
  await page.keyboard.type("100");
  await page.keyboard.press("Enter");
  await expect.poll(() => consulta().get("desde")).toBe("100");
  await limpiar.click();
  await expect.poll(() => new URL(page.url()).search).toBe("");
  await expect(persona, "tras limpiar: Persona vacía").toHaveValue("");
  await expect(monto, "tras limpiar: monto vacío").toHaveValue("");
  // «Atrás» vuelve a la persona y el monto; «Adelante», a la lista sin filtros.
  await page.goBack();
  await expect.poll(() => consulta().get("desde")).toBe("100");
  await expect(persona, "con «Atrás»: la persona de la dirección").toHaveValue(alguien);
  await expect(monto, "con «Atrás»: el monto de la dirección").toHaveValue("100");
  await page.goForward();
  await expect.poll(() => new URL(page.url()).search).toBe("");
  await elSiguienteVaSolo("a mano");

  // Desde la dirección: los filtros llegan en la URL.
  await page.goto(`${ruta}?persona=${encodeURIComponent(alguien)}&desde=100`);
  await expect(persona).toHaveValue(alguien);
  await expect(monto).toHaveValue("100");
  await limpiar.click();
  await expect.poll(() => new URL(page.url()).search).toBe("");
  await elSiguienteVaSolo("desde la dirección");

  // Lo que se escribe mientras llega otra navegación no se borra: se retiene la respuesta y se escribe el monto.
  await page.goto(ruta);
  let soltar = () => {};
  const retenida = new Promise<void>((listo) => (soltar = listo));
  await page.route(
    (url) => url.searchParams.get("persona") === alguien,
    async (peticion) => {
      await retenida;
      await peticion.continue();
    },
  );
  await persona.selectOption(alguien);
  await monto.click();
  await page.keyboard.type("250");
  soltar();
  await expect.poll(() => consulta().get("persona")).toBe(alguien);
  await expect(persona).toHaveValue(alguien);
  await page.waitForTimeout(500);
  await expect(monto, "el monto que se estaba escribiendo sigue ahí").toHaveValue("250");
  await page.unrouteAll();
  expect(errores).toEqual([]);
});

test.describe("en el teléfono", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("Movimientos: escribir el monto y tocar «7 días» lleva los dos en una sola navegación", async ({ page, context }) => {
    const errores = vigilarConsola(page);
    await sesionDe(context, GIL);
    await page.goto(`/c/${TALLER}/consola/movimientos`);
    // Sin depender de si el periodo es enlace o botón: lo que se mide es la dirección y la red.
    const periodos = page.locator('[aria-label="Periodo"]');
    const navegaciones: string[] = [];
    page.on("request", (peticion) => {
      if (peticion.headers()["next-router-prefetch"]) return;
      const url = new URL(peticion.url());
      if (url.pathname.endsWith("/consola/movimientos") && url.search) navegaciones.push(url.search);
    });
    await page.locator("#movimientos-desde").tap();
    await page.keyboard.type("4000");
    // Sin salir del campo: el toque en el periodo es lo que le quita el foco al monto.
    await periodos.getByText("7 días", { exact: true }).tap();
    await expect(page).toHaveURL(/[?&]periodo=7(&|$)/);
    await expect(page).toHaveURL(/[?&]desde=4000(&|$)/);
    await expect(periodos.locator('[aria-pressed="true"], [aria-current="page"]')).toHaveText("7 días");
    await expect(page.locator("#movimientos-desde")).toHaveValue("4000");
    // Un segundo envío saldría a más tardar medio segundo después; uno de sobra para verlo.
    await page.waitForTimeout(1500);
    expect(navegaciones, "un toque, una navegación").toHaveLength(1);
    expect(errores).toEqual([]);
  });
});
