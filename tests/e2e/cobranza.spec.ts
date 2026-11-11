import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { cerrarConexion } from "../../src/nucleo/db";
import { auditar } from "../../src/server/bitacora/auditar";
import { atenderAviso, firmar, registrarCuentaFintoc, type ConfigFintoc } from "../../src/server/cobranza/fintoc";
import { contextoDePersonal } from "../../src/server/plataforma/servicio";
import { ORIGEN, consultar, contar, correosPara, dobleClic, enlaceDe, sesionDe, vigilarConsola } from "./apoyo";
import { CORREOS } from "./siembra";
import { CORREOS_COBRANZA } from "./siembra-cobranza";

/**
 * Cobranza de punta a punta, todo con clics: configurar dónde se recibe, dar de
 * alta clientes (fijo mensual, variable trimestral y anual), el correo de cobro
 * con la página del pagador, la lista con su resumen y antigüedad, el pago a
 * mano con comprobante, el estado de cuenta de tres bancos (empatar, proponer,
 * confirmar y volver a subir sin duplicar), aplicar, revertir y anular, el plan
 * (pausa, edición y cancelación), la tarea diaria con CRON_SECRET, la empresa de
 * demostración y el rol que solo ve. Cada envío es un doble clic y la base debe
 * quedar con una sola operación y su evento.
 *
 * Con E2E_CAPTURAS guarda la evidencia (capturas por navegador, 3 temas × 1440
 * y 390, axe y desborde horizontal). En CI no se toman.
 */

test.describe.configure({ mode: "serial" });
// Con el origen https local de la evidencia el certificado es autofirmado.
test.use({ ignoreHTTPSErrors: ORIGEN.startsWith("https:") });

const EMPRESA = () => requerida("E2E_COBRANZA_ID");
const DEMO = () => requerida("E2E_COBRANZA_DEMO_ID");
const CLABE = "002180701150123452";
const RASTREO_A = "BNET01002611060000123456";
const FIXTURES = join(process.cwd(), "tests/cobranza/fixtures/estados");
const EVIDENCIA = process.env.E2E_CAPTURAS ?? "";

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta ${nombre}: lo define tests/e2e/siembra-cobranza.ts.`);
  return valor;
}

const en = (ruta: string, empresa = EMPRESA()) => `/c/${empresa}${ruta}`;
const hoy = () => process.env.E2E_TODAY ?? new Date().toISOString().slice(0, 10);

function desplazar(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Sesión de la persona (y el tema, para la evidencia). WebKit no manda la
 * cookie __Host- (Secure) por http local: la evidencia en WebKit corre con un
 * origen https local (E2E_BASE_URL, ver docs/evidencia/cobranza/README.md).
 */
async function entrar(context: BrowserContext, correo: string, tema?: string): Promise<void> {
  await sesionDe(context, correo);
  if (tema) await context.addCookies([{ name: "tema", value: tema, domain: new URL(ORIGEN).hostname, path: "/" }]);
}

/**
 * Los errores de la página, sin las precargas RSC de los enlaces que WebKit corta
 * al navegar: las anota como «…?_rsc=… due to access control checks» aunque no
 * haya CORS de por medio (Chromium no anota nada). Cualquier otro error cuenta.
 */
function reales(errores: string[], browserName: string): string[] {
  if (browserName !== "webkit") return errores;
  return errores.filter((e) => !/^pageerror \S*[?&]_rsc=\S+ due to access control checks\.$/.test(e));
}

/** Los errores de consola de cada página vigilada, para que `foto` aparte lo que inserta el inspector de WebKit. */
const vigiladas = new Map<Page, string[]>();
function vigilar(page: Page): string[] {
  const errores = vigilarConsola(page);
  vigiladas.set(page, errores);
  return errores;
}

// Al capturar, el inspector de WebKit inserta un <style> sin nonce y la CSP estricta lo rechaza (lo documenta el #62
// en docs/evidencia/encabezados/con-main). Es de la herramienta: se descarta solo esa anotación exacta, solo en WebKit
// y solo si apareció durante la captura. Cualquier otra cuenta.
const DEL_INSPECTOR = "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.";

let fotos = 0;
async function foto(page: Page, browserName: string, nombre: string): Promise<void> {
  if (!EVIDENCIA) return;
  mkdirSync(EVIDENCIA, { recursive: true });
  fotos += 1;
  const errores = vigiladas.get(page);
  const antes = errores?.length ?? 0;
  await page.screenshot({ path: join(EVIDENCIA, `${browserName}-${String(fotos).padStart(2, "0")}-${nombre}.jpg`), fullPage: true, type: "jpeg", quality: 70 });
  if (browserName !== "webkit" || !errores) return;
  await page.waitForTimeout(200);
  const durante = errores.splice(antes);
  errores.push(...durante.filter((e) => e !== DEL_INSPECTOR));
}

async function idDeCliente(nombre: string, empresa = EMPRESA()): Promise<string> {
  const [fila] = await consultar<{ id: string }>("select id from collection_customers where company_id = $1 and nombre = $2", [empresa, nombre]);
  if (!fila) throw new Error(`No existe el cliente ${nombre}.`);
  return fila.id;
}

async function cargoDe(clienteId: string, concepto?: string): Promise<{ id: string; referencia: string; estado: string; monto: number | null }> {
  const [fila] = await consultar<{ id: string; referencia: string; estado: string; monto: string | null }>(
    `select id, referencia, estado, monto_centavos::text as monto from collection_charges
      where customer_id = $1 and ($2::text is null or concepto = $2) order by vencimiento limit 1`,
    [clienteId, concepto ?? null],
  );
  if (!fila) throw new Error("El cliente no tiene cargo.");
  return { ...fila, monto: fila.monto === null ? null : Number(fila.monto) };
}

async function darDeAlta(page: Page, datos: { nombre: string; correo: string; concepto: string; tipo: "fijo" | "variable"; monto?: string; periodicidad: string; dias: number }) {
  await page.goto(en("/consola/cobros/nuevo"));
  const forma = page.locator('form[data-formulario="alta-cliente"]');
  await forma.locator("#nombre").fill(datos.nombre);
  await forma.locator("#correos").fill(datos.correo);
  await forma.locator("#concepto").fill(datos.concepto);
  if (datos.tipo === "variable") await forma.getByLabel("Variable cada periodo").check();
  if (datos.monto) await forma.locator("#monto").fill(datos.monto);
  await forma.locator("#periodicidad").selectOption(datos.periodicidad);
  await forma.locator("#primerVencimiento").fill(desplazar(hoy(), datos.dias));
  await expect(page.locator('[data-calendario="previo"] li')).toHaveCount(12);
  const { envios } = await dobleClic(forma.getByRole("button", { name: "Dar de alta y cobrar" }), { esperar: /\/consola\/cobros\/clientes\/[0-9a-f-]{36}\?alta=/ });
  expect(envios).toBe(1);
  expect(await contar("select 1 from collection_customers where company_id = $1 and nombre = $2", [EMPRESA(), datos.nombre])).toBe(1);
}

test("1 · configurar dónde se recibe: CLABE, contacto y aviso al equipo", async ({ page, context, browserName }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_COBRANZA.carla);
  await page.goto(en("/consola/cobros"));
  await expect(page.getByText("Configura dónde te pagan")).toBeVisible();
  await expect(page.locator('[data-deteccion="pronto"]')).toContainText("Detección automática: disponible pronto");
  await foto(page, browserName, "sin-configurar");

  await page.getByRole("link", { name: "Configurar la cobranza" }).click();
  await expect(page).toHaveURL(/\/consola\/cobros\/configuracion$/);
  const forma = page.locator('form[data-formulario="configuracion-cobranza"]');
  await forma.locator("#clabe").fill(CLABE);
  await forma.locator("#beneficiario").fill("Cobranza E2E SA de CV");
  await forma.locator("#correoContacto").fill("cobranza@ejemplo.mx");
  const avisosAntes = correosPara(CORREOS_COBRANZA.carla).length;
  const { envios } = await dobleClic(forma.getByRole("button", { name: "Guardar la configuración" }));
  await expect(forma.locator(".alerta-asentado")).toBeVisible();
  expect(envios).toBe(1);
  expect(await contar("select 1 from collection_settings where company_id = $1 and clabe = $2", [EMPRESA(), CLABE])).toBe(1);
  expect(await contar("select 1 from audit_log where company_id = $1 and accion = 'configurar_cobranza'", [EMPRESA()])).toBe(1);
  // El cambio de CLABE avisa a administración y finanzas, sin la CLABE completa.
  const avisos = correosPara(CORREOS_COBRANZA.carla);
  expect(avisos.length).toBe(avisosAntes + 1);
  expect(avisos.at(-1)!.texto).not.toContain(CLABE);
  await foto(page, browserName, "configuracion");
  expect(reales(errores, browserName)).toEqual([]);
});

test("2 · alta fijo mensual: correo de cobro con CLABE y referencia, y página del pagador", async ({ page, context, browserName, browser }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_COBRANZA.carla);
  await darDeAlta(page, { nombre: "Colegio Alfa", correo: "pagos-alfa@ejemplo.mx", concepto: "Colegiatura", tipo: "fijo", monto: "10000", periodicidad: "mensual", dias: 5 });
  await expect(page).toHaveURL(/\?alta=enviado$/);
  await expect(page.getByText("el correo de cobro ya salió con la CLABE y la referencia")).toBeVisible();
  await expect(page.locator('[data-calendario="plan"] li')).toHaveCount(12);
  await foto(page, browserName, "ficha-recien-dado-de-alta");

  const alfa = await idDeCliente("Colegio Alfa");
  const cargo = await cargoDe(alfa);
  expect(cargo).toMatchObject({ estado: "emitido", monto: 1_000_000 });
  expect(await contar("select 1 from collection_plans where customer_id = $1 and periodicidad = 'mensual' and tipo = 'fijo'", [alfa])).toBe(1);
  expect(await contar("select 1 from collection_emails where charge_id = $1 and tipo = 'cobro' and estado = 'enviado'", [cargo.id])).toBe(1);
  expect(await contar("select 1 from audit_log where identificador = $1 and accion = 'alta_cliente_cobranza'", [alfa])).toBe(1);
  const [cobro] = correosPara("pagos-alfa@ejemplo.mx");
  expect(correosPara("pagos-alfa@ejemplo.mx")).toHaveLength(1);
  expect(cobro!.texto.replace(/\s/g, "")).toContain(CLABE);
  expect(cobro!.texto).toContain(cargo.referencia);
  expect(cobro!.texto).toContain("cobranza@ejemplo.mx");

  // La página del pagador abre sin sesión con el enlace del correo.
  const pagador = await browser.newContext({ javaScriptEnabled: true, ignoreHTTPSErrors: ORIGEN.startsWith("https:") });
  try {
    const pagina = await pagador.newPage();
    const erroresPagador = vigilar(pagina);
    await pagina.goto(enlaceDe(cobro!, /\/pagar\//));
    await expect(pagina.locator('h1[data-cifra="saldo"]')).toHaveAttribute("data-centavos", "1000000");
    await expect(pagina.locator(`[data-referencia="${cargo.referencia}"]`)).toBeVisible();
    await expect(pagina.locator(`[data-clabe="${CLABE}"]`)).toBeVisible();
    await foto(pagina, browserName, "pagador");
    const avisosAntes = correosPara(CORREOS_COBRANZA.carla).length;
    const { envios } = await dobleClic(pagina.getByRole("button", { name: "No quiero recibir recordatorios" }));
    expect(envios).toBe(1);
    await expect(pagina.locator('[data-sin-recordatorios="hecho"]')).toBeVisible();
    expect(await contar("select 1 from collection_customers where id = $1 and not recordatorios and recordatorios_por = 'pagador'", [alfa])).toBe(1);
    await expect.poll(() => correosPara(CORREOS_COBRANZA.carla).length).toBe(avisosAntes + 1);
    await foto(pagina, browserName, "pagador-sin-recordatorios");
    expect(reales(erroresPagador, browserName)).toEqual([]);
  } finally {
    await pagador.close();
  }

  // La empresa lo ve en la ficha y puede volver a encenderlos.
  await page.reload();
  await expect(page.getByText("El cliente pidió no recibir recordatorios")).toBeVisible();
  await dobleClic(page.getByRole("button", { name: "Encender recordatorios (el cliente los apagó)" }));
  await expect(page.getByRole("button", { name: "Apagar recordatorios" })).toBeVisible();
  expect(await contar("select 1 from collection_customers where id = $1 and recordatorios", [alfa])).toBe(1);
  expect(await contar("select 1 from audit_log where identificador = $1 and accion = 'recordatorios_cliente_cobranza'", [alfa])).toBe(2);
  expect(reales(errores, browserName)).toEqual([]);
});

test("3 · variable trimestral: sin monto hasta capturarlo; anual con su primer cargo", async ({ page, context, browserName }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_COBRANZA.carla);
  await darDeAlta(page, { nombre: "Despacho Beta", correo: "pagos-beta@ejemplo.mx", concepto: "Honorarios", tipo: "variable", periodicidad: "trimestral", dias: 4 });
  const beta = await idDeCliente("Despacho Beta");
  const fila = page.locator(`table[data-tabla="cargos-cliente"] tr[data-estado="por_emitir"]`);
  await expect(fila).toContainText("Sin monto");
  expect(correosPara("pagos-beta@ejemplo.mx")).toHaveLength(0);
  await fila.getByRole("button", { name: "Capturar monto" }).click();
  const dialogo = page.getByRole("dialog", { name: "Capturar el monto del periodo" });
  await dialogo.getByLabel("Monto de este periodo").fill("7,250.00");
  const { envios } = await dobleClic(dialogo.getByRole("button", { name: "Emitir el cargo" }));
  expect(envios).toBe(1);
  await expect(page.locator('table[data-tabla="cargos-cliente"] tr[data-estado="emitido"]')).toHaveCount(1);
  expect(await cargoDe(beta)).toMatchObject({ estado: "emitido", monto: 725_000 });
  await expect.poll(() => correosPara("pagos-beta@ejemplo.mx").length).toBe(1);
  await foto(page, browserName, "variable-emitido");

  await darDeAlta(page, { nombre: "Clínica Gamma", correo: "pagos-gamma@ejemplo.mx", concepto: "Licencia anual", tipo: "fijo", monto: "4500", periodicidad: "anual", dias: 3 });
  expect(await cargoDe(await idDeCliente("Clínica Gamma"))).toMatchObject({ estado: "emitido", monto: 450_000 });
  expect(reales(errores, browserName)).toEqual([]);
});

test("4 · lista: resumen, antigüedad que filtra, búsqueda y pestañas", async ({ page, context, browserName }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_COBRANZA.carla);
  // El módulo se llama «Cobranza» en el lateral, en el título de la pestaña y en el de la página.
  await page.goto(en("/consola"));
  const enlace = page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Cobranza", exact: true });
  await enlace.click();
  await expect(page).toHaveURL(/\/consola\/cobros$/);
  await expect(enlace).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveTitle(/^Cobranza\b/);
  await expect(page.getByRole("heading", { level: 1, name: "Cobranza", exact: true })).toBeVisible();
  await expect(page.locator('[data-cifra="por-cobrar"]')).toHaveAttribute("data-centavos", String(1_000_000 + 725_000 + 450_000));
  await expect(page.locator('[data-cifra="vencido"]')).toHaveAttribute("data-centavos", "0");
  await expect(page.locator('table[data-tabla="cargos"] tbody tr')).toHaveCount(3);
  await foto(page, browserName, "lista");

  await page.locator('.cobranza-cubetas a[data-cubeta="por_vencer"]').click();
  await expect(page).toHaveURL(/antiguedad=por_vencer/);
  await expect(page.locator('table[data-tabla="cargos"] tbody tr')).toHaveCount(3);
  await page.locator('.cobranza-cubetas a[data-cubeta="d1_30"]').click();
  await expect(page.getByText("Ningún cargo con estos filtros.")).toBeVisible();
  await page.getByRole("link", { name: "Quitar el filtro" }).click();

  await page.getByRole("searchbox", { name: "Buscar por cliente, concepto o referencia" }).fill("Gamma");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/q=Gamma/);
  await expect(page.locator('table[data-tabla="cargos"] tbody tr')).toHaveCount(1);
  await expect(page.locator('table[data-tabla="cargos"] tbody tr')).toContainText("Clínica Gamma");

  await page.getByRole("link", { name: /^Clientes · 3$/ }).click();
  await expect(page.locator('table[data-tabla="clientes"] tbody tr')).toHaveCount(3);
  await foto(page, browserName, "lista-clientes");
  await page.getByRole("link", { name: /^Por conciliar · 0$/ }).click();
  await expect(page.getByText("Nada por conciliar.")).toBeVisible();
  expect(reales(errores, browserName)).toEqual([]);
});

test("5 · pago a mano con comprobante: el cargo queda pagado y el comprobante baja", async ({ page, context, browserName }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_COBRANZA.carla);
  const alfa = await idDeCliente("Colegio Alfa");
  const cargo = await cargoDe(alfa);
  await page.goto(en("/consola/cobros"));
  const fila = page.locator(`table[data-tabla="cargos"] tr[data-cargo="${cargo.id}"]`);
  await fila.getByRole("button", { name: "Registrar pago" }).click();
  const dialogo = page.getByRole("dialog", { name: "Registrar un pago" });
  await expect(dialogo.getByLabel("Monto que llegó")).toHaveValue("10000.00");
  await dialogo.getByLabel("Clave de rastreo (opcional)").fill(RASTREO_A);
  const pdf = readFileSync(join(process.cwd(), "tests/e2e/fixtures/soporte-prueba.pdf"));
  await dialogo.getByLabel("Comprobante (opcional)").setInputFiles({ name: "cep-colegio-alfa.pdf", mimeType: "application/pdf", buffer: pdf });
  const { envios } = await dobleClic(dialogo.getByRole("button", { name: "Registrar el pago" }));
  expect(envios).toBe(1);
  await expect(fila).toHaveAttribute("data-estado", "pagado");
  expect(await contar("select 1 from collection_payments where customer_id = $1 and fuente = 'manual' and estado = 'aplicado' and clave_rastreo = $2 and document_id is not null", [alfa, RASTREO_A])).toBe(1);
  expect((await cargoDe(alfa)).estado).toBe("pagado");
  expect(await contar("select 1 from audit_log where company_id = $1 and accion = 'registrar_pago_cobranza'", [EMPRESA()])).toBe(1);

  await page.goto(en(`/consola/cobros/clientes/${alfa}`));
  const enlace = page.locator('[data-lista="pagos"] a', { hasText: "Comprobante" });
  await expect(enlace).toBeVisible();
  const [descarga] = await Promise.all([page.waitForEvent("download"), enlace.click()]);
  expect(descarga.suggestedFilename()).toBe("cep-colegio-alfa.pdf");
  // En CI el navegador vive en otro contenedor: path() no existe ahí y saveAs() copia el archivo a este lado.
  const copia = test.info().outputPath("comprobante-descargado.pdf");
  await descarga.saveAs(copia);
  expect(readFileSync(copia).equals(pdf)).toBe(true);
  expect(await contar("select 1 from audit_log where company_id = $1 and accion = 'descargar_documento'", [EMPRESA()])).toBe(1);
  // La respuesta de verdad, con y sin /c/<empresa>: aislada y en sandbox, no la regla general (r63-N5).
  const ruta = new URL((await enlace.getAttribute("href"))!, ORIGEN).pathname.replace(/^\/c\/[^/]+/, "");
  for (const camino of [ruta, en(ruta)]) {
    const respuesta = await context.request.get(`${ORIGEN}${camino}`);
    expect(respuesta.status(), camino).toBe(200);
    expect(respuesta.headers()["content-security-policy"], camino).toBe("sandbox; default-src 'none'; frame-ancestors 'none'");
    expect(respuesta.headers()["content-disposition"], camino).toMatch(/^attachment;/);
  }
  await foto(page, browserName, "pago-con-comprobante");
  expect(reales(errores, browserName)).toEqual([]);
});

test("6 · estado de cuenta de tres bancos: empatar, proponer, confirmar y resubir sin duplicar", async ({ page, context, browserName }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_COBRANZA.carla);
  const refB = (await cargoDe(await idDeCliente("Despacho Beta"))).referencia;
  const refC = (await cargoDe(await idDeCliente("Clínica Gamma"))).referencia;
  const bbva = Buffer.from(readFileSync(join(FIXTURES, "bbva-movimientos.csv")).toString("latin1").replace("{{REF_B}}", refB), "latin1");
  const banorte = Buffer.from(readFileSync(join(FIXTURES, "banorte-movimientos.csv"), "utf8").replace("{{REF_C}}", refC), "utf8");
  const santander = readFileSync(join(FIXTURES, "santander-movimientos.xlsx"));
  const subir = async (banco: string, nombre: string, buffer: Buffer, mimeType: string) => {
    await page.goto(en("/consola/cobros/estado-de-cuenta"));
    const forma = page.locator('form[data-formulario="estado-de-cuenta"]');
    await forma.locator("#banco").selectOption(banco);
    await forma.locator("#archivo").setInputFiles({ name: nombre, mimeType, buffer });
    await forma.getByRole("button", { name: "Subir y ver las propuestas" }).click();
    return forma;
  };
  const propuesta = (centavos: number) => page.locator('table[data-tabla="propuestas"] tbody tr').filter({ has: page.locator(`td[data-columna="monto"]`, { hasText: pesos(centavos) }) });
  const confirmar = async () => {
    const forma = page.locator('form[data-formulario="confirmar-estado-de-cuenta"]');
    const { envios } = await dobleClic(forma.getByRole("button", { name: "Confirmar la importación" }));
    expect(envios).toBe(1);
    await expect(page.getByText("La importación quedó confirmada")).toBeVisible();
  };

  // BBVA: los títulos no se reconocen solos («Día»); la primera vez se empatan a mano.
  let forma = await subir("bbva", "bbva-movimientos.csv", bbva, "text/csv");
  await expect(page.getByRole("heading", { name: "Empata las columnas de BBVA" })).toBeVisible();
  await foto(page, browserName, "empatar-bbva");
  // La muestra se desplaza a lo ancho con muchas columnas: es una región con nombre que recibe el foco (r63g-N1).
  const muestra = page.getByRole("region", { name: "Tabla de los primeros renglones del archivo", exact: true });
  await muestra.focus();
  await expect(muestra).toBeFocused();
  await forma.locator("#filaEncabezado").selectOption({ label: "Renglón 4" });
  await forma.locator("#columnaFecha").selectOption("0");
  await forma.locator("#columnaConcepto").selectOption("1");
  await forma.locator("#columnaAbono").selectOption("3");
  await dobleClic(forma.getByRole("button", { name: "Guardar el empate y ver las propuestas" }), { esperar: /importacion=.*nuevos=2/ });
  await expect(page.locator(".alerta-asentado", { hasText: "2 abonos nuevos" })).toBeVisible();
  await expect(propuesta(725_000)).toHaveAttribute("data-propuesta", "aplicar");
  await expect(propuesta(333_333)).toHaveAttribute("data-propuesta", "por_conciliar");
  await foto(page, browserName, "propuestas-bbva");
  await confirmar();
  await expect(propuesta(725_000)).toHaveAttribute("data-estado", "aplicado");
  expect((await cargoDe(await idDeCliente("Despacho Beta"))).estado).toBe("pagado");

  // Banorte: los títulos se reconocen; la fórmula del concepto se guarda como texto y se descarta.
  forma = await subir("banorte", "banorte-movimientos.csv", banorte, "text/csv");
  await expect(page.getByRole("heading", { name: "Empata las columnas de Banorte" })).toBeVisible();
  await expect(forma.locator("#columnaAbono")).toHaveValue("3");
  await dobleClic(forma.getByRole("button", { name: "Guardar el empate y ver las propuestas" }), { esperar: /importacion=.*nuevos=2/ });
  await expect(propuesta(450_000)).toHaveAttribute("data-propuesta", "aplicar");
  await propuesta(100_000).getByText("No es de un cliente").click();
  await confirmar();
  await expect(propuesta(100_000)).toHaveAttribute("data-estado", "descartado");
  expect((await cargoDe(await idDeCliente("Clínica Gamma"))).estado).toBe("pagado");
  expect(await contar("select 1 from collection_statement_rows where company_id = $1 and concepto like '''=HYPERLINK%' and estado = 'descartado'", [EMPRESA()])).toBe(1);

  // Santander (Excel): el depósito con la clave de rastreo del pago a mano ya estaba registrado.
  forma = await subir("santander", "santander-movimientos.xlsx", santander, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  await expect(page.getByRole("heading", { name: "Empata las columnas de Santander" })).toBeVisible();
  await dobleClic(forma.getByRole("button", { name: "Guardar el empate y ver las propuestas" }), { esperar: /importacion=.*nuevos=2/ });
  await expect(propuesta(1_000_000)).toHaveAttribute("data-propuesta", "ya_registrado");
  await expect(propuesta(82_050)).toHaveAttribute("data-propuesta", "por_conciliar");
  await foto(page, browserName, "propuestas-santander");
  await confirmar();
  expect(await contar("select 1 from collection_payments where company_id = $1 and clave_rastreo = $2", [EMPRESA(), RASTREO_A])).toBe(1);

  // Volver a subir el de BBVA, ahora como si fuera de Banorte: el mismo archivo se frena por su huella,
  // con el banco y el empate que sea (r63-N1), y nada se duplica.
  const filas = await contar("select 1 from collection_statement_rows where company_id = $1", [EMPRESA()]);
  const pagos = await contar("select 1 from collection_payments where company_id = $1", [EMPRESA()]);
  forma = await subir("banorte", "bbva-movimientos.csv", bbva, "text/csv");
  await expect(forma.locator("#archivo-error")).toHaveText(/^Ese archivo ya se importó el \d{1,2} de [a-z]+ de \d{4}\. Sus abonos ya están en la lista; no se volvieron a aplicar\.$/);
  await expect(forma.locator("#archivo")).toHaveAttribute("aria-invalid", "true");
  expect(await contar("select 1 from collection_statement_rows where company_id = $1", [EMPRESA()])).toBe(filas);
  expect(await contar("select 1 from collection_payments where company_id = $1", [EMPRESA()])).toBe(pagos);
  expect(await contar("select 1 from collection_statement_mappings where company_id = $1", [EMPRESA()])).toBe(3);
  expect(await contar("select 1 from audit_log where company_id = $1 and accion = 'confirmar_estado_cuenta'", [EMPRESA()])).toBe(3);
  await foto(page, browserName, "resubir-sin-duplicar");
  expect(reales(errores, browserName)).toEqual([]);
});

test("7 · por conciliar: aplicar a un cargo, revertir y anular un pago", async ({ page, context, browserName }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_COBRANZA.carla);
  const alfa = await idDeCliente("Colegio Alfa");
  await page.goto(en(`/consola/cobros/clientes/${alfa}`));
  await page.getByRole("button", { name: "Cargo único" }).click();
  const dialogo = page.getByRole("dialog", { name: "Cargo único" });
  await dialogo.getByLabel("Concepto").fill("Ajuste de noviembre");
  await dialogo.getByLabel("Monto").fill("3333.33");
  await dialogo.getByLabel("Vence").fill(desplazar(hoy(), 10));
  await dobleClic(dialogo.getByRole("button", { name: "Emitir el cargo" }));
  const ajuste = await cargoDe(alfa, "Ajuste de noviembre");
  expect(ajuste).toMatchObject({ estado: "emitido", monto: 333_333 });

  // El depósito de BBVA sin referencia está en «Por conciliar»; se aplica al cargo del mismo monto.
  await page.goto(en("/consola/cobros?vista=conciliar"));
  const [libre] = await consultar<{ id: string }>("select id from collection_payments where company_id = $1 and monto_centavos = 333333", [EMPRESA()]);
  const tarjeta = page.locator(`[data-pago="${libre!.id}"]`);
  await expect(tarjeta.getByRole("combobox", { name: "Aplicar a" })).toHaveValue(ajuste.id);
  await foto(page, browserName, "por-conciliar");
  const { envios } = await dobleClic(tarjeta.getByRole("button", { name: "Aplicar" }));
  expect(envios).toBe(1);
  await expect(tarjeta).toHaveCount(0);
  expect((await cargoDe(alfa, "Ajuste de noviembre")).estado).toBe("pagado");

  // Revertir desde la ficha: el cargo vuelve a deber y el pago queda libre.
  await page.goto(en(`/consola/cobros/clientes/${alfa}`));
  const pago = page.locator(`[data-pago="${libre!.id}"]`);
  await pago.getByRole("button", { name: "Revertir" }).click();
  const revertir = page.getByRole("dialog", { name: "Revertir la aplicación" });
  await revertir.getByLabel("Motivo").fill("Era de otro cliente.");
  await dobleClic(revertir.getByRole("button", { name: "Revertir" }));
  await expect(pago).toContainText("revertida");
  expect((await cargoDe(alfa, "Ajuste de noviembre")).estado).toBe("emitido");
  expect(await contar("select 1 from collection_payments where id = $1 and estado = 'abierto'", [libre!.id])).toBe(1);

  // Un pago registrado por error se anula con su motivo.
  await page.goto(en("/consola/cobros?vista=conciliar"));
  await page.getByRole("button", { name: "Registrar un pago sin cargo" }).click();
  const sinCargo = page.getByRole("dialog", { name: "Registrar un pago" });
  await sinCargo.getByLabel("Monto que llegó").fill("500");
  await dobleClic(sinCargo.getByRole("button", { name: "Registrar el pago" }));
  const [error] = await consultar<{ id: string }>("select id from collection_payments where company_id = $1 and monto_centavos = 50000 and fuente = 'manual'", [EMPRESA()]);
  const tarjetaError = page.locator(`[data-pago="${error!.id}"]`);
  await tarjetaError.getByRole("button", { name: "Anular" }).click();
  const anular = page.getByRole("dialog", { name: "Anular el pago" });
  await anular.getByLabel("Motivo").fill("Se capturó dos veces.");
  await dobleClic(anular.getByRole("button", { name: "Anular el pago" }));
  expect(await contar("select 1 from collection_payments where id = $1 and estado = 'anulado'", [error!.id])).toBe(1);
  expect(await contar("select 1 from audit_log where identificador = $1 and accion = 'anular_pago_cobranza'", [error!.id])).toBe(1);
  expect(reales(errores, browserName)).toEqual([]);
});

test("8 · plan: pausar, reanudar, editar el monto y cancelar", async ({ page, context, browserName }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_COBRANZA.carla);
  const gamma = await idDeCliente("Clínica Gamma");
  await page.goto(en(`/consola/cobros/clientes/${gamma}`));
  await dobleClic(page.getByRole("button", { name: "Pausar" }));
  await expect(page.locator("[data-plan]")).toContainText("En pausa.");
  await dobleClic(page.getByRole("button", { name: "Reanudar desde hoy" }));
  await expect(page.locator("[data-plan]")).not.toContainText("En pausa.");

  await page.getByRole("button", { name: "Editar plan" }).click();
  const editar = page.getByRole("dialog", { name: "Editar el plan" });
  await editar.getByLabel(/Monto/).fill("4800");
  await dobleClic(editar.getByRole("button", { name: "Guardar" }));
  await expect(page.locator("[data-plan]")).toContainText("$4,800.00");
  expect(await contar("select 1 from collection_plans where customer_id = $1 and monto_centavos = 480000", [gamma])).toBe(1);

  await page.getByRole("button", { name: "Cancelar plan" }).click();
  const cancelar = page.getByRole("dialog", { name: "Cancelar el plan" });
  await cancelar.getByLabel("Motivo").fill("El cliente se fue a otro proveedor.");
  await dobleClic(cancelar.getByRole("button", { name: "Cancelar el plan" }));
  await expect(page.getByText("Sin plan vivo.")).toBeVisible();
  for (const accion of ["pausar_plan_cobranza", "reanudar_plan_cobranza", "editar_plan_cobranza", "cancelar_plan_cobranza"]) {
    expect(await contar("select 1 from audit_log a join collection_plans p on p.id = a.identificador where p.customer_id = $1 and a.accion = $2", [gamma, accion]), accion).toBe(1);
  }
  await foto(page, browserName, "plan-cancelado");
  expect(reales(errores, browserName)).toEqual([]);
});

test("9 · tarea diaria: sin CRON_SECRET no abre; dos corridas el mismo día no mandan nada nuevo", async ({ request }) => {
  expect((await request.get(`${ORIGEN}/tareas/cobranza`)).status()).toBe(401);
  expect((await request.get(`${ORIGEN}/tareas/cobranza`, { headers: { authorization: "Bearer otro" } })).status()).toBe(401);
  const secreto = requerida("CRON_SECRET");
  const correosAntes = (await contar("select 1 from collection_emails where company_id = $1", [EMPRESA()]));
  const primera = await request.get(`${ORIGEN}/tareas/cobranza`, { headers: { authorization: `Bearer ${secreto}` } });
  expect(primera.status()).toBe(200);
  const segunda = await request.get(`${ORIGEN}/tareas/cobranza`, { headers: { authorization: `Bearer ${secreto}` } });
  expect(segunda.status()).toBe(200);
  const cuerpo = await segunda.json() as { cargos: number; correos: Record<string, number> };
  expect(cuerpo.cargos).toBe(0);
  expect(cuerpo.correos.enviado ?? 0).toBe(0);
  expect(await contar("select 1 from collection_emails where company_id = $1", [EMPRESA()])).toBe(correosAntes);
});

test("10 · demostración: el correo queda simulado y el depósito simulado se aplica solo", async ({ page, context, browserName }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_COBRANZA.dario);
  await page.goto(en("/consola/cobros/configuracion", DEMO()));
  await expect(page.locator('[data-deteccion="demo"]')).toBeVisible();
  const forma = page.locator('form[data-formulario="configuracion-cobranza"]');
  await forma.locator("#clabe").fill(CLABE);
  await forma.locator("#correoContacto").fill("demo@ejemplo.mx");
  await dobleClic(forma.getByRole("button", { name: "Guardar la configuración" }));
  await expect(forma.locator(".alerta-asentado")).toBeVisible();

  await page.goto(en("/consola/cobros/nuevo", DEMO()));
  const alta = page.locator('form[data-formulario="alta-cliente"]');
  await alta.locator("#nombre").fill("Cliente de Muestra");
  await alta.locator("#correos").fill("muestra-demo@ejemplo.mx");
  await alta.locator("#concepto").fill("Servicio mensual");
  await alta.locator("#monto").fill("2500");
  await alta.locator("#primerVencimiento").fill(desplazar(hoy(), 2));
  await dobleClic(alta.getByRole("button", { name: "Dar de alta y cobrar" }), { esperar: /\?alta=simulado$/ });
  await expect(page.getByText("Empresa de demostración: el correo quedó simulado y no salió.")).toBeVisible();
  expect(correosPara("muestra-demo@ejemplo.mx")).toHaveLength(0);

  const cliente = await idDeCliente("Cliente de Muestra", DEMO());
  const cargo = await cargoDe(cliente);
  await page.locator(`tr[data-cargo="${cargo.id}"]`).getByRole("button", { name: "Simular abono" }).click();
  const simular = page.getByRole("dialog", { name: "Simular un abono" });
  const { envios } = await dobleClic(simular.getByRole("button", { name: "Simular el abono" }));
  expect(envios).toBe(1);
  await expect(page.locator(`tr[data-cargo="${cargo.id}"]`)).toHaveAttribute("data-estado", "pagado");
  expect(await contar("select 1 from collection_payments where company_id = $1 and fuente = 'demo' and estado = 'aplicado'", [DEMO()])).toBe(1);
  await foto(page, browserName, "demostracion");
  expect(reales(errores, browserName)).toEqual([]);
});

test("11 · el contador ve la cobranza pero no la cambia", async ({ page, context, browserName }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS.diego);
  const altamar = requerida("E2E_ALTAMAR_ID");
  await page.goto(en("/consola/cobros", altamar));
  await expect(page.getByText("Tu rol puede ver la cobranza. La cambian administración o finanzas.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Nuevo cliente" })).toHaveCount(0);
  await expect(page.locator('form[data-formulario="cobro"]')).toHaveCount(0);
  await page.goto(en("/consola/cobros/nuevo", altamar));
  await expect(page.locator('form[data-formulario="alta-cliente"]')).toHaveCount(0);
  await expect(page.getByText("Dan de alta clientes administración o finanzas.")).toBeVisible();
  // Un cliente de otra empresa no abre ni escribiendo la dirección.
  const alfa = await idDeCliente("Colegio Alfa");
  expect((await page.goto(en(`/consola/cobros/clientes/${alfa}`, altamar)))?.status()).toBe(404);
  expect(reales(errores, browserName)).toEqual([]);
});

test("12 · evidencia: 3 temas × 1440 y 390, axe sin violaciones y sin desplazamiento horizontal", async ({ browser, browserName }) => {
  test.skip(!EVIDENCIA, "Solo con E2E_CAPTURAS (evidencia local).");
  // axe-core ya viene en node_modules (eslint-plugin-jsx-a11y); solo se usa en la evidencia local.
  const axe = readFileSync(join(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8");
  const alfa = await idDeCliente("Colegio Alfa");
  const [enlace] = correosPara("pagos-gamma@ejemplo.mx");
  const paginas: [string, string][] = [
    ["lista", en("/consola/cobros")],
    ["ficha", en(`/consola/cobros/clientes/${alfa}`)],
    ["alta", en("/consola/cobros/nuevo")],
    ["estado-de-cuenta", en("/consola/cobros/estado-de-cuenta")],
    ["configuracion", en("/consola/cobros/configuracion")],
    ["pagador", enlaceDe(enlace!, /\/pagar\//)],
  ];
  const hallazgos: string[] = [];
  for (const tema of ["claro", "oscuro", "lever"]) {
    for (const ancho of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width: ancho, height: ancho === 390 ? 844 : 1000 }, javaScriptEnabled: true, ignoreHTTPSErrors: ORIGEN.startsWith("https:") });
      try {
        await entrar(context, CORREOS_COBRANZA.carla, tema);
        const page = await context.newPage();
        for (const [nombre, url] of paginas) {
          const respuesta = await page.goto(url);
          expect(respuesta?.status(), `${nombre} ${tema} ${ancho}`).toBe(200);
          await page.waitForLoadState("networkidle");
          const desborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          if (desborde > 0) hallazgos.push(`${nombre} ${tema} ${ancho}: desborde ${desborde}px`);
          await page.addScriptTag({ content: axe });
          const violaciones = await page.evaluate(async () => {
            const r = await (window as unknown as { axe: { run: (c: object, o: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } })
              .axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
            return r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`);
          });
          for (const v of violaciones) hallazgos.push(`${nombre} ${tema} ${ancho}: ${v}`);
          // Las fotos de la matriz, solo de Chromium; WebKit corre la misma revisión de axe y desborde.
          if (browserName === "chromium") {
            mkdirSync(EVIDENCIA, { recursive: true });
            await page.screenshot({ path: join(EVIDENCIA, `tema-${tema}-${ancho}-${nombre}.jpg`), fullPage: true, type: "jpeg", quality: 70 });
          }
        }
      } finally {
        await context.close();
      }
    }
  }
  expect(hallazgos).toEqual([]);
});

test("13 · pagado desde la cuenta de otro cliente: se aplica a su cargo con la marca visible (r63-N4)", async ({ page, context, browserName }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_COBRANZA.carla);
  await darDeAlta(page, { nombre: "Grupo Uno", correo: "grupo-uno@ejemplo.mx", concepto: "Mantenimiento", tipo: "fijo", monto: "1000", periodicidad: "mensual", dias: 5 });
  await darDeAlta(page, { nombre: "Filial Dos", correo: "filial-dos@ejemplo.mx", concepto: "Mantenimiento", tipo: "fijo", monto: "1000", periodicidad: "mensual", dias: 5 });
  const uno = await idDeCliente("Grupo Uno");
  const dos = await idDeCliente("Filial Dos");
  const [refUno, refDos] = [(await cargoDe(uno)).referencia, (await cargoDe(dos)).referencia];
  // El servidor de la prueba corre sin llaves de Fintoc (no sale nada a api.fintoc.com): el aviso firmado pasa por
  // atenderAviso, la misma función de /webhooks/fintoc, con un secreto generado al vuelo.
  const cuenta = "acc_E2eMarca01";
  try {
    await registrarCuentaFintoc(await contextoDePersonal("personal-e2e@ejemplo.mx"), { empresaId: EMPRESA(), cuentaId: cuenta });
    const config: ConfigFintoc = { llaveSecreta: `sk_test_${randomUUID().replace(/-/g, "")}`, secretoWebhook: createHash("sha256").update(randomUUID()).digest("hex"), modo: "test" };
    const ahora = Math.floor(Date.now() / 1000);
    const avisar = (referencia: string, monto: number, rastreo: string) => {
      const cuerpo = JSON.stringify({
        id: `evt_${randomUUID().replace(/-/g, "")}`, type: "transfer.inbound.succeeded", object: "event", mode: "test", created_at: new Date().toISOString(),
        data: {
          id: `tr_${randomUUID().replace(/-/g, "")}`, object: "transfer", direction: "inbound", status: "succeeded", amount: monto, currency: "MXN", mode: "test",
          transaction_date: new Date().toISOString(), reference_id: referencia, tracking_key: rastreo,
          account_number: { id: "acno_PrincipalE2e01", account_id: cuenta },
          counterparty: { holder_name: "Corporativo Pagador", account_number: "012180001234567899", account_type: "clabe" },
        },
      });
      return atenderAviso(new TextEncoder().encode(cuerpo), firmar(cuerpo, config.secretoWebhook, ahora), { config, ahora: () => new Date(ahora * 1000), auditar });
    };
    // La misma CLABE paga primero por Uno y luego manda la referencia de Dos.
    expect(await avisar(refUno, 30_000, "XMARCA0001")).toEqual({ estado: 200, cuerpo: { ok: true, efecto: "registrado" } });
    expect(await avisar(refDos, 20_000, "XMARCA0002")).toEqual({ estado: 200, cuerpo: { ok: true, efecto: "registrado" } });
  } finally {
    await cerrarConexion();
  }
  expect(await consultar("select clave_rastreo, estado, customer_id, de_otro_cliente from collection_payments where company_id = $1 and clave_rastreo like 'XMARCA%' order by clave_rastreo", [EMPRESA()]))
    .toEqual([
      { clave_rastreo: "XMARCA0001", estado: "aplicado", customer_id: uno, de_otro_cliente: false },
      { clave_rastreo: "XMARCA0002", estado: "aplicado", customer_id: dos, de_otro_cliente: true },
    ]);

  await page.goto(en(`/consola/cobros/clientes/${dos}`));
  const marca = page.locator('[data-lista="pagos"] [data-marca="otro-cliente"]');
  await expect(marca).toHaveCount(1);
  await expect(marca).toHaveText("Pagado desde la cuenta de otro cliente");
  await foto(page, browserName, "pagado-desde-otro-cliente");
  await page.goto(en(`/consola/cobros/clientes/${uno}`));
  await expect(page.locator('[data-lista="pagos"] li').first()).toBeVisible();
  await expect(page.locator('[data-marca="otro-cliente"]')).toHaveCount(0);
  expect(reales(errores, browserName)).toEqual([]);
});

test("14 · registrar un pago con el cargo de otra empresa dice «No encontrado» (r63-N10)", async ({ page, context, browserName }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_COBRANZA.carla);
  const [ajeno] = await consultar<{ id: string }>("select id from collection_charges where company_id = $1 limit 1", [DEMO()]);
  expect(ajeno).toBeTruthy();
  const pagos = await contar("select 1 from collection_payments");
  await page.goto(en(`/consola/cobros/clientes/${await idDeCliente("Grupo Uno")}`));
  await page.getByRole("button", { name: "Registrar pago" }).first().click();
  const dialogo = page.getByRole("dialog", { name: "Registrar un pago" });
  // El id del cargo viaja en un campo oculto: se cambia por el de un cargo de la empresa de demostración.
  await dialogo.locator('input[name="cargoId"]').evaluate((el: HTMLInputElement, id: string) => { el.value = id; }, ajeno!.id);
  await dialogo.getByLabel("Monto que llegó").fill("10.00");
  await dialogo.getByRole("button", { name: "Registrar el pago" }).click();
  await expect(dialogo.getByText("No encontrado", { exact: true })).toBeVisible();
  await expect(dialogo.getByText("Recarga la lista.")).toBeVisible();
  await expect(dialogo.getByText("Ese cargo ya cambió")).toHaveCount(0);
  expect(await contar("select 1 from collection_payments")).toBe(pagos);
  await foto(page, browserName, "pago-con-cargo-ajeno");
  expect(reales(errores, browserName)).toEqual([]);
});

test("15 · cambiar el correo de contacto pide un segundo factor reciente y avisa al equipo (r63-N3)", async ({ page, context, browserName }) => {
  const errores = vigilar(page);
  const nuevo = "buzon-cobranza@ejemplo.mx";
  const guardar = async () => {
    await page.goto(en("/consola/cobros/configuracion"));
    const forma = page.locator('form[data-formulario="configuracion-cobranza"]');
    await expect(forma.locator("#correoContacto")).toHaveValue("cobranza@ejemplo.mx");
    await forma.locator("#correoContacto").fill(nuevo);
    await forma.getByRole("button", { name: "Guardar la configuración" }).click();
    return forma;
  };
  // Con el factor de hace 31 minutos no se guarda: «Confirma que eres tú».
  await sesionDe(context, CORREOS_COBRANZA.carla, { factorHaceMinutos: 31 });
  const avisosAntes = correosPara(CORREOS_COBRANZA.carla).length;
  let forma = await guardar();
  await expect(forma.getByText("Confirma que eres tú")).toBeVisible();
  await expect(forma.getByText(/correo de contacto exige un segundo factor de los últimos 30 minutos/)).toBeVisible();
  expect(await contar("select 1 from collection_settings where company_id = $1 and correo_contacto = $2", [EMPRESA(), nuevo])).toBe(0);
  expect(correosPara(CORREOS_COBRANZA.carla).length).toBe(avisosAntes);
  await foto(page, browserName, "contacto-pide-factor");
  // Con el factor recién probado se guarda y avisa a administración y finanzas.
  await entrar(context, CORREOS_COBRANZA.carla);
  forma = await guardar();
  await expect(forma.locator(".alerta-asentado")).toContainText("Avisamos del cambio a administración y finanzas");
  expect(await contar("select 1 from collection_settings where company_id = $1 and correo_contacto = $2", [EMPRESA(), nuevo])).toBe(1);
  const avisos = correosPara(CORREOS_COBRANZA.carla);
  expect(avisos.length).toBe(avisosAntes + 1);
  expect(avisos.at(-1)!.asunto).toMatch(/correo de contacto/i);
  expect(avisos.at(-1)!.texto).toContain(nuevo);
  await foto(page, browserName, "contacto-guardado-y-avisado");
  expect(reales(errores, browserName)).toEqual([]);
});

test("16 · el mismo depósito a mano y en el estado de cuenta: posible duplicado en «Por conciliar», se descarta o se aplica (r63b-N1)", async ({ page, context, browserName }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_COBRANZA.carla);
  const alfa = await idDeCliente("Colegio Alfa");
  // Un cargo de 2,468.00: le queda saldo después del primer pago, que es cuando el código anterior aplicaba doble.
  await page.goto(en(`/consola/cobros/clientes/${alfa}`));
  await page.getByRole("button", { name: "Cargo único" }).click();
  const unico = page.getByRole("dialog", { name: "Cargo único" });
  await unico.getByLabel("Concepto").fill("Duplicado entre fuentes");
  await unico.getByLabel("Monto").fill("2468.00");
  await unico.getByLabel("Vence").fill(desplazar(hoy(), 10));
  await dobleClic(unico.getByRole("button", { name: "Emitir el cargo" }));
  const cargo = await cargoDe(alfa, "Duplicado entre fuentes");

  // Carla registra a mano el depósito de 1,234.00 que vio en el banco: se aplica.
  await page.goto(en("/consola/cobros"));
  await page.locator(`table[data-tabla="cargos"] tr[data-cargo="${cargo.id}"]`).getByRole("button", { name: "Registrar pago" }).click();
  const dialogo = page.getByRole("dialog", { name: "Registrar un pago" });
  await dialogo.getByLabel("Monto que llegó").fill("1234.00");
  await dobleClic(dialogo.getByRole("button", { name: "Registrar el pago" }));
  const [manual] = await consultar<{ id: string }>("select id from collection_payments where company_id = $1 and fuente = 'manual' and monto_centavos = 123400", [EMPRESA()]);
  expect((await cargoDe(alfa, "Duplicado entre fuentes")).estado).toBe("emitido");

  // Luego sube el estado de cuenta de BBVA con ese mismo depósito (y otro igual, con otro concepto): ninguno se aplica solo.
  const fecha = hoy().split("-").reverse().join("/");
  const csv = [
    "BBVA México · Movimientos de la cuenta (ARCHIVO FICTICIO DE PRUEBA)", "Cuenta;0123456789", `Periodo;${fecha} al ${fecha}`, "",
    "Día;Concepto / Referencia;Cargo;Abono;Saldo",
    `${fecha};SPEI RECIBIDO REF ${cargo.referencia} COLEGIO ALFA;;1,234.00;110,000.00`,
    `${fecha};SPEI RECIBIDO REF ${cargo.referencia} SEGUNDO DEPOSITO;;1,234.00;111,234.00`,
  ].join("\r\n");
  await page.goto(en("/consola/cobros/estado-de-cuenta"));
  const forma = page.locator('form[data-formulario="estado-de-cuenta"]');
  await forma.locator("#banco").selectOption("bbva");
  await forma.locator("#archivo").setInputFiles({ name: "bbva-duplicado.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "latin1") });
  await dobleClic(forma.getByRole("button", { name: "Subir y ver las propuestas" }), { esperar: /importacion=.*nuevos=2/ });
  const renglones = page.locator('table[data-tabla="propuestas"] tbody tr');
  await expect(renglones).toHaveCount(2);
  for (const r of await renglones.all()) {
    await expect(r).toHaveAttribute("data-propuesta", "por_conciliar");
    await expect(r.locator("[data-parecido]")).toContainText("Posible duplicado: ya está registrado a mano");
  }
  await foto(page, browserName, "duplicado-propuesta");
  await dobleClic(page.locator('form[data-formulario="confirmar-estado-de-cuenta"]').getByRole("button", { name: "Confirmar la importación" }));
  await expect(page.getByText("La importación quedó confirmada: 2 en «Por conciliar».")).toBeVisible();
  expect(await contar("select 1 from collection_applications where charge_id = $1 and regla <> 'reversion'", [cargo.id])).toBe(1);

  // En «Por conciliar» cada uno dice a qué pago se parece.
  const dobles = await consultar<{ id: string }>(
    "select id from collection_payments where company_id = $1 and fuente = 'estado_cuenta' and monto_centavos = 123400 and posible_duplicado and parecido_a = $2 order by id_externo",
    [EMPRESA(), manual!.id],
  );
  expect(dobles).toHaveLength(2);
  await page.goto(en("/consola/cobros?vista=conciliar"));
  const [mismo, otro] = dobles.map((d) => page.locator(`[data-pago="${d.id}"]`));
  for (const tarjeta of [mismo!, otro!]) {
    await expect(tarjeta).toContainText("Posible duplicado");
    await expect(tarjeta.locator(`[data-parecido="${manual!.id}"]`)).toContainText("Parece el mismo depósito que: Registrado a mano");
  }
  await foto(page, browserName, "duplicado-por-conciliar");
  // El primero es el mismo depósito: se descarta con su motivo.
  await mismo!.getByRole("button", { name: "Descartar" }).click();
  const descartar = page.getByRole("dialog", { name: "Descartar el posible duplicado" });
  await descartar.getByLabel("Motivo").fill("Es el depósito que ya registré a mano.");
  await dobleClic(descartar.getByRole("button", { name: "Descartar el duplicado" }));
  await expect(page.getByText("El posible duplicado quedó descartado con su motivo")).toBeVisible();
  expect(await contar("select 1 from collection_payments where id = $1 and estado = 'anulado'", [dobles[0]!.id])).toBe(1);
  expect(await contar("select 1 from audit_log where identificador = $1 and accion = 'descartar_duplicado_cobranza' and cambio->>'parecido_a' = $2", [dobles[0]!.id, manual!.id])).toBe(1);
  // El segundo sí fue otro depósito: Carla lo aplica al cargo, que queda pagado.
  await expect(otro!.getByRole("combobox", { name: "Aplicar a" })).toHaveValue(cargo.id);
  await dobleClic(otro!.getByRole("button", { name: "Aplicar" }));
  await expect(otro!).toHaveCount(0);
  expect((await cargoDe(alfa, "Duplicado entre fuentes")).estado).toBe("pagado");
  expect(await contar("select 1 from collection_applications where charge_id = $1 and regla <> 'reversion'", [cargo.id])).toBe(2);
  // Y queda en el historial del cliente.
  await page.goto(en(`/consola/cobros/clientes/${alfa}`));
  await expect(page.getByText("Posible duplicado descartado").first()).toBeVisible();
  await foto(page, browserName, "duplicado-resuelto");
  expect(reales(errores, browserName)).toEqual([]);
});

test("17 · sin JavaScript la configuración se guarda por POST: la CLABE, el beneficiario y el contacto no van en la dirección (r63b-N2)", async ({ browser, browserName }) => {
  const contexto = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: ORIGEN.startsWith("https:") });
  const page = await contexto.newPage();
  await entrar(contexto, CORREOS_COBRANZA.carla);
  const nuevo = "sin-javascript@ejemplo.mx";
  const metodos: string[] = [];
  page.on("request", (r) => { if (r.isNavigationRequest()) metodos.push(`${r.method()} ${new URL(r.url()).search}`); });
  await page.goto(en("/consola/cobros/configuracion"));
  const forma = page.locator('form[data-formulario="configuracion-cobranza"]');
  await expect(forma).toHaveAttribute("method", /^post$/i);
  await forma.locator("#correoContacto").fill(nuevo);
  await forma.locator("#beneficiario").fill("Cobranza E2E SA de CV");
  await Promise.all([page.waitForLoadState("load"), forma.getByRole("button", { name: "Guardar la configuración" }).click()]);
  await expect(page.locator(".alerta-asentado")).toBeVisible();
  const direccion = page.url();
  for (const dato of [CLABE, "correoContacto", "beneficiario", encodeURIComponent(nuevo), nuevo]) expect(direccion).not.toContain(dato);
  expect(metodos.at(-1)).toBe("POST ");
  expect(await contar("select 1 from collection_settings where company_id = $1 and correo_contacto = $2", [EMPRESA(), nuevo])).toBe(1);
  if (EVIDENCIA) {
    mkdirSync(EVIDENCIA, { recursive: true });
    fotos += 1;
    await page.screenshot({ path: join(EVIDENCIA, `${browserName}-${String(fotos).padStart(2, "0")}-sin-javascript-configuracion.jpg`), fullPage: true, type: "jpeg", quality: 70 });
  }
  await contexto.close();
});

test("18 · CSP estricta: las pantallas de cobranza y la del pagador, sin JavaScript, con su nonce y 0 anotaciones de la política", async ({ browser }) => {
  // Con JavaScript las recorre csp.spec (todas las rutas del registro) y cada prueba de este archivo vigila la consola.
  const alfa = await idDeCliente("Colegio Alfa");
  const [cobro] = correosPara("pagos-alfa@ejemplo.mx");
  const sesion = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: ORIGEN.startsWith("https:") });
  const sinSesion = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: ORIGEN.startsWith("https:") });
  await entrar(sesion, CORREOS_COBRANZA.carla);
  const casos: [BrowserContext, string][] = [
    ...["/consola/cobros", "/consola/cobros?vista=conciliar", "/consola/cobros/nuevo", `/consola/cobros/clientes/${alfa}`, "/consola/cobros/configuracion", "/consola/cobros/estado-de-cuenta"]
      .map((ruta): [BrowserContext, string] => [sesion, en(ruta)]),
    [sinSesion, new URL(enlaceDe(cobro!, /\/pagar\//)).pathname],
  ];
  for (const [contexto, ruta] of casos) {
    const pagina = await contexto.newPage();
    const anotadas: string[] = [];
    pagina.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) anotadas.push(m.text().slice(0, 200)); });
    const respuesta = await pagina.goto(ruta);
    expect(respuesta?.status(), ruta).toBe(200);
    const politica = respuesta?.headers()["content-security-policy"] ?? "";
    expect(politica, ruta).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    const nonce = politica.match(/'nonce-([A-Za-z0-9+/=]+)'/)![1];
    const etiquetas = [...(await respuesta!.text()).matchAll(/<(?:script|style)\b[^>]*>/g)].map((m) => m[0]);
    expect(etiquetas.filter((e) => !e.includes(`nonce="${nonce}"`)), ruta).toEqual([]);
    expect(anotadas, ruta).toEqual([]);
    await pagina.close();
  }
  await sesion.close();
  await sinSesion.close();
});

test("19 · a 390 y 360, el empate del estado de cuenta no desborda la página: la muestra se desplaza dentro de su región (r63g-N2)", async ({ browser, browserName }) => {
  // Sin confirmar: la importación queda pendiente y el empate no se guarda, así que cada ancho vuelve a pedirlo.
  const bbva = Buffer.from(readFileSync(join(FIXTURES, "bbva-movimientos.csv")).toString("latin1").replace("{{REF_B}}", "SIN-REFERENCIA"), "latin1");
  for (const ancho of [390, 360]) {
    const context = await browser.newContext({ viewport: { width: ancho, height: 844 }, ignoreHTTPSErrors: ORIGEN.startsWith("https:") });
    try {
      await entrar(context, CORREOS_COBRANZA.carla);
      const page = await context.newPage();
      const errores = vigilar(page);
      await page.goto(en("/consola/cobros/estado-de-cuenta"));
      const forma = page.locator('form[data-formulario="estado-de-cuenta"]');
      await forma.locator("#banco").selectOption("hsbc");
      await forma.locator("#archivo").setInputFiles({ name: "hsbc-movimientos.csv", mimeType: "text/csv", buffer: bbva });
      await forma.getByRole("button", { name: "Subir y ver las propuestas" }).click();
      await expect(page.getByRole("heading", { name: "Empata las columnas de HSBC" })).toBeVisible();
      const muestra = page.getByRole("region", { name: "Tabla de los primeros renglones del archivo", exact: true });
      const medidas = await muestra.evaluate((el) => ({
        pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        region: Math.round(el.getBoundingClientRect().right),
        desplaza: el.scrollWidth > el.clientWidth,
      }));
      expect(medidas.pagina, `desplazamiento horizontal de la página a ${ancho}`).toBe(0);
      expect(medidas.region, `la región cabe en la ventana a ${ancho}`).toBeLessThanOrEqual(ancho);
      expect(medidas.desplaza, "la muestra se desplaza dentro de su región").toBe(true);
      await muestra.focus();
      await expect(muestra).toBeFocused();
      // El WebKit de Playwright no desplaza una región enfocada con las flechas; Chromium sí, y ahí se comprueba.
      if (browserName === "chromium") {
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => muestra.evaluate((el) => el.scrollLeft), { message: "con el teclado se recorre a lo ancho" }).toBeGreaterThan(0);
      }
      await foto(page, browserName, `empatar-${ancho}`);
      expect(reales(errores, browserName)).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

function pesos(centavos: number): string {
  return `$${(centavos / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
