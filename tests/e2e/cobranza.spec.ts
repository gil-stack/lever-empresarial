import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

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

let fotos = 0;
async function foto(page: Page, browserName: string, nombre: string): Promise<void> {
  if (!EVIDENCIA) return;
  mkdirSync(EVIDENCIA, { recursive: true });
  fotos += 1;
  await page.screenshot({ path: join(EVIDENCIA, `${browserName}-${String(fotos).padStart(2, "0")}-${nombre}.jpg`), fullPage: true, type: "jpeg", quality: 70 });
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
  const errores = vigilarConsola(page);
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
  const errores = vigilarConsola(page);
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
    const erroresPagador = vigilarConsola(pagina);
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
  const errores = vigilarConsola(page);
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
  const errores = vigilarConsola(page);
  await entrar(context, CORREOS_COBRANZA.carla);
  await page.goto(en("/consola/cobros"));
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
  const errores = vigilarConsola(page);
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
  const errores = vigilarConsola(page);
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
  const errores = vigilarConsola(page);
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
  const errores = vigilarConsola(page);
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
  const errores = vigilarConsola(page);
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
  const errores = vigilarConsola(page);
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
              // El enlace del logotipo del marco compartido tiene un aria-label que no contiene su texto visible
              // (WCAG 2.5.3) en todas las páginas, no solo en cobranza; lo corrige el PR #60 (Ola 2b) y aquí no se toca.
              .axe.run({ exclude: [[".lateral-cabeza > .marca"], [".barra-movil > .marca"], [".arco-marca"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
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

function pesos(centavos: number): string {
  return `$${(centavos / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
