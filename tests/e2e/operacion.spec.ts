import { randomUUID } from "node:crypto";

import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";

import { CLAVE, codigoDeSemilla, codigoTotp, consultar, contar, dobleClic, envejecerFactor, idDe, ORIGEN, sesionDe, vigilarConsola } from "./apoyo";
import { BRISA, CIMA, CORREOS, DUNA, EJE, ENEBRO, FARO, FRESNO, GRANADO, HIGUERA } from "./siembra";

/**
 * Operación SOFIPO: entrada con segundo factor, alta de un prospecto con la
 * activación decidida por otra persona (Originación pide, Aprobación decide y
 * el candado de la 0028 exige expediente aprobado y riesgo vigente), la
 * recuperación del segundo factor de
 * una clienta (pedida desde /entrar, aprobada en Recuperaciones tras «Confirma
 * que eres tú» y cerrada con un factor nuevo) y la publicación del precio, que
 * exige un factor de los últimos 30 minutos. Cada envío con doble clic real y
 * conteo en la base.
 */

// Cuatro grupos seriales, cada uno con lo que siembra tests/e2e/siembra.ts: el archivo es «parallel» solo para que
// `--shard` reparta grupos y no el archivo entero (con workers: 1 corren en orden). Playwright reparte por número de
// pruebas y el grupo que empieza antes del corte va entero a esa parte: el más corto va primero y comparte la parte 1
// con los specs anteriores (entrada, flujo de caja, invitación, marco y nómina, unos 70 s); «Operación SOFIPO» y el
// grupo con JavaScript caen en la 2; el de coincidencias, con los specs posteriores, en la 3. La guarda de
// scripts/ci/pruebas-e2e.sh falla si una parte queda sin pruebas.
test.describe.configure({ mode: "parallel" });

const PROSPECTO = { razonSocial: "Puerto Nuevo E2E", rfc: "PNE200101AB3" };
const MOTIVO_CORTO = "El motivo lleva al menos 10 caracteres: explica por qué en una frase. Queda en la bitácora y lo lee otra persona.";
const FORMATO = "Revisa el campo marcado: el dato no tiene el formato esperado.";
const VUELVE_A_ELEGIR = "Vuelve a elegir el archivo: por seguridad, el navegador no lo guarda después de un rechazo. Lo demás sigue como lo escribiste.";

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

/**
 * Onceava revisión: el texto del error está a la vista junto al campo con foco, sin desplazarse. El campo tiene el foco
 * y apunta al mensaje (`aria-describedby`), el mensaje está dentro de la ventana y fuera de las barras fijas, y en la
 * página hay un solo campo marcado. Doceava: el mensaje va justo arriba del control, entre la etiqueta y el control
 * (patrón GOV.UK), y el control asoma en la ventana. Mide con las cajas de Playwright, que sirven también sin
 * JavaScript; antes de exigir, imprime la medida («MEDIDA …»).
 */
async function mensajeJunto(page: Page, campo: string, texto: string, idMensaje = "aviso-operacion-campo"): Promise<void> {
  const control = page.locator(campo);
  await expect(page.locator(`${campo}:focus`)).toHaveCount(1);
  const alto = page.viewportSize()!.height;
  let tapa = 0;
  for (const barra of [".barra-movil", ".barra-superior"]) {
    const caja = (await page.locator(barra).count()) ? await page.locator(barra).first().boundingBox() : null;
    if (caja && caja.y <= 1 && caja.height > 0) tapa = Math.max(tapa, caja.y + caja.height);
  }
  const cajaCampo = (await control.boundingBox())!;
  const cajaMensaje = await page.locator(`[id="${idMensaje}"]`).first().boundingBox();
  const visible = cajaMensaje !== null && cajaMensaje.y >= tapa && cajaMensaje.y + cajaMensaje.height <= alto && cajaCampo.y + Math.min(cajaCampo.height, 40) <= alto;
  const redondo = (caja: { y: number; height: number } | null) => (caja ? { arriba: Math.round(caja.y), abajo: Math.round(caja.y + caja.height) } : null);
  console.log(`MEDIDA ${campo} ${page.viewportSize()!.width}: ${JSON.stringify({ mensaje: redondo(cajaMensaje), campo: redondo(cajaCampo), barras: Math.round(tapa), ventana: alto, visible })}`);
  await expect(control).toHaveAttribute("aria-describedby", new RegExp(`(^| )${idMensaje}( |$)`));
  await expect(page.locator(`[id="${idMensaje}"]`)).toHaveCount(1);
  await expect(page.locator(`[id="${idMensaje}"]`)).toHaveText(texto);
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(1);
  expect(visible).toBe(true);
  // Justo arriba del control: entre el mensaje y la orilla de arriba del control no cabe otro campo.
  const separacion = cajaCampo.y - (cajaMensaje!.y + cajaMensaje!.height);
  expect(separacion).toBeGreaterThanOrEqual(0);
  expect(separacion).toBeLessThanOrEqual(24);
}

/**
 * Doceava revisión: un formulario de Operación rechazado no cambia la dirección y vuelve con su aviso arriba del
 * formulario: con JavaScript sin recargar; sin JavaScript, la página que responde al POST con 200 (ningún dato
 * capturado pasa por la dirección). Con JavaScript marca antes el aviso anterior para esperar el nuevo.
 */
async function rechazado(page: Page, boton: Locator, idAviso: string, sinJs = false): Promise<void> {
  const direccion = page.url();
  if (!sinJs) await page.evaluate((id) => document.getElementById(id)?.setAttribute("data-anterior", "1"), idAviso);
  const [respuesta] = await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), boton.click()]);
  await expect(page.locator(`[id="${idAviso}"]:not([data-anterior])`)).toBeVisible();
  expect(respuesta.status()).toBe(200);
  expect(page.url()).toBe(direccion);
  // El aviso de un formulario que ya no se pinta (arriba de la página) sobra cuando el formulario muestra el suyo.
  await expect(page.locator("#aviso-rechazo")).toBeHidden();
}

/**
 * Doceava revisión: otra pestaña registra el dictamen entre la vista y el envío. El rechazo vuelve a pintar la página,
 * que ya no tiene el formulario del dictamen; antes su aviso se iba con él y la página quedaba sin explicación. Ahora va
 * arriba de la página, anunciado, y no se queda: la cookie que lo trae nunca llega al navegador.
 */
async function dictamenYaRegistrado(page: Page, context: BrowserContext, rfc: string): Promise<void> {
  const companyId = await empresaDe(rfc);
  const dictamenes = () => contar("select 1 from kyb_dictamenes d join kyb_versiones v on v.id = d.version_id where v.company_id = $1", [companyId]);
  await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
  const ruta = `/operacion/clientes/${companyId}/expediente`;
  await page.goto(ruta);
  await page.locator("#dictamen-resultado").selectOption("observado");
  await page.locator("#dictamen-motivo").fill("Falta el acta constitutiva completa.");
  const otra = await context.newPage();
  await otra.goto(ruta);
  await otra.locator("#dictamen-resultado").selectOption("aprobado");
  await otra.locator("form:has(#dictamen-motivo)").getByRole("button", { name: "Registrar dictamen" }).click();
  await otra.waitForURL(/aviso=expediente_dictaminado/);
  await otra.close();
  expect(await dictamenes()).toBe(1);
  const direccion = page.url();
  const [respuesta] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST"),
    page.locator("form:has(#dictamen-motivo)").getByRole("button", { name: "Registrar dictamen" }).click(),
  ]);
  expect(respuesta.status()).toBe(200);
  const aviso = page.locator("#aviso-rechazo");
  await expect(aviso).toBeVisible();
  await expect(aviso).toHaveAttribute("data-aviso", "dictamen_ya_registrado");
  await expect(aviso).toHaveText("Esa versión ya tiene dictamen.");
  await expect(aviso.locator(".alerta")).toHaveAttribute("role", "alert");
  await expect(page.locator("#dictamen-motivo")).toHaveCount(0);
  await expect(page.locator(".operacion-aviso")).toHaveCount(1);
  expect(page.url()).toBe(direccion);
  expect(await dictamenes()).toBe(1);
  expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain("operacion-rechazo");
  await page.goto(ruta);
  await expect(page.locator("#aviso-rechazo")).toHaveCount(0);
}

/**
 * Cambia el cuerpo de los envíos (POST) hasta `soltar()`: arma a mano lo que la pantalla no deja escribir (un nivel
 * que no es de la lista) o reusa un identificador de formulario. Cada reemplazo conserva el largo del cuerpo.
 */
async function alterarEnvio(page: Page, cambio: (cuerpo: string) => string): Promise<{ soltar: () => Promise<void>; vistos: () => number }> {
  let vistos = 0;
  const ruta = async (route: Route) => {
    const peticion = route.request();
    const cuerpo = peticion.postDataBuffer();
    if (peticion.method() !== "POST" || !cuerpo) return route.continue();
    const antes = cuerpo.toString("latin1");
    const despues = cambio(antes);
    if (despues.length !== antes.length) throw new Error("el reemplazo cambia el largo del cuerpo");
    if (despues !== antes) vistos += 1;
    await route.continue({ postData: Buffer.from(despues, "latin1") });
  };
  await page.route("**/operacion/**", ruta);
  return { soltar: () => page.unroute("**/operacion/**", ruta), vistos: () => vistos };
}

/** El identificador de formulario (oculto) de un formulario de la página. */
const formIdDe = (page: Page, formulario: string) => page.locator(`${formulario} input[name="formId"]`).getAttribute("value") as Promise<string>;

/**
 * El expediente de Duna rechaza un «PDF» que no lo es (documentos) y un capital «abc» del socio (accionistas); la ficha
 * de Cima, un motivo de reactivación de 9 caracteres («Revisar 😀», 10 unidades UTF-16: el navegador lo deja pasar).
 * Doceava: cada uno vuelve con su aviso en el formulario y lo capturado; el archivo se elige otra vez y la nota lo dice.
 */
async function errorDeDocumentoYDeSocio(page: Page, ancho: number, sinJs = false): Promise<void> {
  const [duna] = await consultar<{ id: string }>("select id from companies where rfc = $1", [DUNA.rfc]);
  const documentos = () => contar("select 1 from kyb_documentos where company_id = $1", [duna!.id]);
  const socios = () => contar("select 1 from kyb_accionistas where company_id = $1", [duna!.id]);
  const [documentosAntes, sociosAntes] = [await documentos(), await socios()];
  await page.setViewportSize({ width: ancho, height: ancho < 600 ? 844 : 900 });
  await page.goto(`/operacion/clientes/${duna!.id}/expediente`);
  await page.locator("#doc-tipo").selectOption("acta_constitutiva");
  await page.locator("#doc-emitido").fill("2015-03-01");
  await page.locator("#doc-detalle").fill("Escritura 1,204, Notaría 9 de Monterrey");
  await page.locator("#doc-archivo").setInputFiles({ name: "acta-falsa.pdf", mimeType: "application/pdf", buffer: Buffer.from("esto no es un PDF") });
  const guardar = page.getByRole("button", { name: "Guardar documento" });
  await rechazado(page, guardar, "aviso-documento", sinJs);
  await mensajeJunto(page, "#doc-archivo", "Sube un PDF, PNG o JPG legible.", "aviso-documento-campo");
  // Vuelve todo menos el archivo, que se elige otra vez: la nota lo dice junto al campo y lo describe.
  await expect(page.locator("#doc-tipo")).toHaveValue("acta_constitutiva");
  await expect(page.locator("#doc-emitido")).toHaveValue("2015-03-01");
  await expect(page.locator("#doc-detalle")).toHaveValue("Escritura 1,204, Notaría 9 de Monterrey");
  await expect(page.locator("#doc-archivo")).toHaveValue("");
  await expect(page.locator("#doc-archivo-nota")).toHaveText(VUELVE_A_ELEGIR);
  await expect(page.locator("#doc-archivo")).toHaveAttribute("aria-describedby", "aviso-documento-campo doc-archivo-nota");
  // El mismo error otra vez, con lo que volvió: solo se elige el archivo.
  await page.locator("#doc-archivo").setInputFiles({ name: "acta-falsa-2.pdf", mimeType: "application/pdf", buffer: Buffer.from("tampoco es un PDF") });
  await rechazado(page, guardar, "aviso-documento", sinJs);
  await mensajeJunto(page, "#doc-archivo", "Sube un PDF, PNG o JPG legible.", "aviso-documento-campo");

  await page.goto(`/operacion/clientes/${duna!.id}/expediente`);
  await page.locator("#acc-tipo").selectOption("fisica");
  await page.locator("#acc-nombre").fill("Lucía Garza Peña");
  await page.locator("#acc-curp").fill("GORL750505MDFMZR04");
  await page.locator("#acc-capital").fill("abc");
  await page.locator("#acc-votos").fill("10");
  await page.getByRole("button", { name: "Agregar accionista" }).click();
  await expect(page.locator("#aviso-accionista")).toBeVisible();
  await mensajeJunto(page, "#acc-capital", "Revisa el campo marcado: el dato no tiene el formato esperado.", "aviso-accionista-campo");
  await expect(page.locator("#acc-capital")).toHaveValue("abc");
  expect([await documentos(), await socios()]).toEqual([documentosAntes, sociosAntes]);

  // El revisor vio el textarea de la suspensión con el foco pero asomado al pie (y=943 de 1000).
  const [cima] = await consultar<{ id: string }>("select id from companies where rfc = $1", [CIMA.rfc]);
  const solicitudes = () => contar("select 1 from company_suspensions where company_id = $1", [cima!.id]);
  const solicitudesAntes = await solicitudes();
  await page.goto(`/operacion/clientes/${cima!.id}`);
  await page.locator("#motivo-suspension").fill("Revisar 😀");
  await rechazado(page, page.getByRole("button", { name: "Pedir reactivación" }), "aviso-suspension", sinJs);
  await mensajeJunto(page, "#motivo-suspension", MOTIVO_CORTO, "aviso-suspension-campo");
  await expect(page.locator("#motivo-suspension")).toHaveValue("Revisar 😀");
  expect(await solicitudes()).toBe(solicitudesAntes);
}

/** Tres recuperaciones pendientes con su evento en la bitácora (la base exige el rastro en la misma transacción). */
async function recuperacionesPendientes(personas: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const correo of personas) {
    const id = randomUUID();
    await consultar(
      `with r as (
         insert into auth_recuperaciones (id, user_id, solicitada_en, motivo) values ($1, $2, now(), 'Cambié de teléfono y perdí la app.')
         returning id, user_id
       )
       insert into audit_log (id, operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, ocurrido_en)
       select gen_random_uuid(), (select id from operators order by alta_en limit 1), null, 'miembro', r.user_id, 'cliente',
         'recuperacion_solicitada', 'auth_recuperaciones', r.id, now()
       from r`,
      [id, await idDe(correo)],
    );
    ids.push(id);
  }
  return ids;
}

async function salirDeOperacion(page: Page): Promise<void> {
  await page.locator(".cuenta .menu-desplegable-boton").click();
  await page.getByRole("menuitem", { name: "Salir" }).click();
  await page.waitForURL(/\/operacion\/entrar/);
}

// Doceava revisión, sin JavaScript, sobre empresas que solo usa este grupo (Enebro, Granado, Higuera, Bahía) o que solo
// rechaza (Cima y Brisa): no depende de los otros grupos ni los cambia. Va primero porque es el más corto (ver arriba).
test.describe("doceava sin JavaScript: empresas propias de la siembra", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ javaScriptEnabled: false });

  test("sin JavaScript, el dictamen y el grado de riesgo de Enebro vuelven con lo elegido a 390; el doble clic tras el rechazo registra una vez", async ({ page, context }) => {
    await dictamenYRiesgo(page, context, ENEBRO.rfc, true);
  });

  // Doceava revisión: sin JavaScript, el envío va a la dirección del documento con todo y fragmento. Tras «Saltar al
  // contenido» la dirección trae «#contenido» y, si la página que responde tuviera ese destino, el navegador descartaría
  // el autofocus: el foco no llegaría al campo rechazado. En esa respuesta el destino lleva un sufijo nuevo.
  test("sin JavaScript, tras «Saltar al contenido» el rechazo de una tarjeta deja el foco en su campo, dos veces seguidas", async ({ page, context }) => {
    const cima = await coincidenciaDe(CIMA.rfc, "pendiente");
    await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
    await page.goto("/operacion/lpb");
    const salto = page.getByRole("link", { name: "Saltar al contenido" });
    await expect(salto).toHaveAttribute("href", "#contenido");
    await expect(page.locator("main#contenido")).toHaveCount(1);
    const motivo = page.locator(`[id="motivo-${cima}"]`);
    const registrar = page.locator(`form:has([id="motivo-${cima}"])`).getByRole("button", { name: "Registrar dictamen" });
    let anterior = "contenido";
    for (const vuelta of [1, 2]) {
      await salto.press("Enter");
      await expect(page).toHaveURL(new RegExp(`#${anterior}$`));
      await page.locator(`[id="resolucion-${cima}"]`).selectOption("fuera_de_lista");
      await motivo.fill("Revisar 😀");
      await rechazado(page, registrar, `aviso-coincidencia-${cima}`, true);
      await mensajeJunto(page, `[id="motivo-${cima}"]`, MOTIVO_CORTO, `aviso-coincidencia-${cima}-campo`);
      // El enlace sigue sirviendo: apunta al `main` de esta respuesta, con un destino que ninguna dirección anterior trae.
      const destino = (await salto.getAttribute("href"))!.slice(1);
      expect(destino, `vuelta ${vuelta}`).toMatch(/^contenido-[0-9a-f]{8}$/);
      expect(destino).not.toBe(anterior);
      await expect(page.locator(`main[id="${destino}"]`)).toHaveCount(1);
      await expect(page.locator(`[id="${anterior}"]`)).toHaveCount(0);
      anterior = destino;
    }
    expect(await contar("select 1 from lpb_coincidencias where id = $1 and estado = 'pendiente'", [cima])).toBe(1);
  });

  test("sin JavaScript, si otra pestaña ya registró el dictamen, el rechazo de Granado va arriba de la página aunque su formulario ya no se pinte", async ({ page, context }) => {
    await dictamenYaRegistrado(page, context, GRANADO.rfc);
  });

  // Hallazgo del #60: sin JavaScript el menú de la cuenta no abre y no había manera de cerrar sesión en Operación.
  test("sin JavaScript, «Salir» se ve junto al menú, cierra la sesión y /operacion vuelve a la entrada, a 1440 y 390; el título y el chip no ceden espacio; con JavaScript no se ve", async ({ page, context, browser }) => {
    for (const [ancho, alto] of [[1440, 900], [390, 844]] as const) {
      await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
      await page.setViewportSize({ width: ancho, height: alto });
      await page.goto("/operacion/clientes");
      const salir = page.locator(".barra-superior").getByRole("button", { name: "Salir", exact: true });
      await expect(salir, `a ${ancho}`).toBeVisible();
      await expect(page.locator(".barra-titulo")).toHaveText("Clientes");
      const [titulo, chip, boton] = [
        (await page.locator(".barra-titulo").boundingBox())!,
        (await page.locator(".cuenta .menu-desplegable-boton").boundingBox())!,
        (await salir.boundingBox())!,
      ];
      const centro = (caja: { y: number; height: number }) => caja.y + caja.height / 2;
      console.log(`MEDIDA salir ${ancho}: ${JSON.stringify({ titulo, chip, boton })}`);
      if (ancho === 1440) {
        // Junto al chip, en el mismo renglón; el título no se encima con ninguno.
        expect(Math.abs(centro(boton) - centro(chip))).toBeLessThan(6);
        expect(boton.x).toBeGreaterThanOrEqual(chip.x + chip.width);
        expect(titulo.x + titulo.width).toBeLessThanOrEqual(chip.x);
      } else {
        // En su propio renglón, debajo: el título y el chip comparten el primero, como con JavaScript.
        expect(Math.abs(centro(titulo) - centro(chip))).toBeLessThan(12);
        expect(boton.y).toBeGreaterThanOrEqual(Math.max(titulo.y + titulo.height, chip.y + chip.height));
        expect(boton.x + boton.width).toBeLessThanOrEqual(ancho);
        expect(titulo.x + titulo.width).toBeLessThanOrEqual(chip.x);
        await page.screenshot({ path: test.info().outputPath("salir-sin-js-390.png") });
      }
      // Con JavaScript el <noscript> no se ve: ni el botón ni su HTML como texto (la barra lo pintaba con display: contents).
      const conJs = await browser.newContext({ baseURL: ORIGEN, viewport: { width: ancho, height: alto }, javaScriptEnabled: true });
      try {
        await sesionDe(conJs, CORREOS.op1, { superficie: "sofipo" });
        const otra = await conJs.newPage();
        await otra.goto("/operacion/clientes");
        await expect(otra.locator(".barra-superior")).not.toContainText("salir-sin-script", { useInnerText: true });
        await expect(otra.locator(".barra-superior").getByRole("button", { name: "Salir", exact: true })).toHaveCount(0);
        expect(await otra.evaluate(() => document.documentElement.scrollWidth), `sin desborde a ${ancho}`).toBeLessThanOrEqual(ancho);
      } finally {
        await conJs.close();
      }
      await Promise.all([page.waitForURL(/\/operacion\/entrar/), salir.click()]);
      expect((await context.cookies()).find((cookie) => cookie.name === "__Host-sesion")?.value ?? "").toBe("");
      await page.goto("/operacion");
      await expect(page).toHaveURL(/\/operacion\/entrar/);
    }
  });

  // Doceava revisión (F5): los enlaces de Cumplimiento llevan a `expediente#dictamen-titulo` y `#riesgo-titulo`. Sin
  // JavaScript, el envío conserva ese fragmento; la página que responde pinta esos destinos con un sufijo, así el
  // fragmento no apunta a nada y el foco llega al campo rechazado (idDeAncla).
  test("sin JavaScript, llegando por #dictamen-titulo (Higuera) y por #riesgo-titulo (Brisa), el rechazo deja el foco en su campo", async ({ page, context }) => {
    await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
    const higuera = await empresaDe(HIGUERA.rfc);
    await page.goto("/operacion/cumplimiento");
    await expect(page.locator(`a[href="/operacion/clientes/${higuera}/expediente#dictamen-titulo"]`)).toHaveCount(1);
    await page.goto(`/operacion/clientes/${higuera}/expediente#dictamen-titulo`);
    await page.locator("#dictamen-resultado").selectOption("observado");
    await page.locator("#dictamen-motivo").fill("Revisar 😀");
    await rechazado(page, page.locator("form:has(#dictamen-motivo)").getByRole("button", { name: "Registrar dictamen" }), "aviso-dictamen", true);
    await mensajeJunto(page, "#dictamen-motivo", MOTIVO_CORTO, "aviso-dictamen-campo");
    await expect(page.locator("#dictamen-titulo")).toHaveCount(0);
    await expect(page.locator('[id^="dictamen-titulo-"]')).toHaveCount(1);

    const brisa = await empresaDe(BRISA.rfc);
    await page.goto(`/operacion/clientes/${brisa}/expediente#riesgo-titulo`);
    await page.locator("#riesgo-actividad").selectOption("media");
    await page.locator("#riesgo-zona").selectOption("alta");
    const armado = await alterarEnvio(page, (cuerpo) => cuerpo.replace(/(name="[^"]*actividad"\r\n\r\n)media/, "$1MEDIA"));
    await rechazado(page, page.getByRole("button", { name: /^Registrar (revisión periódica|grado al alta)$/ }), "aviso-riesgo", true);
    await armado.soltar();
    expect(armado.vistos()).toBe(1);
    await mensajeJunto(page, "#riesgo-actividad", FORMATO, "aviso-riesgo-campo");
    await expect(page.locator("#riesgo-titulo")).toHaveCount(0);
    await expect(page.locator('[id^="riesgo-titulo-"]')).toHaveCount(1);
  });

  test("sin JavaScript, la suspensión de Bahía no consume el formulario al rechazarse, el doble clic pide una sola y la otra pestaña ve «ya hay una pendiente»", async ({ page, context, browser }) => {
    await suspensionUnaVez(page, context, browser, "BEE190101CD2", "Pedir suspensión", true);
  });
});

// Entrada, alta con activación (Faro), expediente, recuperación y precio. Las pruebas de la doceava sobre Faro van
// aquí porque necesitan a Faro activa, y la activa «prospecto → pedir activación».
test.describe("Operación SOFIPO", () => {
  test.describe.configure({ mode: "serial" });

  test("entrada SOFIPO: contraseña y código; un código malo no abre y el doble clic abre una sola sesión", async ({ page }) => {
    const errores = vigilarConsola(page);
    const op1 = await idDe(CORREOS.op1);
    // Entrar puede cerrar sesiones viejas de la misma persona: se cuentan las que nacen en esta prueba.
    const desde = (await consultar<{ desde: string }>("select now()::text as desde"))[0]!.desde;
    const sesiones = () => contar("select 1 from sessions where user_id = $1 and superficie = 'sofipo' and creada_en >= $2::timestamptz", [op1, desde]);
    const antes = await sesiones();
    expect(antes).toBe(0);

    await page.goto("/operacion/entrar");
    await page.getByLabel("Correo").fill(CORREOS.op1);
    await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
    const contrasena = await dobleClic(page.getByRole("button", { name: "Continuar" }), { esperar: /\/operacion\/continuar/ });
    expect(contrasena.envios).toBe(1);

    await page.getByLabel("Código de la app autenticadora").fill("000000");
    await page.getByRole("button", { name: "Entrar con el código" }).click();
    await expect(page.locator("#factor-error")).toBeVisible();
    expect(await sesiones()).toBe(antes);

    await page.getByLabel("Código de la app autenticadora").fill(await codigoTotp(CORREOS.op1));
    const codigo = await dobleClic(page.getByRole("button", { name: "Entrar con el código" }), { esperar: /\/operacion$/ });
    expect(codigo.envios).toBe(1);
    expect(await sesiones()).toBe(antes + 1);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(errores).toEqual([]);
  });

  test("prospecto → pedir activación → el candado exige expediente; con todo en regla la decide otra persona con factor reciente", async ({ page, context }) => {
    const errores = vigilarConsola(page);
    const [op1, op2] = [await idDe(CORREOS.op1), await idDe(CORREOS.op2)];
    const empresas = () => contar("select 1 from companies where rfc = $1", [PROSPECTO.rfc]);
    expect(await empresas()).toBe(0);

    // Originación registra el prospecto y pide su activación.
    await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
    await page.goto("/operacion/clientes");
    await page.getByLabel("Razón social").fill(PROSPECTO.razonSocial);
    await page.getByLabel("RFC").fill(PROSPECTO.rfc);
    await page.getByLabel("Código postal").fill("64000");
    const alta = await dobleClic(page.getByRole("button", { name: "Registrar prospecto" }), { esperar: /\/operacion\/clientes\/[0-9a-f-]{36}\?aviso=prospecto_registrado/ });
    expect(alta.envios).toBe(1);
    expect(await empresas()).toBe(1);
    const [empresa] = await consultar<{ id: string; estado: string; originada_por: string }>(
      "select id, estado, originada_por from companies where rfc = $1",
      [PROSPECTO.rfc],
    );
    expect(empresa).toMatchObject({ estado: "prospecto", originada_por: op1 });
    await expect(page.getByText("Prospecto registrado. Ya puedes solicitar su activación.")).toBeVisible();

    const solicitudes = () => contar("select 1 from company_activation_requests where company_id = $1", [empresa!.id]);
    const pedir = await dobleClic(page.getByRole("button", { name: "Solicitar activación" }), { esperar: /aviso=activacion_solicitada/ });
    expect(pedir.envios).toBe(1);
    expect(await solicitudes()).toBe(1);
    await expect(page.getByText("Activación solicitada. La decide otra persona en Aprobaciones.")).toBeVisible();

    // Quien la pidió la ve, pero sin botones.
    const decision = (p: Page, razonSocial: string) => p.locator("li.decision").filter({ hasText: `Activación · ${razonSocial}` });
    await page.goto("/operacion/aprobaciones");
    await expect(decision(page, PROSPECTO.razonSocial).getByText("La pediste tú: decide otra persona.")).toBeVisible();
    await expect(decision(page, PROSPECTO.razonSocial).getByRole("button", { name: "Aprobar" })).toHaveCount(0);

    // Aprobación la decide, pero sin expediente aprobado la base no deja activar (candado de la 0028).
    await sesionDe(context, CORREOS.op2, { superficie: "sofipo" });
    await page.goto("/operacion/aprobaciones");
    await decision(page, PROSPECTO.razonSocial).getByRole("button", { name: "Aprobar" }).click();
    await page.waitForURL(/aviso=activacion_sin_expediente_aprobado/);
    await expect(page.getByText("La base no deja activar: falta un expediente aprobado en su versión vigente.")).toBeVisible();
    const [sinExpediente] = await consultar<{ estado: string; solicitud: string }>(
      `select c.estado, r.estado as solicitud from companies c
       join company_activation_requests r on r.company_id = c.id where c.id = $1`,
      [empresa!.id],
    );
    expect(sinExpediente).toEqual({ estado: "en_alta", solicitud: "pendiente" });

    // serv-N18: «Revisar 😀» son 9 caracteres (10 unidades UTF-16: el navegador lo deja pasar). El servidor lo
    // rechaza y el diálogo sigue abierto con lo escrito, el aviso ligado al campo y el foco en él; corregido, rechaza.
    await page.goto("/operacion/aprobaciones");
    await decision(page, PROSPECTO.razonSocial).getByRole("button", { name: "Rechazar" }).click();
    const dialogo = page.getByRole("dialog", { name: "Rechazar" });
    const motivo = dialogo.getByLabel("Motivo (de 10 a 500 caracteres)");
    await motivo.fill("Revisar 😀");
    await dialogo.getByRole("button", { name: "Rechazar" }).click();
    // El resumen arriba del diálogo y el mismo texto junto al campo, que es su descripción (onceava revisión).
    await expect(dialogo.locator(".operacion-aviso")).toContainText("El motivo lleva al menos 10 caracteres");
    await expect(motivo).toHaveValue("Revisar 😀");
    await expect(motivo).toHaveAttribute("aria-invalid", "true");
    await expect(motivo).toHaveAttribute("aria-describedby", /-aviso-campo$/);
    await expect(dialogo.locator(`[id="${await motivo.getAttribute("aria-describedby")}"]`)).toContainText("al menos 10 caracteres");
    await expect(motivo).toBeFocused();
    expect(new URL(page.url()).search).toBe("");
    expect(await solicitudes()).toBe(1);
    expect((await consultar<{ estado: string }>("select estado from company_activation_requests where company_id = $1", [empresa!.id]))[0]?.estado).toBe("pendiente");
    await motivo.fill("Falta el expediente aprobado de la empresa");
    await dialogo.getByRole("button", { name: "Rechazar" }).click();
    await page.waitForURL(/aviso=decision_registrada/);
    expect((await consultar<{ estado: string }>("select estado from company_activation_requests where company_id = $1", [empresa!.id]))[0]?.estado).toBe("rechazada");

    // Faro E2E (sembrada con expediente aprobado y riesgo vigente; la activación la pidió op1).
    // Con el factor de hace 31 minutos, Aprobación no decide y la base no cambia.
    const [faro] = await consultar<{ id: string; estado: string }>("select id, estado from companies where rfc = $1", [FARO.rfc]);
    expect(faro!.estado).toBe("en_alta");
    await sesionDe(context, CORREOS.op2, { superficie: "sofipo", factorHaceMinutos: 31 });
    await page.goto("/operacion/aprobaciones");
    await decision(page, FARO.razonSocial).getByRole("button", { name: "Aprobar" }).click();
    await expect(page.getByText("Para decidir, tu segundo factor debe ser de los últimos 30 minutos. Sal y vuelve a entrar.")).toBeVisible();
    const [pendiente] = await consultar<{ estado: string }>("select estado from companies where id = $1", [faro!.id]);
    expect(pendiente!.estado).toBe("en_alta");

    // Con factor reciente, un doble clic decide una sola vez.
    await sesionDe(context, CORREOS.op2, { superficie: "sofipo" });
    await page.goto("/operacion/aprobaciones");
    const aprobar = await dobleClic(decision(page, FARO.razonSocial).getByRole("button", { name: "Aprobar" }), { esperar: /aviso=decision_registrada/ });
    expect(aprobar.envios).toBe(1);
    const [decidida] = await consultar<{ estado: string; requested_by: string; decided_by: string; empresa: string }>(
      `select r.estado, r.requested_by, r.decided_by, c.estado as empresa from company_activation_requests r
       join companies c on c.id = r.company_id where r.company_id = $1`,
      [faro!.id],
    );
    expect(decidida).toEqual({ estado: "aprobada", requested_by: op1, decided_by: op2, empresa: "activa" });
    expect(await contar("select 1 from audit_log where accion = 'activacion_aprobada' and company_id = $1", [faro!.id])).toBe(1);
    expect(await contar("select 1 from company_state_history where company_id = $1 and estado_nuevo = 'activa'", [faro!.id])).toBe(1);
    expect(errores).toEqual([]);
  });

  test("un caso abierto de Cumplimiento no se le nombra a Aprobación ni a Originación", async ({ page, context }) => {
    const errores = vigilarConsola(page);
    const estados = async () => (await consultar<{ rfc: string; estado: string }>(
      "select rfc, estado from companies where rfc in ($1, $2) order by rfc", [BRISA.rfc, CIMA.rfc],
    )).map((fila) => fila.estado);
    expect(await estados()).toEqual(["en_alta", "suspendida"]);
    const sinLista = async (id = "aviso-operacion") => {
      const aviso = page.locator(`#${id}`);
      await expect(aviso).toBeVisible();
      await expect(aviso).not.toContainText(/lista/i);
      await expect(aviso).not.toContainText(/bloquead/i);
      return aviso;
    };

    // Aprobación intenta activar a Brisa: la base no deja y el aviso no nombra la lista.
    await sesionDe(context, CORREOS.op2, { superficie: "sofipo" });
    await page.goto("/operacion/aprobaciones");
    await page.locator("li.decision").filter({ hasText: `Activación · ${BRISA.razonSocial}` }).getByRole("button", { name: "Aprobar" }).click();
    await page.waitForURL(/aviso=activacion_con_coincidencia_lpb/);
    await expect(await sinLista()).toContainText("Cumplimiento tiene un caso abierto de esta empresa: no se puede activar hasta que lo resuelva.");

    // Originación pide reactivar a Cima: tampoco se nombra la lista y no queda solicitud.
    const [cima] = await consultar<{ id: string }>("select id from companies where rfc = $1", [CIMA.rfc]);
    await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
    await page.goto(`/operacion/clientes/${cima!.id}`);
    await page.locator("#motivo-suspension").fill("La empresa pidió revisar su caso.");
    // Doceava: el aviso vuelve en el formulario, con el motivo escrito.
    await rechazado(page, page.getByRole("button", { name: "Pedir reactivación" }), "aviso-suspension");
    await expect(await sinLista("aviso-suspension")).toContainText("Cumplimiento tiene un caso abierto de esta empresa: no se puede reactivar hasta que lo resuelva.");
    await expect(page.locator("#motivo-suspension")).toHaveValue("La empresa pidió revisar su caso.");
    expect(await contar("select 1 from company_suspensions where company_id = $1 and tipo = 'reactivacion'", [cima!.id])).toBe(0);
    expect(await estados()).toEqual(["en_alta", "suspendida"]);
    expect(errores).toEqual([]);
  });

  test("el grado de riesgo no le dice a Originación ni a Aprobación que hay una coincidencia; a Cumplimiento sí", async ({ page, context }) => {
    const errores = vigilarConsola(page);
    const [brisa] = await consultar<{ id: string }>("select id from companies where rfc = $1", [BRISA.rfc]);
    const riesgo = page.locator("section", { has: page.locator("#riesgo-titulo") });
    const factor = (etiqueta: string) => riesgo.locator("dl > div", { has: page.locator("dt", { hasText: etiqueta }) }).locator("dd");
    for (const correo of [CORREOS.op1, CORREOS.op2]) {
      await sesionDe(context, correo, { superficie: "sofipo" });
      await page.goto(`/operacion/clientes/${brisa!.id}/expediente`);
      // serv-N9: solo el grado y la fecha de revisión; ningún factor (todos en cero delatarían la lista).
      await expect(riesgo).toContainText("Grado alto");
      await expect(riesgo).toContainText(/Revisar antes del|Revisión vencida/);
      await expect(riesgo.locator("dl")).toHaveCount(0);
      await expect(riesgo).toContainText("El desglose de la calificación lo ven Cumplimiento y Auditoría.");
      await expect(riesgo).not.toContainText(/lista|exacta|puntaje|punto|actividad|zona|antigüedad/i);
      await expect(page.locator("#coincidencias-titulo")).toHaveText("Revisión de Cumplimiento");
      // Tampoco viajan en la respuesta RSC que lleva la página.
      expect(await page.content()).not.toMatch(/antiguedad_meses|volumen_mensual|coincidencias\\?"|exacta|puntaje/i);
    }
    await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
    await page.goto(`/operacion/clientes/${brisa!.id}/expediente`);
    await expect(factor("Coincidencias en listas")).toHaveText("exacta · 3 puntos");
    await expect(riesgo).toContainText("Puntaje");
    await expect(page.locator("#coincidencias-titulo")).toHaveText("Coincidencias con listas");
    expect(errores).toEqual([]);
  });

  test("tras un rechazo del socio extranjero el formulario vuelve con todo lo capturado y el campo marcado; la moral extranjera entra sin RFC", async ({ page, context }) => {
    const errores = vigilarConsola(page);
    const [duna] = await consultar<{ id: string }>("select id from companies where rfc = $1", [DUNA.rfc]);
    const expediente = `/operacion/clientes/${duna!.id}/expediente`;
    const socios = () => contar("select 1 from kyb_accionistas where company_id = $1", [duna!.id]);
    type Otros = { rfc?: string; capital?: string; nombre?: string };
    const nombreDe = (tipo: "fisica" | "moral", otros: Otros) => otros.nombre ?? (tipo === "fisica" ? "John Smith Taylor" : "Delaware Holdings LLC");
    const capturar = async (tipo: "fisica" | "moral", documento: string, otros: Otros = {}) => {
      await page.goto(expediente);
      await page.locator("#acc-tipo").selectOption(tipo);
      await page.locator("#acc-nacionalidad").selectOption("extranjera");
      await page.locator("#acc-nombre").fill(nombreDe(tipo, otros));
      if (otros.rfc) await page.locator("#acc-rfc").fill(otros.rfc);
      await page.locator("#acc-pais").selectOption("US");
      await page.locator("#acc-documento").fill(documento);
      if (tipo === "fisica") await page.locator("#acc-nacimiento").fill("1980-05-01");
      await page.locator("#acc-capital").fill(otros.capital ?? "40");
      await page.locator("#acc-votos").fill("40");
      await page.getByRole("button", { name: "Agregar accionista" }).click();
    };
    // serv-N15: vuelve sin recargar, con todo lo capturado, y ningún dato del socio pasa por la dirección.
    const sigueCapturado = async (tipo: "fisica" | "moral", documento: string, otros: Otros = {}) => {
      await expect(page.locator("#acc-tipo")).toHaveValue(tipo);
      await expect(page.locator("#acc-nacionalidad")).toHaveValue("extranjera");
      await expect(page.locator("#acc-pais")).toHaveValue("US");
      await expect(page.locator("#acc-documento")).toHaveValue(documento);
      if (tipo === "fisica") await expect(page.locator("#acc-nacimiento")).toHaveValue("1980-05-01");
      await expect(page.locator("#acc-nombre")).toHaveValue(nombreDe(tipo, otros));
      await expect(page.locator("#acc-rfc")).toHaveValue(otros.rfc ?? "");
      await expect(page.locator("#acc-capital")).toHaveValue(otros.capital ?? "40");
      await expect(page.locator("#acc-votos")).toHaveValue("40");
      expect(new URL(page.url()).search).toBe("");
      expect(await socios()).toBe(0);
    };
    await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
    for (const tipo of ["fisica", "moral"] as const) {
      await capturar(tipo, "A1");
      await expect(page.locator("#aviso-accionista")).toContainText("de 4 a 20 letras y números");
      const campo = page.locator("#acc-documento");
      await expect(campo).toHaveAttribute("aria-invalid", "true");
      await expect(campo).toHaveAttribute("aria-describedby", "acc-documento-pista aviso-accionista-campo");
      await expect(campo).toBeFocused();
      await expect(page.locator('label[for="acc-documento"]')).toHaveText(
        tipo === "fisica" ? "Número de pasaporte o identificación oficial" : "Número de identificación fiscal o de registro en su país",
      );
      await sigueCapturado(tipo, "A1");
    }
    // serv-N15: los seis rechazos de la revisión (RFC «XX», nombre en blanco y capital «abc», en física y en
    // moral extranjera) vuelven con país, documento, fecha, nombre y porcentajes.
    for (const tipo of ["fisica", "moral"] as const) {
      for (const [otros, campo] of [
        [{ rfc: "XX" }, "#acc-rfc"],
        [{ nombre: "   " }, "#acc-nombre"],
        [{ capital: "abc" }, "#acc-capital"],
      ] as const) {
        await capturar(tipo, "12-3456789", otros);
        await expect(page.locator("#aviso-accionista")).toBeVisible();
        await expect(page.locator(campo)).toHaveAttribute("aria-invalid", "true");
        await expect(page.locator(campo)).toHaveAttribute("aria-describedby", "aviso-accionista-campo");
        await expect(page.locator(campo)).toBeFocused();
        await sigueCapturado(tipo, "12-3456789", otros);
      }
    }
    // El último rechazo (capital «abc» de la moral) se corrige en el mismo formulario y entra.
    await page.locator("#acc-capital").fill("40");
    await page.getByRole("button", { name: "Agregar accionista" }).click();
    await page.waitForURL(/aviso=expediente_accionista_agregado/);
    expect(await consultar("select rfc, pais, documento_extranjero, nacionalidad from kyb_accionistas where company_id = $1", [duna!.id])).toEqual([
      { rfc: null, pais: "US", documento_extranjero: "123456789", nacionalidad: "Estados Unidos" },
    ]);
    await expect(page.locator("#accionistas-titulo").locator("..")).toContainText("Estados Unidos · registro 123456789");
    await expect(page.locator("#aviso-accionista")).toHaveCount(0);
    await expect(page.locator("#acc-nombre")).toHaveValue("");
    expect(errores).toEqual([]);
  });

  // Una identidad con un carácter invisible (lo que deja copiar y pegar) se ve bien en pantalla: el aviso dice qué pasó,
  // marca el campo y le da el foco. Un nombre mal formado sin invisibles conserva el aviso de formato. El formulario
  // de representante, como el de socio, vuelve con lo capturado y sin datos personales en la dirección (P3).
  test("un nombre con un carácter invisible da su propio aviso; el formulario de representante conserva lo capturado", async ({ page, context }) => {
    const errores = vigilarConsola(page);
    const [duna] = await consultar<{ id: string }>("select id from companies where rfc = $1", [DUNA.rfc]);
    const expediente = `/operacion/clientes/${duna!.id}/expediente`;
    const socios = () => contar("select 1 from kyb_accionistas where company_id = $1", [duna!.id]);
    const representantes = () => contar("select 1 from kyb_representantes where company_id = $1", [duna!.id]);
    const INVISIBLE = "El nombre trae un carácter invisible, algo común al copiar y pegar. Escríbelo de nuevo a mano.";
    const FORMATO = "Revisa el campo marcado: el dato no tiene el formato esperado.";
    await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
    const [sociosAntes, representantesAntes] = [await socios(), await representantes()];

    // Socio persona física mexicana con «Juan\u0085Pérez López».
    await page.goto(expediente);
    for (const [nombre, aviso] of [["Juan\u0085Pérez López", INVISIBLE], ["Ana\u200bRuiz Sol", INVISIBLE], ["   ", FORMATO]] as const) {
      await page.locator("#acc-tipo").selectOption("fisica");
      await page.locator("#acc-nombre").fill(nombre);
      await page.locator("#acc-curp").fill("GORL750505MDFMZR04");
      await page.locator("#acc-capital").fill("10");
      await page.locator("#acc-votos").fill("10");
      await page.getByRole("button", { name: "Agregar accionista" }).click();
      await expect(page.locator("#aviso-accionista")).toHaveText(aviso);
      await expect(page.locator("#acc-nombre")).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator("#acc-nombre")).toHaveAttribute("aria-describedby", "aviso-accionista-campo");
      await expect(page.locator("#acc-nombre")).toBeFocused();
      await expect(page.locator("#acc-nombre")).toHaveValue(nombre);
      await expect(page.locator("#acc-curp")).toHaveValue("GORL750505MDFMZR04");
      expect(new URL(page.url()).search).toBe("");
    }
    expect(await socios()).toBe(sociosAntes);

    // Representante: el mismo aviso, y vuelve con todo lo capturado (antes recargaba la página y lo perdía).
    const capturado = { rfc: "RUSP800101AB1", curp: "RUSP800101HDFZLD09", cargo: "apoderado", pep: "no", designadoPor: "Asamblea del 3 de marzo" };
    await page.locator("#rep-nombre").fill("Pedro\u00adRuiz Sol");
    await page.locator("#rep-rfc").fill(capturado.rfc);
    await page.locator("#rep-curp").fill(capturado.curp);
    await page.locator("#rep-cargo").selectOption(capturado.cargo);
    await page.locator("#rep-pep").selectOption(capturado.pep);
    await page.locator("#rep-designado").fill(capturado.designadoPor);
    await page.locator('input[name="esAdministrador"]').check();
    const sigueCapturado = async (nombre: string, curp = capturado.curp) => {
      await expect(page.locator("#rep-nombre")).toHaveValue(nombre);
      await expect(page.locator("#rep-rfc")).toHaveValue(capturado.rfc);
      await expect(page.locator("#rep-curp")).toHaveValue(curp);
      await expect(page.locator("#rep-cargo")).toHaveValue(capturado.cargo);
      await expect(page.locator("#rep-pep")).toHaveValue(capturado.pep);
      await expect(page.locator("#rep-designado")).toHaveValue(capturado.designadoPor);
      await expect(page.locator('input[name="esAdministrador"]')).toBeChecked();
      expect(new URL(page.url()).search).toBe("");
      expect(await representantes()).toBe(representantesAntes);
    };
    await page.getByRole("button", { name: "Agregar representante" }).click();
    await expect(page.locator("#aviso-representante")).toHaveText(INVISIBLE);
    await expect(page.locator("#rep-nombre")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#rep-nombre")).toHaveAttribute("aria-describedby", "aviso-representante-campo");
    await expect(page.locator("#rep-nombre")).toBeFocused();
    await sigueCapturado("Pedro\u00adRuiz Sol");

    // Se corrige el nombre y falla la CURP: el aviso de formato marca la CURP y todo lo demás sigue ahí.
    await page.locator("#rep-nombre").fill("Pedro Ruiz Sol");
    await page.locator("#rep-curp").fill("XX");
    await page.getByRole("button", { name: "Agregar representante" }).click();
    await expect(page.locator("#aviso-representante")).toHaveText(FORMATO);
    await expect(page.locator("#rep-curp")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#rep-curp")).toBeFocused();
    await expect(page.locator("#rep-nombre")).not.toHaveAttribute("aria-invalid", "true");
    await sigueCapturado("Pedro Ruiz Sol", "XX");

    // Corregido en el mismo formulario, entra una sola vez.
    await page.locator("#rep-curp").fill(capturado.curp);
    await page.getByRole("button", { name: "Agregar representante" }).click();
    await page.waitForURL(/aviso=expediente_representante_agregado/);
    expect(await representantes()).toBe(representantesAntes + 1);
    expect(await consultar("select nombre, rfc, curp, cargo, es_administrador, designado_por from kyb_representantes where company_id = $1 and nombre = $2", [duna!.id, "Pedro Ruiz Sol"])).toEqual([
      { nombre: "Pedro Ruiz Sol", rfc: capturado.rfc, curp: capturado.curp, cargo: "apoderado", es_administrador: true, designado_por: capturado.designadoPor },
    ]);
    await expect(page.locator("#rep-nombre")).toHaveValue("");
    expect(errores).toEqual([]);
  });

  test("«Perdí el segundo factor»: Recuperaciones pide «Confirma que eres tú», otra persona aprueba y la clienta registra un factor nuevo", async ({ page, context }) => {
    const errores = vigilarConsola(page);
    const paula = await idDe(CORREOS.perdida);
    const op2 = await idDe(CORREOS.op2);
    const recuperaciones = () => contar("select 1 from auth_recuperaciones where user_id = $1", [paula]);
    const [totpViejo] = await consultar<{ id: string }>(
      "select id from auth_totp where user_id = $1 and confirmado_en is not null and revocado_en is null",
      [paula],
    );
    expect(totpViejo).toBeTruthy();
    expect(await recuperaciones()).toBe(0);

    // La clienta entra con su contraseña y, sin código, pide ayuda.
    await page.goto("/entrar");
    await page.getByLabel("Correo").fill(CORREOS.perdida);
    await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.waitForURL(/\/entrar\/continuar/);
    await page.getByRole("button", { name: "Perdí el segundo factor" }).click();
    await page.getByLabel("Qué pasó").fill("Perdí el teléfono con la app autenticadora.");
    const pedir = await dobleClic(page.getByRole("button", { name: "Pedir recuperación" }), { esperar: /\/entrar\?aviso=recuperacion/ });
    expect(pedir.envios).toBe(1);
    await expect(page.getByText("Tu solicitud quedó en revisión.")).toBeVisible();
    expect(await recuperaciones()).toBe(1);

    // En Operación, con el factor de hace 6 minutos, primero «Confirma que eres tú» (vale cinco).
    await context.clearCookies();
    await sesionDe(context, CORREOS.op2, { superficie: "sofipo", factorHaceMinutos: 6 });
    await page.goto("/operacion/recuperaciones");
    const solicitud = page.locator("li.decision").filter({ hasText: CORREOS.perdida });
    await expect(page.getByRole("heading", { name: "Confirma que eres tú" })).toBeVisible();
    await solicitud.getByLabel("Cómo verificaste la identidad").selectOption("videollamada");
    await solicitud.getByRole("button", { name: "Aprobar" }).click();
    // El aviso vuelve a la tarjeta (doceava); el de respaldo de arriba (formulario que ya no se pinta) queda oculto.
    await expect(solicitud.getByText("Confirma que eres tú con tu segundo factor antes de decidir. Vale cinco minutos.")).toBeVisible();
    await expect(page.locator("#aviso-rechazo")).toBeHidden();
    const [sinDecidir] = await consultar<{ estado: string }>("select estado from auth_recuperaciones where user_id = $1", [paula]);
    expect(sinDecidir!.estado).toBe("solicitada");

    await page.locator("#confirmar-codigo").fill(await codigoTotp(CORREOS.op2));
    await page.getByRole("button", { name: "Confirmar con el código" }).click();
    await expect(page.getByRole("heading", { name: "Confirma que eres tú" })).toHaveCount(0);
    await solicitud.getByLabel("Cómo verificaste la identidad").selectOption("videollamada");
    const aprobar = await dobleClic(solicitud.getByRole("button", { name: "Aprobar" }), { esperar: /aviso=decision_registrada/ });
    expect(aprobar.envios).toBe(1);
    const [aprobada] = await consultar<{ estado: string; resuelta_por: string; verificacion: string }>(
      "select estado, resuelta_por, verificacion from auth_recuperaciones where user_id = $1",
      [paula],
    );
    expect(aprobada).toEqual({ estado: "aprobada", resuelta_por: op2, verificacion: "videollamada" });

    // La clienta vuelve a entrar y registra un factor nuevo; el viejo deja de servir.
    await context.clearCookies();
    await page.goto("/entrar");
    await page.getByLabel("Correo").fill(CORREOS.perdida);
    await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.waitForURL(/\/entrar\/continuar/);
    await expect(page.getByRole("heading", { name: "Registra un factor nuevo." })).toBeVisible();
    const semilla = (await page.locator(".arco-semilla").innerText()).trim();
    await page.getByLabel("Código que muestra la app").fill(codigoDeSemilla(semilla));
    const confirmar = await dobleClic(page.getByRole("button", { name: "Confirmar el código" }));
    expect(confirmar.envios).toBe(1);
    await page.getByRole("checkbox", { name: "Ya los guardé en un lugar seguro" }).check();
    await page.getByRole("button", { name: "Entrar al portal" }).click();
    await expect(page.getByRole("navigation", { name: "Secciones" })).toBeVisible();
    expect(await contar("select 1 from auth_totp where id = $1 and revocado_en is not null", [totpViejo!.id])).toBe(1);
    expect(await contar("select 1 from auth_totp where user_id = $1 and confirmado_en is not null and revocado_en is null", [paula])).toBe(1);
    expect(await contar("select 1 from auth_recuperaciones where user_id = $1 and cumplida_en is not null", [paula])).toBe(1);
    expect(errores).toEqual([]);
  });

  // base-N27: con varias solicitudes pendientes, el error de una marca y enfoca solo su tarjeta. Antes la página marcaba
  // el campo en todas, y con el foco del aviso las tres notas pedían el foco.
  test("el mensaje del error queda a la vista junto al campo con foco: un documento y un socio del expediente y el motivo de una reactivación, a 1440 y 390", async ({ page, context }) => {
    const errores = vigilarConsola(page);
    await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
    for (const ancho of [1440, 390]) await errorDeDocumentoYDeSocio(page, ancho);
    expect(errores).toEqual([]);
  });

  test("con tres recuperaciones pendientes, el rechazo sin nota marca y enfoca solo la nota de esa tarjeta", async ({ page, context }) => {
    const errores = vigilarConsola(page);
    const personas = [CORREOS.diego, CORREOS.sol, CORREOS.ernesto];
    const ids = await recuperacionesPendientes(personas);
    await sesionDe(context, CORREOS.op2, { superficie: "sofipo" });
    await page.goto("/operacion/recuperaciones");
    const tarjeta = (correo: string) => page.locator("li.decision").filter({ hasText: correo });
    const nota = (indice: number) => page.locator(`[id="nota-${ids[indice]}"]`);
    for (const correo of personas) await expect(tarjeta(correo)).toBeVisible();

    // Doceava: el aviso vuelve a esa tarjeta, con el método elegido; la dirección no cambia.
    await page.locator(`[id="verificacion-${ids[1]}"]`).selectOption("videollamada");
    await nota(1).fill("   ");
    await rechazado(page, tarjeta(CORREOS.sol).getByRole("button", { name: "Rechazar" }), `aviso-recuperacion-${ids[1]}`);
    await expect(nota(1)).toHaveAttribute("aria-invalid", "true");
    await expect(nota(1)).toHaveAttribute("aria-describedby", `aviso-recuperacion-${ids[1]}-campo`);
    await expect(nota(1)).toBeFocused();
    await expect(page.locator('[aria-invalid="true"]')).toHaveCount(1);
    for (const indice of [0, 2]) await expect(nota(indice)).not.toHaveAttribute("aria-invalid", "true");
    await mensajeJunto(page, `[id="nota-${ids[1]}"]`, "Escribe un motivo breve y claro.", `aviso-recuperacion-${ids[1]}-campo`);
    await expect(page.locator(`[id="verificacion-${ids[1]}"]`)).toHaveValue("videollamada");
    // El resumen de un aviso de campo no es región viva: el campo con el foco ya lo lee como su descripción.
    await expect(page.locator(`[id="aviso-recuperacion-${ids[1]}"] .alerta`)).not.toHaveAttribute("role", /./);

    // Con su nota, cada una se rechaza; ninguna queda abierta para las demás pruebas.
    for (const [indice, correo] of personas.entries()) {
      await nota(indice).fill("No se pudo confirmar la identidad por videollamada.");
      await tarjeta(correo).getByRole("button", { name: "Rechazar" }).click();
      await expect(tarjeta(correo)).toHaveCount(0);
    }
    expect(await contar("select 1 from auth_recuperaciones where id = any($1::uuid[]) and estado = 'rechazada'", [ids])).toBe(3);
    expect(errores).toEqual([]);
  });

  test("una clave repetida en la dirección (?aviso=a&aviso=b) no tumba ninguna página de Operación", async ({ page, context }) => {
    const errores = vigilarConsola(page);
    const [brisa] = await consultar<{ id: string }>("select id from companies where rfc = $1", [BRISA.rfc]);
    const paginas = [
      "/operacion/alertas", "/operacion/aprobaciones", "/operacion/clientes", `/operacion/clientes/${brisa!.id}`,
      `/operacion/clientes/${brisa!.id}/expediente`, "/operacion/comisiones", "/operacion/cumplimiento", "/operacion/lpb",
      "/operacion/personal", "/operacion/recuperaciones",
    ];
    const abrir = async (ruta: string) => {
      const respuesta = await page.goto(ruta);
      expect(respuesta?.status(), ruta).toBe(200);
      await expect(page.locator("h1"), ruta).toBeVisible();
    };
    // Aprobación (con Administración) y Cumplimiento: entre las dos abren todas, cada una con su permiso.
    for (const correo of [CORREOS.op2, CORREOS.op3]) {
      await sesionDe(context, correo, { superficie: "sofipo" });
      for (const ruta of paginas) await abrir(`${ruta}?aviso=a&aviso=b&en=x&en=y`);
    }
    // El detalle de lo que falta con `faltan` repetido: queda el aviso general, sin detalle.
    await abrir(`/operacion/clientes/${brisa!.id}/expediente?aviso=expediente_datos_incompletos&faltan=giro&faltan=domicilio`);
    await expect(page.locator("#aviso-operacion")).toHaveText("Faltan datos generales para enviar la versión. Revisa «Datos generales».");
    // La Lista con su detalle repetido y la entrada sin sesión.
    await abrir("/operacion/lpb?aviso=lpb_cargada&filas=1&filas=2&coincidencias=0");
    await context.clearCookies();
    await abrir("/operacion/entrar?aviso=a&aviso=b");
    expect(errores).toEqual([]);
  });

  test.describe("sin JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    // serv-nuevo-7: con Referrer-Policy: no-referrer, el envío nativo de un formulario lleva «Origin: null» y Next
    // rechaza la acción con un 500. Pasa sin JavaScript y al hacer clic antes de que la página hidrate.
    test("sin JavaScript los formularios responden: el alta vuelve con su aviso y lo capturado (200) y las dos entradas dan el suyo", async ({ page, context }) => {
      const post = () => page.waitForResponse((respuesta) => respuesta.request().method() === "POST");
      await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
      await page.goto("/operacion/clientes");
      await page.getByLabel("Razón social").fill("Sin Script\u0085Uno SA de CV");
      await page.getByLabel("RFC").fill("SSU010101AB1");
      await page.getByLabel("Código postal").fill("06600");
      const [alta] = await Promise.all([post(), page.getByRole("button", { name: "Registrar prospecto" }).click()]);
      // La causa: con «no-referrer» el navegador manda «Origin: null» en el envío nativo del formulario.
      expect(await alta.request().headerValue("origin")).toBe(new URL(alta.url()).origin);
      // Doceava: el rechazo responde con la página (200) en la misma dirección, el aviso en el formulario y lo capturado.
      expect(alta.status()).toBe(200);
      expect(page.url()).not.toContain("aviso=");
      await expect(page.locator("#aviso-prospecto")).toContainText("La razón social trae un carácter invisible");
      await expect(page.getByLabel("RFC")).toHaveValue("SSU010101AB1");
      await expect(page.getByLabel("Código postal")).toHaveValue("06600");
      await mensajeJunto(page, "#razonSocial", "La razón social trae un carácter invisible, algo común al copiar y pegar. Escríbela de nuevo a mano.", "aviso-prospecto-campo");
      expect(await contar("select 1 from companies where rfc = $1", ["SSU010101AB1"])).toBe(0);

      // La entrada de Operación y la del portal del cliente, sin sesión: la contraseña equivocada da su aviso ahí mismo.
      await context.clearCookies();
      for (const ruta of ["/operacion/entrar", "/entrar"]) {
        await page.goto(ruta);
        await page.getByLabel("Correo").fill("nadie-sin-script@lever-e2e.mx");
        await page.getByLabel("Contraseña", { exact: true }).fill("no-es-la-clave-1");
        const [entrada] = await Promise.all([post(), page.getByRole("button", { name: "Continuar" }).click()]);
        expect(await entrada.request().headerValue("origin"), ruta).toBe(new URL(entrada.url()).origin);
        expect(entrada.status(), ruta).toBe(200);
        await expect(page.locator("#entrar-error"), ruta).toContainText("El correo o la contraseña no coinciden.");
      }
    });

    // Décima revisión: el aviso de un campo volvía con «#datos-titulo» y, al cargar la página completa, el navegador
    // descarta el autofocus cuando hay fragmento. Sin fragmento, el campo queda marcado y con el foco.
    test("sin JavaScript, el mensaje del error queda a la vista junto al campo con foco: documento, socio, motivo de reactivación y la nota de una recuperación, a 1440 y 390", async ({ page, context }) => {
      await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
      for (const ancho of [1440, 390]) await errorDeDocumentoYDeSocio(page, ancho, true);

      // La tercera de tres tarjetas de Recuperaciones, a 390: la nota queda lejos del aviso de arriba.
      const personas = [CORREOS.diego, CORREOS.sol, CORREOS.ernesto];
      const ids = await recuperacionesPendientes(personas);
      await context.clearCookies();
      await sesionDe(context, CORREOS.op2, { superficie: "sofipo" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/operacion/recuperaciones");
      const tarjeta = (correo: string) => page.locator("li.decision").filter({ hasText: correo });
      await page.locator(`[id="verificacion-${ids[2]}"]`).selectOption("presencial");
      await rechazado(page, tarjeta(CORREOS.ernesto).getByRole("button", { name: "Rechazar" }), `aviso-recuperacion-${ids[2]}`, true);
      await mensajeJunto(page, `[id="nota-${ids[2]}"]`, "Escribe un motivo breve y claro.", `aviso-recuperacion-${ids[2]}-campo`);
      await expect(page.locator(`[id="verificacion-${ids[2]}"]`)).toHaveValue("presencial");
      // Con su nota, cada una se rechaza; ninguna queda abierta para las demás pruebas.
      for (const [indice, correo] of personas.entries()) {
        await page.locator(`[id="nota-${ids[indice]}"]`).fill("No se pudo confirmar la identidad por videollamada.");
        await tarjeta(correo).getByRole("button", { name: "Rechazar" }).click();
        await expect(tarjeta(correo)).toHaveCount(0);
      }
      expect(await contar("select 1 from auth_recuperaciones where id = any($1::uuid[]) and estado = 'rechazada'", [ids])).toBe(3);
    });

    // P2 del revisor de pantalla: con una clave nueva en cada vista, React tiraba el estado que devuelve la acción y el
    // formulario volvía en blanco (200, sin aviso, sin marca y sin lo capturado). Pasa también con un clic antes de hidratar.
    test("sin JavaScript, «Agregar representante» y «Agregar accionista» con un invisible vuelven con su aviso, el campo marcado, el foco y lo capturado", async ({ page, context }) => {
      const [duna] = await consultar<{ id: string }>("select id from companies where rfc = $1", [DUNA.rfc]);
      const representantes = () => contar("select 1 from kyb_representantes where company_id = $1", [duna!.id]);
      const socios = () => contar("select 1 from kyb_accionistas where company_id = $1", [duna!.id]);
      const [representantesAntes, sociosAntes] = [await representantes(), await socios()];
      const INVISIBLE = "El nombre trae un carácter invisible, algo común al copiar y pegar. Escríbelo de nuevo a mano.";
      await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
      await page.goto(`/operacion/clientes/${duna!.id}/expediente`);

      const capturado = { rfc: "RUSP800101AB1", curp: "RUSP800101HDFZLD09", cargo: "apoderado", pep: "no", designadoPor: "Asamblea del 3 de marzo" };
      await page.locator("#rep-nombre").fill("Pedro\u200bRuiz Sol");
      await page.locator("#rep-rfc").fill(capturado.rfc);
      await page.locator("#rep-curp").fill(capturado.curp);
      await page.locator("#rep-cargo").selectOption(capturado.cargo);
      await page.locator("#rep-pep").selectOption(capturado.pep);
      await page.locator("#rep-designado").fill(capturado.designadoPor);
      await page.locator('input[name="esAdministrador"]').check();
      const [representante] = await Promise.all([
        page.waitForResponse((respuesta) => respuesta.request().method() === "POST"),
        page.getByRole("button", { name: "Agregar representante" }).click(),
      ]);
      expect(representante.status()).toBe(200);
      await expect(page.locator("#aviso-representante")).toHaveText(INVISIBLE);
      await expect(page.locator("#rep-nombre")).toHaveAttribute("aria-invalid", "true");
      await mensajeJunto(page, "#rep-nombre", INVISIBLE, "aviso-representante-campo");
      await expect(page.locator("#rep-nombre")).toHaveValue("Pedro\u200bRuiz Sol");
      await expect(page.locator("#rep-rfc")).toHaveValue(capturado.rfc);
      await expect(page.locator("#rep-curp")).toHaveValue(capturado.curp);
      await expect(page.locator("#rep-cargo")).toHaveValue(capturado.cargo);
      await expect(page.locator("#rep-designado")).toHaveValue(capturado.designadoPor);
      await expect(page.locator('input[name="esAdministrador"]')).toBeChecked();

      await page.goto(`/operacion/clientes/${duna!.id}/expediente`);
      await page.locator("#acc-tipo").selectOption("fisica");
      await page.locator("#acc-nombre").fill("Ana\u200bRuiz Sol");
      await page.locator("#acc-curp").fill("GORL750505MDFMZR04");
      await page.locator("#acc-capital").fill("10");
      await page.locator("#acc-votos").fill("15");
      await page.getByRole("button", { name: "Agregar accionista" }).click();
      await expect(page.locator("#aviso-accionista")).toHaveText(INVISIBLE);
      await mensajeJunto(page, "#acc-nombre", INVISIBLE, "aviso-accionista-campo");
      await expect(page.locator("#acc-nombre")).toHaveValue("Ana\u200bRuiz Sol");
      await expect(page.locator("#acc-curp")).toHaveValue("GORL750505MDFMZR04");
      await expect(page.locator("#acc-capital")).toHaveValue("10");
      await expect(page.locator("#acc-votos")).toHaveValue("15");
      expect([await representantes(), await socios()]).toEqual([representantesAntes, sociosAntes]);
    });

    test("sin JavaScript, el rechazo de un campo del expediente vuelve con lo capturado, sin fragmento y con el foco en el campo", async ({ page, context }) => {
      const [duna] = await consultar<{ id: string }>("select id from companies where rfc = $1", [DUNA.rfc]);
      const datos = () => consultar("select razon_social, giro from kyb_versiones where company_id = $1 and estado = 'borrador'", [duna!.id]);
      const antes = await datos();
      await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
      await page.goto(`/operacion/clientes/${duna!.id}/expediente`);
      await page.locator("#dato-razonSocial").fill("Duna\u200bComercial SA de CV");
      await page.locator("#dato-giro").fill("Distribución de abarrotes al mayoreo");
      await rechazado(page, page.getByRole("button", { name: "Guardar datos" }), "aviso-datos", true);
      const campo = page.locator("#dato-razonSocial");
      await expect(campo).toHaveAttribute("aria-invalid", "true");
      await expect(campo).toHaveAttribute("aria-describedby", "aviso-datos-campo");
      await expect(page.locator("#dato-razonSocial:focus")).toHaveCount(1);
      expect(new URL(page.url()).hash).toBe("");
      // Vuelve lo escrito en los dos campos, no lo guardado.
      await expect(campo).toHaveValue("Duna\u200bComercial SA de CV");
      await expect(page.locator("#dato-giro")).toHaveValue("Distribución de abarrotes al mayoreo");
      expect(await datos()).toEqual(antes);
      // El foco desplazó la página: sin JavaScript nadie marca la barra superior, que lleva su fondo para no encimarse.
      await expect(page.locator(".barra-superior")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    });
  });

  test("publicar el precio exige factor de los últimos 30 minutos; tras volver a entrar, doble clic publica una vez", async ({ page, context }) => {
    const errores = vigilarConsola(page);
    const precio = async () => (await consultar<{ centavos: string | null }>("select suscripcion_centavos::text as centavos from platform_pricing where singleton"))[0]?.centavos ?? null;
    const publicaciones = () => contar("select 1 from audit_log where accion = 'publicar_precio'");
    expect(await precio()).toBeNull();
    const antes = await publicaciones();

    await sesionDe(context, CORREOS.op1, { superficie: "sofipo", factorHaceMinutos: 31 });
    await page.goto("/operacion/precios");
    await page.getByLabel("Suscripción mensual, en pesos").fill("1499.00");
    await page.getByRole("button", { name: "Publicar el monto" }).click();
    await expect(page.getByText("Publicar exige un segundo factor verificado en los últimos 30 minutos. Sal y vuelve a entrar por la puerta de operación.")).toBeVisible();
    expect(await precio()).toBeNull();
    expect(await publicaciones()).toBe(antes);

    await salirDeOperacion(page);
    await entrarAOperacion(page, CORREOS.op1);
    await page.goto("/operacion/precios");
    await page.getByLabel("Suscripción mensual, en pesos").fill("1499.00");
    const publicar = await dobleClic(page.getByRole("button", { name: "Publicar el monto" }), { esperar: /\/operacion\/precios$/ });
    expect(publicar.envios).toBe(1);
    await expect(page.getByLabel("Suscripción mensual, en pesos")).toHaveCount(0);
    await expect(page.getByText("1,499.00").first()).toBeVisible();
    expect(await precio()).toBe("149900");
    expect(await publicaciones()).toBe(antes + 1);
    expect(errores).toEqual([]);
  });

  test("la descarga del expediente llega aislada (sandbox) y la pantalla del expediente conserva la política general", async ({ page, context }) => {
    const [faro] = await consultar<{ id: string }>("select id from companies where rfc = $1", [FARO.rfc]);
    await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
    // Un documento que no es de la empresa: 404 sin evento, pero la política de next.config ya aplica a la ruta.
    const descargas = () => contar("select 1 from audit_log where company_id = $1 and accion = 'expediente_documento_descargado'", [faro!.id]);
    const antes = await descargas();
    const descarga = await page.request.get(`/operacion/clientes/${faro!.id}/expediente/documento/${crypto.randomUUID()}`);
    expect(descarga.status()).toBe(404);
    expect(descarga.headers()["content-security-policy"]).toBe("sandbox; default-src 'none'; frame-ancestors 'none'");
    expect(await descargas()).toBe(antes);
    const pantalla = await page.request.get(`/operacion/clientes/${faro!.id}/expediente`);
    expect(pantalla.status()).toBe(200);
    expect(pantalla.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
    // Humo-N6 del preview: la política de permisos va en todas las respuestas, también en la descarga y fuera de Operación.
    const permisos =
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), display-capture=(), publickey-credentials-get=(self), publickey-credentials-create=(self)";
    const inicio = await page.request.get("/");
    for (const [donde, respuesta] of [["pantalla", pantalla], ["descarga", descarga], ["inicio", inicio]] as const) {
      expect(respuesta.headers()["permissions-policy"], donde).toBe(permisos);
      expect(respuesta.headers()["referrer-policy"], donde).toBe("same-origin");
    }
  });

  test("doceava: prospecto, invitación, comisión y alertas vuelven con lo capturado y su campo marcado; el resumen de arriba no se queda", async ({ page, context }) => {
    const errores = vigilarConsola(page);
    await formulariosConCaptura(page, context, false);
    expect(errores).toEqual([]);
  });

  test("doceava: la suspensión de Faro no consume el formulario al rechazarse, el doble clic pide una sola y la otra pestaña ve «ya hay una pendiente» sin recargar", async ({ page, context, browser }) => {
    const errores = vigilarConsola(page);
    await suspensionUnaVez(page, context, browser, FARO.rfc, "Pedir suspensión", false);
    expect(errores).toEqual([]);
  });

  test.describe("doceava sin JavaScript, con Faro activa", () => {
    test.use({ javaScriptEnabled: false });

    test("sin JavaScript, invitación, comisión y alertas vuelven con lo capturado y el resumen del envío anterior no se pinta", async ({ page, context }) => {
      await formulariosConCaptura(page, context, true);
    });
  });
});

// ---------- Doceava revisión: los formularios de Operación vuelven con lo capturado tras un rechazo ----------

const empresaDe = async (rfc: string) => (await consultar<{ id: string }>("select id from companies where rfc = $1", [rfc]))[0]!.id;
const conId = (tabla: string, id: string) => contar(`select 1 from ${tabla} where id = $1`, [id]);

/**
 * Reintenta con el mismo identificador de formulario del envío rechazado (el rechazo no lo consumió) y con doble clic:
 * con JavaScript, la página vuelve con otro identificador y el envío lo cambia por el del rechazo; sin JavaScript, los
 * dos POST del doble clic llevan el mismo.
 */
async function reintentarConDobleClic(page: Page, boton: Locator, formulario: string, formId: string, esperar: RegExp, sinJs: boolean): Promise<void> {
  const actual = await formIdDe(page, formulario);
  const mismo = await alterarEnvio(page, (cuerpo) => cuerpo.split(actual).join(formId));
  if (sinJs) {
    await boton.dblclick();
    await page.waitForURL(esperar);
  } else {
    await dobleClic(boton, { esperar });
  }
  await mismo.soltar();
}

/**
 * El dictamen y el grado de riesgo al alta de una versión enviada por Originación: Cumplimiento observa con un motivo
 * de 9 caracteres (vuelven el resultado y el motivo), el reintento con el mismo formulario y doble clic deja un solo
 * dictamen; después, ningún nivel del riesgo arranca elegido, un nivel armado a mano vuelve sin elegir (nunca «baja»)
 * con la zona elegida, y el reintento deja una sola calificación con lo elegido.
 */
async function dictamenYRiesgo(page: Page, context: BrowserContext, rfc: string, sinJs: boolean): Promise<void> {
  const companyId = await empresaDe(rfc);
  const [{ id: versionId }] = await consultar<{ id: string }>("select id from kyb_versiones where company_id = $1 and estado = 'enviada'", [companyId]);
  const dictamenes = () => contar("select 1 from kyb_dictamenes where version_id = $1", [versionId!]);
  await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
  await page.setViewportSize({ width: sinJs ? 390 : 1440, height: sinJs ? 844 : 900 });
  await page.goto(`/operacion/clientes/${companyId}/expediente`);

  const dictamen = "form:has(#dictamen-resultado)";
  const registrar = page.getByRole("button", { name: "Registrar dictamen" });
  const primero = await formIdDe(page, dictamen);
  await page.locator("#dictamen-resultado").selectOption("observado");
  await page.locator("#dictamen-motivo").fill("Revisar 😀");
  await rechazado(page, registrar, "aviso-dictamen", sinJs);
  await mensajeJunto(page, "#dictamen-motivo", MOTIVO_CORTO, "aviso-dictamen-campo");
  await expect(page.locator("#dictamen-resultado")).toHaveValue("observado");
  await expect(page.locator("#dictamen-motivo")).toHaveValue("Revisar 😀");
  expect([await dictamenes(), await conId("kyb_dictamenes", primero)]).toEqual([0, 0]);
  await page.locator("#dictamen-resultado").selectOption("aprobado");
  await page.locator("#dictamen-motivo").fill("Expediente completo y vigente.");
  await reintentarConDobleClic(page, registrar, dictamen, primero, /aviso=expediente_dictaminado/, sinJs);
  expect([await dictamenes(), await conId("kyb_dictamenes", primero)]).toEqual([1, 1]);

  const riesgo = "form:has(#riesgo-actividad)";
  const calificaciones = () => contar("select 1 from kyb_calificaciones_riesgo where company_id = $1", [companyId]);
  const calificar = page.getByRole("button", { name: "Registrar grado al alta" });
  await expect(page.locator("#riesgo-actividad")).toHaveValue("");
  await expect(page.locator("#riesgo-zona")).toHaveValue("");
  // Sin elegir, el navegador no envía (también sin JavaScript): nada queda como «baja» sin haberlo elegido.
  let envios = 0;
  const contarEnvio = (peticion: { method(): string }) => { if (peticion.method() === "POST") envios += 1; };
  page.on("request", contarEnvio);
  await calificar.click();
  await page.waitForTimeout(700);
  page.off("request", contarEnvio);
  expect(envios).toBe(0);
  await expect(page.locator("#riesgo-actividad:invalid")).toHaveCount(1);
  expect(await calificaciones()).toBe(0);

  await page.locator("#riesgo-actividad").selectOption("media");
  await page.locator("#riesgo-zona").selectOption("alta");
  const formRiesgo = await formIdDe(page, riesgo);
  const armado = await alterarEnvio(page, (cuerpo) => cuerpo.replace(/(name="[^"]*actividad"\r\n\r\n)media/, "$1MEDIA"));
  await rechazado(page, calificar, "aviso-riesgo", sinJs);
  await armado.soltar();
  expect(armado.vistos()).toBe(1);
  await mensajeJunto(page, "#riesgo-actividad", FORMATO, "aviso-riesgo-campo");
  await expect(page.locator("#riesgo-actividad")).toHaveValue("");
  await expect(page.locator("#riesgo-zona")).toHaveValue("alta");
  expect([await calificaciones(), await conId("kyb_calificaciones_riesgo", formRiesgo)]).toEqual([0, 0]);
  await page.locator("#riesgo-actividad").selectOption("media");
  await reintentarConDobleClic(page, calificar, riesgo, formRiesgo, /aviso=riesgo_calificado/, sinJs);
  expect(await calificaciones()).toBe(1);
  expect(await consultar("select factores->'actividad'->>'valor' as actividad, factores->'zona'->>'valor' as zona from kyb_calificaciones_riesgo where id = $1", [formRiesgo])).toEqual([
    { actividad: "media", zona: "alta" },
  ]);
}

/** La coincidencia pendiente de una empresa de la siembra (Brisa o Cima), o la ya confirmada sin folio. */
const coincidenciaDe = async (rfc: string, estado: "pendiente" | "confirmada") =>
  (await consultar<{ id: string }>(
    "select k.id from lpb_coincidencias k join companies c on c.id = k.company_id where c.rfc = $1 and k.estado = $2 and k.sujeto_tipo = 'empresa'",
    [rfc, estado],
  ))[0]!.id;

/**
 * Invitación, comisión y alerta con lo capturado de vuelta y su campo marcado (y, con JavaScript, el alta de un
 * prospecto); el resumen de arriba (el aviso del envío anterior) no se queda junto al aviso del formulario rechazado, y
 * en la página hay un solo campo marcado.
 */
async function formulariosConCaptura(page: Page, context: BrowserContext, sinJs: boolean): Promise<void> {
  const faro = await empresaDe(FARO.rfc);
  await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
  await page.setViewportSize({ width: 1440, height: 900 });

  // Alta de prospecto, con y sin JavaScript. Humo del preview (N4): un RFC sin la forma de un RFC marcaba el RFC y vaciaba
  // razón social, RFC y código postal. Ahora vuelven los cinco datos, con ese RFC y con el genérico.
  await page.goto("/operacion/clientes");
  const prospecto = `Puerto Sur E2E ${sinJs ? "sin" : "con"} JavaScript`;
  await page.getByLabel("Razón social").fill(prospecto);
  await page.getByLabel("Código postal").fill("64000");
  await page.getByLabel("Régimen fiscal").selectOption("612");
  await page.getByLabel("Uso CFDI").selectOption("S01");
  for (const [rfc, texto] of [
    ["1234567890AB", "Ese RFC no tiene la forma de un RFC: 12 caracteres si es persona moral o 13 si es física."],
    ["XAXX010101000", "Ese es un RFC genérico (público en general o extranjero). Escribe el RFC de la empresa."],
  ] as const) {
    await page.getByLabel("RFC").fill(rfc);
    await rechazado(page, page.getByRole("button", { name: "Registrar prospecto" }), "aviso-prospecto", sinJs);
    await mensajeJunto(page, "#rfc", texto, "aviso-prospecto-campo");
    for (const [campo, valor] of [["#razonSocial", prospecto], ["#rfc", rfc], ["#codigoPostal", "64000"], ["#regimen", "612"], ["#usoCfdi", "S01"]]) {
      await expect(page.locator(campo), `${campo} tras ${rfc}`).toHaveValue(valor);
    }
  }
  expect(await contar("select 1 from companies where razon_social = $1", [prospecto])).toBe(0);

  // Invitación del primer administrador de Faro: «laura@ejemplo» pasa `type=email`; el servidor marca el correo con su
  // mensaje (antes, `invitacion_invalida` no era de ningún campo; humo-N3 del preview).
  const invitaciones = () => contar("select 1 from invitations where company_id = $1", [faro]);
  const invitacionesAntes = await invitaciones();
  await page.goto(`/operacion/clientes/${faro}`);
  await page.locator("#nombre").fill("Ana Ruiz Sol");
  await page.locator("#correo").fill("laura@ejemplo");
  await rechazado(page, page.getByRole("button", { name: /Enviar invitación|Reenviar invitación/ }), "aviso-invitacion", sinJs);
  await mensajeJunto(page, "#correo", "Escribe un correo válido, como nombre@empresa.mx.", "aviso-invitacion-campo");
  await expect(page.locator("#nombre")).toHaveValue("Ana Ruiz Sol");
  await expect(page.locator("#correo")).toHaveValue("laura@ejemplo");
  expect(await invitaciones()).toBe(invitacionesAntes);

  // Comisión: «Fondeo» con 20000 puntos base. El valor queda marcado, con el foco y su mensaje (revisor del servidor).
  const comisiones = () => contar("select 1 from company_commissions where company_id = $1", [faro]);
  const comisionesAntes = await comisiones();
  const manana = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await page.goto("/operacion/comisiones");
  await page.locator("#companyId").selectOption(faro);
  await page.locator("#tipo").selectOption("fondeo");
  await page.locator("#valor").fill("20000");
  await page.locator("#vigenteDesde").fill(manana);
  await rechazado(page, page.getByRole("button", { name: "Pedir autorización" }), "aviso-comision", sinJs);
  await mensajeJunto(page, "#valor", "Escribe un número entero: puntos base para fondeo o centavos para SPEI.", "aviso-comision-campo");
  await expect(page.locator("#valor")).toHaveAttribute("aria-describedby", "aviso-comision-campo valor-pista");
  for (const [campo, valor] of [["#companyId", faro], ["#tipo", "fondeo"], ["#valor", "20000"], ["#vigenteDesde", manana]]) await expect(page.locator(campo!), campo).toHaveValue(valor!);
  expect(await comisiones()).toBe(comisionesAntes);

  // Alerta: un título de puros espacios (el navegador lo deja pasar) marca el título; vuelven la empresa y el detalle.
  const alertas = () => contar("select 1 from operational_alerts where company_id = $1", [faro]);
  const alertasAntes = await alertas();
  await page.goto("/operacion/alertas");
  await page.locator("#companyId").selectOption(faro);
  await page.locator("#titulo").fill("   ");
  await page.locator("#detalle").fill("Revisar el contrato firmado.");
  const crear = page.getByRole("button", { name: "Crear alerta" });
  await rechazado(page, crear, "aviso-alerta", sinJs);
  await mensajeJunto(page, "#titulo", FORMATO, "aviso-alerta-campo");
  await expect(page.locator("#companyId")).toHaveValue(faro);
  await expect(page.locator("#detalle")).toHaveValue("Revisar el contrato firmado.");
  expect(await alertas()).toBe(alertasAntes);

  // Una alerta que sí se crea deja su aviso arriba; cerrarla con un motivo de puros espacios la marca en su tarjeta, y el
  // resumen de arriba ya no aplica: no se queda junto al aviso del formulario.
  const titulo = `Revisar contrato E2E ${sinJs ? "sin JavaScript" : "con JavaScript"}`;
  await page.locator("#titulo").fill(titulo);
  await crear.click();
  await page.waitForURL(/aviso=alerta_creada/);
  await expect(page.locator("#aviso-operacion")).toHaveText("Alerta creada con su responsable.");
  const [{ id: alerta }] = await consultar<{ id: string }>("select id from operational_alerts where titulo = $1", [titulo]);
  await page.locator(`[id="motivo-${alerta}"]`).fill("   ");
  await rechazado(page, page.locator(`form:has([id="motivo-${alerta}"])`).getByRole("button", { name: "Cerrar alerta" }), `aviso-cierre-${alerta}`, sinJs);
  await mensajeJunto(page, `[id="motivo-${alerta}"]`, "Escribe un motivo breve y claro.", `aviso-cierre-${alerta}-campo`);
  await expect(page.locator("#aviso-operacion")).toHaveCount(0);
  // Accesibilidad: el resumen de un aviso de campo no es región viva (el foco en el campo ya lo anuncia).
  await expect(page.locator(`[id="aviso-cierre-${alerta}"] .alerta`)).not.toHaveAttribute("role", /./);
  // Otro rechazo en otro formulario de la página: el aviso de la tarjeta se descarta y queda un solo campo marcado.
  // (Tras crear la alerta, el formulario empezó en blanco.)
  await page.locator("#titulo").fill("   ");
  await page.locator("#detalle").fill("Revisar el contrato firmado.");
  await rechazado(page, crear, "aviso-alerta", sinJs);
  await expect(page.locator(`[id="aviso-cierre-${alerta}"]`)).toHaveCount(0);
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(1);
  await expect(page.locator("#titulo")).toHaveAttribute("aria-invalid", "true");
  // Se cierra con su motivo: ninguna queda abierta para las demás pruebas.
  await page.locator(`[id="motivo-${alerta}"]`).fill("Contrato revisado y firmado.");
  await page.locator(`form:has([id="motivo-${alerta}"])`).getByRole("button", { name: "Cerrar alerta" }).click();
  await page.waitForURL(/aviso=alerta_cerrada/);
}

/**
 * Pedir la suspensión (o la reactivación): un motivo de 9 caracteres vuelve y no consume el formulario; el reintento con
 * doble clic deja una sola solicitud. Otra persona tenía la ficha abierta desde antes: su envío vuelve con «ya hay una
 * pendiente» y la página, sin recargar, muestra la nota en lugar del formulario.
 */
async function suspensionUnaVez(page: Page, context: BrowserContext, browser: Browser, rfc: string, boton: string, sinJs: boolean): Promise<void> {
  const companyId = await empresaDe(rfc);
  const solicitudes = () => contar("select 1 from company_suspensions where company_id = $1", [companyId]);
  const antes = await solicitudes();
  const otroContexto = await browser.newContext({ baseURL: ORIGEN, javaScriptEnabled: !sinJs });
  await sesionDe(otroContexto, CORREOS.op3, { superficie: "sofipo" });
  const otra = await otroContexto.newPage();
  await otra.goto(`/operacion/clientes/${companyId}`);
  await otra.locator("#motivo-suspension").fill("Revisión de Cumplimiento sobre el expediente.");

  await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/operacion/clientes/${companyId}`);
  const formulario = "form:has(#motivo-suspension)";
  const pedir = page.getByRole("button", { name: boton });
  const primero = await formIdDe(page, formulario);
  await page.locator("#motivo-suspension").fill("Revisar 😀");
  await rechazado(page, pedir, "aviso-suspension", sinJs);
  await expect(page.locator("#motivo-suspension")).toHaveValue("Revisar 😀");
  expect([await solicitudes(), await conId("company_suspensions", primero)]).toEqual([antes, 0]);
  await page.locator("#motivo-suspension").fill("Revisión del contrato y del expediente.");
  await reintentarConDobleClic(page, pedir, formulario, primero, /aviso=(suspension|reactivacion)_solicitada/, sinJs);
  expect([await solicitudes(), await conId("company_suspensions", primero)]).toEqual([antes + 1, 1]);

  await rechazado(otra, otra.getByRole("button", { name: boton }), "aviso-suspension", sinJs);
  await expect(otra.locator("#aviso-suspension")).toHaveText("Ya hay una solicitud de suspensión o reactivación pendiente para esta empresa.");
  await expect(otra.locator("#aviso-suspension .alerta")).toHaveAttribute("role", "alert");
  await expect(otra.getByText(/Hay una solicitud de (suspensión|reactivación) pendiente\. Se decide en Aprobaciones\./)).toBeVisible();
  await expect(otra.locator("#motivo-suspension")).toHaveCount(0);
  expect(await solicitudes()).toBe(antes + 1);
  await otroContexto.close();
}

// Doceava revisión, con JavaScript, sobre empresas que solo usa este grupo (Eje y Fresno) y la cookie, que no deja nada.
test.describe("doceava con JavaScript: empresas propias de la siembra", () => {
  test.describe.configure({ mode: "serial" });

  test("doceava: el dictamen y el grado de riesgo de Eje vuelven con lo elegido; nada queda en «baja» sin elegirlo y el doble clic tras el rechazo registra una vez", async ({ page, context }) => {
    const errores = vigilarConsola(page);
    await dictamenYRiesgo(page, context, EJE.rfc, false);
    expect(errores).toEqual([]);
  });

  test("doceava: si otra pestaña ya registró el dictamen, el rechazo de Fresno va arriba de la página aunque su formulario ya no se pinte", async ({ page, context }) => {
    await dictamenYaRegistrado(page, context, FRESNO.rfc);
  });

  // Doceava revisión: la cookie del rechazo también puede llegar del navegador en una visita normal (cualquiera la manda a
  // mano). La página solo pinta un código del catálogo, con su texto; lo demás se ignora y nunca se copia a la página.
  test("doceava: la cookie del rechazo fabricada en una visita normal solo pinta avisos del catálogo; un valor inventado no aparece", async ({ page, context }) => {
    await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
    const cookie = (value: string) => ({ name: "operacion-rechazo", value, domain: new URL(ORIGEN).hostname, path: "/operacion" });
    await context.addCookies([cookie("dictamen_ya_registrado")]);
    await page.goto("/operacion/clientes");
    await expect(page.locator("#aviso-rechazo")).toHaveText("Esa versión ya tiene dictamen.");
    await expect(page.locator("#aviso-rechazo")).toHaveAttribute("data-aviso", "dictamen_ya_registrado");
    const inventado = "codigo_inventado<b>crudo</b>";
    await context.addCookies([cookie(inventado)]);
    await page.goto("/operacion/clientes");
    await expect(page.locator("#aviso-rechazo")).toHaveCount(0);
    expect(await page.content()).not.toContain("codigo_inventado");
    await context.clearCookies({ name: "operacion-rechazo" });
    // Lo mismo en la dirección: un código que no es del catálogo da el mensaje general y el aviso no lo copia (la dirección
    // misma sí viaja en los datos del enrutador de Next).
    await page.goto("/operacion/clientes?aviso=codigo_inventado");
    await expect(page.locator("#aviso-operacion")).toHaveAttribute("data-aviso", "desconocido");
    await expect(page.locator("#aviso-operacion")).toHaveText("No se pudo completar. Revisa los datos e inténtalo de nuevo.");
    expect(await page.locator("#aviso-operacion").evaluate((nodo) => nodo.outerHTML)).not.toContain("codigo_inventado");
    // Un campo fuera de la lista cerrada: ni por la cookie ni por la dirección se pinta un aviso, y el valor no queda en el
    // marcado (la dirección misma solo viaja como texto en los datos del enrutador, dentro de un script).
    const marcado = () => page.locator("body").evaluate((cuerpo) => {
      const copia = cuerpo.cloneNode(true) as HTMLElement;
      for (const script of copia.querySelectorAll("script")) script.remove();
      return copia.innerHTML;
    });
    for (const valor of ["dato_invalido_<b>x</b>", 'invisible_" onfocus="x']) {
      await context.addCookies([cookie(encodeURIComponent(valor))]);
      await page.goto("/operacion/clientes");
      await expect(page.locator(".operacion-aviso"), valor).toHaveCount(0);
      expect(await page.content(), valor).not.toMatch(/onfocus|x<\/b>|x&lt;\/b&gt;/);
      await context.clearCookies({ name: "operacion-rechazo" });
      await page.goto(`/operacion/clientes?aviso=${encodeURIComponent(valor)}`);
      await expect(page.locator(".operacion-aviso"), valor).toHaveCount(0);
      expect(await marcado(), valor).not.toMatch(/onfocus|x<\/b>|x&lt;\/b&gt;/);
    }
  });

  // Humo-N9 del preview: en un formulario de dos columnas, el aviso de un rechazo caía en una columna angosta (unos 170
  // px) y empujaba «Razón social» a la derecha. El aviso va en su propio renglón, a lo ancho del formulario; el primer
  // campo se queda en la orilla y los campos anchos ocupan la fila. Igual en los formularios en línea de una tarjeta
  // (la coincidencia de Cima) y en la decisión de una recuperación. Solo rechaza: no deja nada en la base.
  test("humo-N9: tras un rechazo, el aviso mide el ancho de su formulario y los campos no se mueven: prospecto (1440 y 390), documento, coincidencia y recuperación", async ({ page, context }) => {
    /** `primero`: el campo que abre el formulario, en la orilla y debajo del aviso; `anchos`: los que ocupan la fila. */
    const aLoAncho = async (forma: Locator, aviso: string, primero: string, anchos: string[], nombre: string) => {
      const formulario = (await forma.boundingBox())!;
      const caja = (await page.locator(`[id="${aviso}"]`).boundingBox())!;
      const deCampo = async (campo: string) => (await forma.locator(`.campo:has(${campo})`).boundingBox())!;
      const medidas = { formulario, aviso: caja, ...Object.fromEntries(await Promise.all([primero, ...anchos].map(async (campo) => [campo, await deCampo(campo)]))) };
      console.log(`MEDIDA ${nombre}: ${JSON.stringify(medidas)}`);
      if (!process.env.E2E_SIN_CAPTURAS) await page.screenshot({ path: test.info().outputPath(`${nombre}.png`) });
      expect(Math.abs(caja.x - formulario.x), `${nombre}: el aviso empieza en la orilla del formulario`).toBeLessThanOrEqual(1);
      expect(Math.abs(caja.width - formulario.width), `${nombre}: el aviso mide el ancho del formulario`).toBeLessThanOrEqual(1);
      const abre = medidas[primero] as { x: number; y: number };
      expect(Math.abs(abre.x - formulario.x), `${nombre}: ${primero} se queda en la orilla del formulario`).toBeLessThanOrEqual(1);
      expect(abre.y, `${nombre}: ${primero} va debajo del aviso`).toBeGreaterThanOrEqual(caja.y + caja.height);
      for (const campo of anchos) {
        expect(Math.abs((medidas[campo] as { width: number }).width - formulario.width), `${nombre}: ${campo} ocupa la fila entera`).toBeLessThanOrEqual(1);
      }
    };

    await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
    for (const [ancho, alto] of [[1440, 900], [390, 844]] as const) {
      await page.setViewportSize({ width: ancho, height: alto });
      await page.goto("/operacion/clientes");
      await page.getByLabel("Razón social").fill("Puerto Nueve E2E");
      await page.getByLabel("RFC").fill("XAXX010101000");
      await page.getByLabel("Código postal").fill("64000");
      await rechazado(page, page.getByRole("button", { name: "Registrar prospecto" }), "aviso-prospecto");
      await aLoAncho(page.locator("form:has(#razonSocial)"), "aviso-prospecto", "#razonSocial", ["#razonSocial"], `n9-prospecto-${ancho}`);
    }
    expect(await contar("select 1 from companies where razon_social = 'Puerto Nueve E2E'")).toBe(0);

    const duna = await empresaDe(DUNA.rfc);
    const documentos = () => contar("select 1 from kyb_documentos where company_id = $1", [duna]);
    const antes = await documentos();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/operacion/clientes/${duna}/expediente`);
    await page.locator("#doc-emitido").fill("2015-03-01");
    await page.locator("#doc-detalle").fill("Escritura 1,204, Notaría 9 de Monterrey");
    await page.locator("#doc-archivo").setInputFiles({ name: "acta-n9.pdf", mimeType: "application/pdf", buffer: Buffer.from("esto no es un PDF") });
    await rechazado(page, page.getByRole("button", { name: "Guardar documento" }), "aviso-documento");
    await aLoAncho(page.locator("form:has(#doc-archivo)"), "aviso-documento", "#doc-tipo", ["#doc-detalle", "#doc-archivo"], "n9-documento-1440");
    expect(await documentos()).toBe(antes);

    // La coincidencia de Cima en Cumplimiento, donde la tarjeta es ancha y el aviso no llena el renglón: un motivo corto.
    const cima = await coincidenciaDe(CIMA.rfc, "pendiente");
    await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
    await page.goto("/operacion/cumplimiento");
    await page.locator(`[id="resolucion-${cima}"]`).selectOption("falso_positivo");
    await page.locator(`[id="motivo-${cima}"]`).fill("Revisar 😀");
    const tarjetaCima = page.locator(`form:has([id="motivo-${cima}"])`);
    await rechazado(page, tarjetaCima.getByRole("button", { name: "Registrar dictamen" }), `aviso-coincidencia-${cima}`);
    await aLoAncho(tarjetaCima, `aviso-coincidencia-${cima}`, `[id="resolucion-${cima}"]`, [], "n9-coincidencia-1440");
    expect(await contar("select 1 from lpb_coincidencias where id = $1 and estado = 'pendiente'", [cima])).toBe(1);

    // La decisión de una recuperación: rechazar sin nota. Al final se rechaza con su nota: ninguna queda abierta.
    const [recuperacion] = await recuperacionesPendientes([CORREOS.diego]);
    await sesionDe(context, CORREOS.op2, { superficie: "sofipo" });
    await page.goto("/operacion/recuperaciones");
    const decision = page.locator(`form:has([id="nota-${recuperacion}"])`);
    await rechazado(page, decision.getByRole("button", { name: "Rechazar" }), `aviso-recuperacion-${recuperacion}`);
    await aLoAncho(decision, `aviso-recuperacion-${recuperacion}`, `[id="verificacion-${recuperacion}"]`, [], "n9-recuperacion-1440");
    await page.locator(`[id="nota-${recuperacion}"]`).fill("No se pudo confirmar la identidad por videollamada.");
    await decision.getByRole("button", { name: "Rechazar" }).click();
    await expect(decision).toHaveCount(0);
  });
});

// Doceava revisión: los 17 datos de Duna y la recuperación solo rechazan (la recuperación se cierra al final); la
// coincidencia de Brisa se confirma aquí y, sin JavaScript, se le anota el folio. Va después de «Operación SOFIPO»,
// que necesita el caso de Brisa abierto.
test.describe("doceava: coincidencias, datos generales y recuperaciones", () => {
  test.describe.configure({ mode: "serial" });

  test("doceava: los 17 datos generales vuelven como se escribieron; después de otro rechazo queda un solo aviso y el resumen de arriba se oculta", async ({ page, context }) => {
    const errores = vigilarConsola(page);
    const duna = await empresaDe(DUNA.rfc);
    const guardados = () => consultar("select * from kyb_versiones where company_id = $1 and estado = 'borrador'", [duna]);
    await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/operacion/clientes/${duna}/expediente`);
    // Un envío que sí se aplica deja su aviso arriba, en la dirección.
    const validos: Record<string, string> = {
      razonSocial: DUNA.razonSocial, rfc: DUNA.rfc, giro: "Distribución de abarrotes", nacionalidad: "Mexicana", fechaConstitucion: "2019-04-04",
      serieEfirma: "00001000000500000001", domicilioCalle: "Av. Constitución", domicilioExterior: "1200", domicilioInterior: "4B",
      domicilioColonia: "Centro", domicilioMunicipio: "Monterrey", domicilioEntidad: "Nuevo León", domicilioCodigoPostal: "64000",
      domicilioPais: "México", telefono: "8181234567", correo: "contacto@duna.mx", volumenMensualCentavos: "250000.00",
    };
    for (const [campo, valor] of Object.entries(validos)) await page.locator(`#dato-${campo}`).fill(valor);
    await page.getByRole("button", { name: "Guardar datos" }).click();
    await page.waitForURL(/aviso=expediente_datos_guardados/);
    await expect(page.locator("#aviso-operacion")).toHaveText("Datos generales guardados en el borrador.");
    const antes = await guardados();
    // Los 17 con otro valor y la razón social con un carácter invisible: vuelven los 17 como se escribieron, no lo guardado.
    const escritos: Record<string, string> = {
      razonSocial: "Duna​Comercial SA de CV", rfc: DUNA.rfc, giro: "Comercio al por mayor de abarrotes", nacionalidad: "Mexicana",
      fechaConstitucion: "2019-05-05", serieEfirma: "00001000000500000002", domicilioCalle: "Calle Hidalgo", domicilioExterior: "45",
      domicilioInterior: "2", domicilioColonia: "Obispado", domicilioMunicipio: "San Pedro Garza García", domicilioEntidad: "Nuevo León",
      domicilioCodigoPostal: "66220", domicilioPais: "México", telefono: "8187654321", correo: "ventas@duna.mx", volumenMensualCentavos: "300000.00",
    };
    for (const [campo, valor] of Object.entries(escritos)) await page.locator(`#dato-${campo}`).fill(valor);
    await rechazado(page, page.getByRole("button", { name: "Guardar datos" }), "aviso-datos");
    await mensajeJunto(page, "#dato-razonSocial", "La razón social trae un carácter invisible, algo común al copiar y pegar. Escríbela de nuevo a mano.", "aviso-datos-campo");
    for (const [campo, valor] of Object.entries(escritos)) await expect(page.locator(`#dato-${campo}`), campo).toHaveValue(valor);
    await expect(page.locator("#aviso-operacion")).toHaveCount(0);
    expect(await guardados()).toEqual(antes);
    // Otro rechazo, en el documento: el aviso de los datos se descarta, lo escrito se queda y hay un solo campo marcado.
    await page.locator("#doc-archivo").setInputFiles({ name: "acta-falsa.pdf", mimeType: "application/pdf", buffer: Buffer.from("esto no es un PDF") });
    await page.locator("#doc-detalle").fill("Escritura 1,204, Notaría 9 de Monterrey");
    await rechazado(page, page.getByRole("button", { name: "Guardar documento" }), "aviso-documento");
    await expect(page.locator("#aviso-datos")).toHaveCount(0);
    await expect(page.locator("#dato-razonSocial")).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#dato-giro")).toHaveValue(escritos.giro!);
    await mensajeJunto(page, "#doc-archivo", "Sube un PDF, PNG o JPG legible.", "aviso-documento-campo");
    expect(errores).toEqual([]);
  });

  test("doceava: el dictamen de una coincidencia y su folio vuelven a su tarjeta con lo escrito; otro rechazo en otra tarjeta descarta el primero", async ({ page, context }) => {
    const errores = vigilarConsola(page);
    const [brisa, cima] = [await coincidenciaDe(BRISA.rfc, "pendiente"), await coincidenciaDe(CIMA.rfc, "pendiente")];
    await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/operacion/lpb");
    const tarjeta = (id: string) => page.locator(`form:has([id="motivo-${id}"])`);
    await page.locator(`[id="resolucion-${cima}"]`).selectOption("falso_positivo");
    await page.locator(`[id="motivo-${cima}"]`).fill("Revisar 😀");
    await rechazado(page, tarjeta(cima).getByRole("button", { name: "Registrar dictamen" }), `aviso-coincidencia-${cima}`);
    await mensajeJunto(page, `[id="motivo-${cima}"]`, MOTIVO_CORTO, `aviso-coincidencia-${cima}-campo`);
    await expect(page.locator(`[id="resolucion-${cima}"]`)).toHaveValue("falso_positivo");
    await expect(page.locator(`[id="motivo-${cima}"]`)).toHaveValue("Revisar 😀");
    await expect(page.locator(`[id="motivo-${brisa}"]`)).not.toHaveAttribute("aria-invalid", "true");
    await page.locator(`[id="resolucion-${brisa}"]`).selectOption("confirmada");
    await page.locator(`[id="motivo-${brisa}"]`).fill("Revisar 😀");
    await rechazado(page, tarjeta(brisa).getByRole("button", { name: "Registrar dictamen" }), `aviso-coincidencia-${brisa}`);
    await expect(page.locator(`[id="aviso-coincidencia-${cima}"]`)).toHaveCount(0);
    await expect(page.locator(`[id="motivo-${cima}"]`)).toHaveValue("Revisar 😀");
    await mensajeJunto(page, `[id="motivo-${brisa}"]`, MOTIVO_CORTO, `aviso-coincidencia-${brisa}-campo`);
    expect(await contar("select 1 from lpb_coincidencias where id = any($1::uuid[]) and estado = 'pendiente'", [[brisa, cima]])).toBe(2);
    // Brisa se confirma; su folio con una fecha futura vuelve a su tarjeta con lo escrito.
    await page.locator(`[id="motivo-${brisa}"]`).fill("Coincide el RFC de la empresa con la lista.");
    await tarjeta(brisa).getByRole("button", { name: "Registrar dictamen" }).click();
    await page.waitForURL(/aviso=coincidencia_resuelta/);
    await page.locator(`[id="folio-${brisa}"]`).fill("UIF-2026-0101");
    await page.locator(`[id="presentado-${brisa}"]`).fill("2099-01-01");
    await rechazado(page, page.locator(`form:has([id="folio-${brisa}"])`).getByRole("button", { name: "Anotar folio" }), `aviso-folio-${brisa}`);
    await mensajeJunto(page, `[id="presentado-${brisa}"]`, "Revisa la fecha de presentación del reporte: debe existir en el calendario y no puede ser futura.", `aviso-folio-${brisa}-campo`);
    await expect(page.locator(`[id="folio-${brisa}"]`)).toHaveValue("UIF-2026-0101");
    await expect(page.locator(`[id="presentado-${brisa}"]`)).toHaveValue("2099-01-01");
    expect(await contar("select 1 from lpb_coincidencias where id = $1 and reporte_folio is not null", [brisa])).toBe(0);
    expect(errores).toEqual([]);
  });

  test("doceava: tras un rechazo la página se vuelve a pintar: con el factor caducado aparece «Confirma que eres tú» y la tarjeta conserva lo elegido", async ({ page, context }) => {
    const errores = vigilarConsola(page);
    const [id] = await recuperacionesPendientes([CORREOS.sol]);
    const tarjeta = () => page.locator("li.decision").filter({ hasText: CORREOS.sol });
    await sesionDe(context, CORREOS.op2, { superficie: "sofipo" });
    await page.goto("/operacion/recuperaciones");
    const panel = page.getByRole("heading", { name: "Confirma que eres tú" });
    await expect(panel).toHaveCount(0);
    await envejecerFactor(CORREOS.op2, 6);
    await page.locator(`[id="verificacion-${id}"]`).selectOption("videollamada");
    await page.locator(`[id="nota-${id}"]`).fill("Verificada por videollamada con su identificación.");
    await rechazado(page, tarjeta().getByRole("button", { name: "Aprobar" }), `aviso-recuperacion-${id}`);
    await expect(page.locator(`[id="aviso-recuperacion-${id}"]`)).toHaveText("Confirma que eres tú con tu segundo factor antes de decidir. Vale cinco minutos.");
    await expect(page.locator(`[id="aviso-recuperacion-${id}"] .alerta`)).toHaveAttribute("role", "alert");
    await expect(panel).toBeVisible();
    await expect(page.locator(`[id="verificacion-${id}"]`)).toHaveValue("videollamada");
    await expect(page.locator(`[id="nota-${id}"]`)).toHaveValue("Verificada por videollamada con su identificación.");
    expect(await contar("select 1 from auth_recuperaciones where id = $1 and estado = 'solicitada'", [id])).toBe(1);
    // Con una sesión nueva (factor reciente), se rechaza con su nota: ninguna queda abierta para las demás pruebas.
    await sesionDe(context, CORREOS.op2, { superficie: "sofipo" });
    await page.goto("/operacion/recuperaciones");
    await page.locator(`[id="nota-${id}"]`).fill("No se pudo confirmar la identidad por videollamada.");
    await tarjeta().getByRole("button", { name: "Rechazar" }).click();
    await expect(tarjeta()).toHaveCount(0);
    expect(errores).toEqual([]);
  });

  // El folio solo se anota en una coincidencia confirmada: la de Brisa la confirma la prueba con JavaScript de arriba.
  test.describe("sin JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("sin JavaScript, el estado de cada formulario vuelve a su tarjeta (la clave es el id): el dictamen de Cima y el folio de Brisa", async ({ page, context }) => {
      const [cima, brisa] = [await coincidenciaDe(CIMA.rfc, "pendiente"), await coincidenciaDe(BRISA.rfc, "confirmada")];
      await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
      await page.goto("/operacion/lpb");
      await page.locator(`[id="resolucion-${cima}"]`).selectOption("fuera_de_lista");
      await page.locator(`[id="motivo-${cima}"]`).fill("Revisar 😀");
      await rechazado(page, page.locator(`form:has([id="motivo-${cima}"])`).getByRole("button", { name: "Registrar dictamen" }), `aviso-coincidencia-${cima}`, true);
      await mensajeJunto(page, `[id="motivo-${cima}"]`, MOTIVO_CORTO, `aviso-coincidencia-${cima}-campo`);
      await expect(page.locator(`[id="resolucion-${cima}"]`)).toHaveValue("fuera_de_lista");
      await expect(page.locator(`[id="aviso-folio-${brisa}"]`)).toHaveCount(0);
      await page.locator(`[id="folio-${brisa}"]`).fill("UIF-2026-0102");
      await page.locator(`[id="presentado-${brisa}"]`).fill("2099-01-01");
      await rechazado(page, page.locator(`form:has([id="folio-${brisa}"])`).getByRole("button", { name: "Anotar folio" }), `aviso-folio-${brisa}`, true);
      await mensajeJunto(page, `[id="presentado-${brisa}"]`, "Revisa la fecha de presentación del reporte: debe existir en el calendario y no puede ser futura.", `aviso-folio-${brisa}-campo`);
      await expect(page.locator(`[id="folio-${brisa}"]`)).toHaveValue("UIF-2026-0102");
      await expect(page.locator(`[id="aviso-coincidencia-${cima}"]`)).toHaveCount(0);
      expect(await contar("select 1 from lpb_coincidencias where id = $1 and estado = 'pendiente'", [cima])).toBe(1);
    });
  });
});
