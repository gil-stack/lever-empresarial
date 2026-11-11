import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { Client } from "pg";

import { ORIGEN, consultar, contar, correos, dobleClic, sesionDe, vigilarConsola } from "./apoyo";
import { CORREOS_RUNWAY } from "./siembra-runway";

/**
 * Runway a 12 meses y alertas de caja, todo con clics: el runway conservador y
 * el esperado con cada tipo de movimiento, un pago grande que cruza el colchón
 * y manda un solo correo, la tarea dos veces sin repetirlo, la subida y el
 * cruce otra vez, el mínimo de meses con rechazo (con y sin JavaScript), la
 * tendencia con tres fotos, la empresa sin saldo, la real sin cifras de
 * ejemplo frente a la de demostración, y los permisos.
 *
 * Con E2E_CAPTURAS guarda la evidencia (capturas por navegador y la matriz de
 * 3 temas × 1440 y 390 con axe y desborde horizontal). En CI no se toman.
 */

test.describe.configure({ mode: "serial" });
test.use({ ignoreHTTPSErrors: ORIGEN.startsWith("https:") });

const EMPRESA = () => requerida("E2E_RUNWAY_ID");
const SIN_SALDO = () => requerida("E2E_RUNWAY_SIN_SALDO_ID");
const DEMO = () => requerida("E2E_RUNWAY_DEMO_ID");
const EVIDENCIA = process.env.E2E_CAPTURAS ?? "";
const AXE = readFileSync(join(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8");

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta ${nombre}: lo define tests/e2e/siembra-runway.ts.`);
  return valor;
}

const en = (ruta: string, empresa = EMPRESA()) => `/c/${empresa}${ruta}`;
const hoy = () => process.env.E2E_TODAY ?? new Date().toISOString().slice(0, 10);

function desplazar(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function lunesDe(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  return desplazar(fecha, -((d.getUTCDay() + 6) % 7));
}

async function entrar(context: BrowserContext, correo: string, tema?: string): Promise<void> {
  await sesionDe(context, correo);
  if (tema) await context.addCookies([{ name: "tema", value: tema, domain: new URL(ORIGEN).hostname, path: "/" }]);
}

/** Sin las precargas RSC que WebKit corta al navegar (ver tests/e2e/cobranza.spec.ts). */
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

/** La tarea como la llama el cron de Vercel. */
async function tarea(request: APIRequestContext): Promise<{ empresas: number; avisos: number; fotos: number; correos: Record<string, number> }> {
  const respuesta = await request.get(`${ORIGEN}/tareas/caja`, { headers: { authorization: `Bearer ${requerida("CRON_SECRET")}` } });
  expect(respuesta.status()).toBe(200);
  return (await respuesta.json()) as { empresas: number; avisos: number; fotos: number; correos: Record<string, number> };
}

const avisosPara = (correo: string) => correos().filter((c) => c.para.includes(correo) && c.asunto.startsWith("Aviso de caja"));

/** Los pesos de una celda o de un renglón: «$1,234.50» → 123450. */
function centavosDe(texto: string): number {
  const limpio = texto.replace(/[^0-9.-]/g, "");
  return Math.round(Number(limpio) * 100);
}

async function estado(): Promise<{ bajo_colchon: boolean; runway_bajo: boolean } | null> {
  const [fila] = await consultar<{ bajo_colchon: boolean; runway_bajo: boolean }>("select bajo_colchon, runway_bajo from cash_alert_states where company_id = $1", [EMPRESA()]);
  return fila ?? null;
}

async function registrarImpuesto(page: Page): Promise<void> {
  await page.goto(en("/consola/calendario"));
  const forma = page.locator('form[data-formulario="obligacion"]');
  await forma.locator('input[name="concepto"]').fill("Impuesto anual");
  await forma.locator('input[name="monto"]').fill("300000.00");
  await forma.locator('select[name="frecuencia"]').selectOption("anual");
  await forma.locator('input[name="proximaFecha"]').fill(desplazar(hoy(), 14));
  const { envios } = await dobleClic(forma.getByRole("button", { name: "Registrar la obligación" }));
  await expect(forma.locator(".alerta-asentado")).toBeVisible();
  expect(envios).toBe(1);
}

test("1 · runway a 12 meses con cada tipo de movimiento: conservador, esperado y lo que cuenta", async ({ page, context, browserName }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_RUNWAY.rita);
  await page.goto(en("/consola/flujo"));
  const conservador = page.locator('[data-cifra="runway-conservador"]');
  const esperado = page.locator('[data-cifra="runway-esperado"]');
  await expect(conservador).toHaveAttribute("data-tipo", "agota");
  await expect(esperado).toHaveAttribute("data-tipo", "agota");
  const mesesC = Number(await conservador.getAttribute("data-meses"));
  const mesesE = Number(await esperado.getAttribute("data-meses"));
  // $463,000 de arranque (saldo, cobrado, esperados y emitidos menos el proveedor) contra $110,000 al mes: se agota al quinto mes.
  expect(mesesC).toBeGreaterThan(3);
  expect(mesesC).toBeLessThan(5);
  // Con los planes de cobranza estimados el dinero dura más; el conservador no los cuenta.
  expect(mesesE).toBeGreaterThan(mesesC);
  await expect(page.locator('[data-estado-alertas="ok"]')).toBeVisible();

  // Qué cuenta en 12 meses, cada tipo con su suma.
  const linea = (tipo: string) => page.locator(`[data-lista="runway-resumen"] li[data-tipo="${tipo}"] .cifra`);
  await expect(linea("nomina")).toHaveText("$960,000.00"); // 2 personas × $40,000.00 × 12 meses
  await expect(linea("proveedor")).toHaveText("$50,000.00");
  await expect(linea("obligacion")).toHaveText("$360,000.00"); // renta × 12
  await expect(linea("cobro")).toHaveText("$103,000.00"); // esperado $60,000 + cargo fijo $25,000 + variable capturado $18,000
  await expect(linea("cobrado")).toHaveText("$10,000.00");
  await expect(linea("plan_fijo")).toHaveText("$275,000.00"); // 11 periodos por generar × $25,000
  await expect(linea("plan_variable")).toHaveText("$198,000.00"); // 11 × promedio de su cargo capturado ($18,000)
  await expect(page.locator(`[data-lista="runway-resumen"] li[data-tipo="plan_fijo"] [data-origen="estimado"]`)).toBeVisible();
  await expect(page.locator('[data-lista="sin-historial"]')).toContainText("Plan Nuevo SA");

  // Mes por mes: 12 renglones y cada cierre = cierre anterior + entradas − salidas (conservador) y + estimado (esperado).
  const filas = page.locator('[data-tabla="runway-meses"] tbody tr');
  await expect(filas).toHaveCount(12);
  const [saldo] = await consultar<{ c: string }>("select saldo_centavos::text as c from cash_balance_declarations where company_id = $1", [EMPRESA()]);
  let cierre = Number(saldo!.c);
  let cierreEsperado = cierre;
  for (let i = 0; i < 12; i += 1) {
    const fila = filas.nth(i);
    const valor = async (nombre: string) => centavosDe(await fila.locator(`[data-cifra="${nombre}"]`).innerText());
    cierre += (await valor("entradas")) - (await valor("salidas"));
    cierreEsperado += (await valor("entradas")) + (await valor("estimadas")) - (await valor("salidas"));
    expect(await valor("cierre"), `cierre del mes ${i + 1}`).toBe(cierre);
    expect(await valor("cierre-esperado"), `cierre esperado del mes ${i + 1}`).toBe(cierreEsperado);
  }
  await foto(page, browserName, "runway-12-meses");

  // Inicio dice el mismo runway conservador (más allá de 13 semanas, en lugar del promedio).
  await page.goto(en("/consola"));
  const meses = mesesC.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  await expect(page.locator('[data-cifra="alcance"]')).toContainText(`runway de ${meses} meses`);
  expect(reales(errores, browserName)).toEqual([]);
});

test("2 · un pago grande cruza el colchón: un solo aviso por correo", async ({ page, context, browserName, request }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_RUNWAY.rita);
  // Una sola foto y una empresa real: estado vacío, nunca cifras de ejemplo.
  await page.goto(en("/consola/flujo"));
  await expect(page.getByText("La tendencia aparece desde la segunda foto semanal.")).toBeVisible();
  await expect(page.locator('[data-tendencia="ejemplo"]')).toHaveCount(0);

  await registrarImpuesto(page);
  await page.goto(en("/consola/flujo"));
  await expect(page.locator('[data-estado-alertas="bajo_colchon"]')).toBeVisible();
  expect(await estado()).toBeNull();

  const antes = { rita: avisosPara(CORREOS_RUNWAY.rita).length, fabio: avisosPara(CORREOS_RUNWAY.fabio).length };
  const corrida = await tarea(request);
  expect(corrida.avisos).toBeGreaterThanOrEqual(1);
  expect(await estado()).toEqual({ bajo_colchon: true, runway_bajo: true });
  expect(await contar("select 1 from cash_alerts where company_id = $1", [EMPRESA()])).toBe(1);
  expect(await contar("select 1 from cash_alerts where company_id = $1 and estado = 'enviado' and destinatarios = 2 and colchon and runway", [EMPRESA()])).toBe(1);
  expect(await contar("select 1 from cash_alert_deliveries where company_id = $1", [EMPRESA()])).toBe(2);
  expect(await contar("select 1 from cash_runway_snapshots where company_id = $1 and semana = $2", [EMPRESA(), lunesDe(hoy())])).toBe(1);
  // Un correo a administración y uno a finanzas; contaduría no lo encendió.
  expect(avisosPara(CORREOS_RUNWAY.rita).length).toBe(antes.rita + 1);
  expect(avisosPara(CORREOS_RUNWAY.fabio).length).toBe(antes.fabio + 1);
  expect(avisosPara(CORREOS_RUNWAY.cora)).toHaveLength(0);
  const aviso = avisosPara(CORREOS_RUNWAY.rita).at(-1)!;
  expect(aviso.asunto).toBe("Aviso de caja: debajo del colchón y runway corto · Runway E2E");
  expect(aviso.texto).toContain("Caja proyectada:");
  expect(aviso.texto).toContain("menos que tu mínimo de 3 meses");
  expect(aviso.idempotencia).toMatch(/^alerta-caja\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
  expect(await contar("select 1 from audit_log where company_id = $1 and accion = 'estado_alerta_caja'", [EMPRESA()])).toBe(1);

  await page.reload();
  await expect(page.locator('[data-estado-alertas="bajo_colchon"]')).toBeVisible();
  await expect(page.getByText(/Último aviso: .* colchón y runway · enviado\./)).toBeVisible();
  await foto(page, browserName, "aviso-enviado");
  expect(reales(errores, browserName)).toEqual([]);
});

test("3 · la tarea dos veces y dos a la vez: ni aviso ni correo ni foto nuevos", async ({ request }) => {
  expect((await request.get(`${ORIGEN}/tareas/caja`)).status()).toBe(401);
  expect((await request.get(`${ORIGEN}/tareas/caja`, { headers: { authorization: "Bearer otro" } })).status()).toBe(401);
  const antes = correos().length;
  const segunda = await tarea(request);
  const [tercera, cuarta] = await Promise.all([tarea(request), tarea(request)]);
  for (const corrida of [segunda, tercera, cuarta]) {
    expect(corrida.fotos).toBe(0);
    expect(corrida.correos.enviados).toBe(0);
  }
  expect(correos().length).toBe(antes);
  expect(await contar("select 1 from cash_alerts where company_id = $1", [EMPRESA()])).toBe(1);
  expect(await contar("select 1 from cash_runway_snapshots where company_id = $1", [EMPRESA()])).toBe(1);
});

test("4 · sube y vuelve a cruzar: avisa otra vez, una sola vez", async ({ page, context, browserName, request }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_RUNWAY.rita);
  // Sube: desactivar el impuesto apaga las dos alertas sin correo.
  await page.goto(en("/consola/calendario"));
  const fila = page.locator('[data-lista="obligaciones"] li', { hasText: "Impuesto anual" });
  await fila.getByRole("button", { name: "Desactivar" }).click();
  const dialogo = page.getByRole("dialog");
  const { envios } = await dobleClic(dialogo.getByRole("button", { name: "Desactivar" }));
  expect(envios).toBe(1);
  await expect(page.locator(".alerta-asentado")).toBeVisible();
  const antes = avisosPara(CORREOS_RUNWAY.rita).length;
  await tarea(request);
  expect(await estado()).toEqual({ bajo_colchon: false, runway_bajo: false });
  expect(avisosPara(CORREOS_RUNWAY.rita).length).toBe(antes);
  await page.goto(en("/consola/flujo"));
  await expect(page.locator('[data-estado-alertas="ok"]')).toBeVisible();

  // Vuelve a cruzar: el mismo pago otra vez → un aviso nuevo.
  await registrarImpuesto(page);
  await tarea(request);
  await tarea(request);
  expect(await estado()).toEqual({ bajo_colchon: true, runway_bajo: true });
  expect(await contar("select 1 from cash_alerts where company_id = $1", [EMPRESA()])).toBe(2);
  expect(avisosPara(CORREOS_RUNWAY.rita).length).toBe(antes + 1);
  expect(await contar("select 1 from audit_log where company_id = $1 and accion = 'estado_alerta_caja'", [EMPRESA()])).toBe(3);
  await page.goto(en("/consola/flujo"));
  await foto(page, browserName, "aviso-otra-vez");
  expect(reales(errores, browserName)).toEqual([]);
});

test("5 · mínimo de meses: rechazo con su campo, con JavaScript y sin él", async ({ page, context, browser, browserName }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_RUNWAY.rita);
  await page.goto(en("/consola/flujo"));
  const forma = page.locator('form[data-formulario="runway"]');
  const campo = forma.locator("#meses-minimos");
  await expect(campo).toHaveValue("3");
  await expect(page.locator('[data-minimo="3"]')).toContainText("sugerido");

  // Con JavaScript: 15 se rechaza, el campo queda marcado y conserva lo escrito.
  await campo.fill("15");
  const rechazo = await dobleClic(forma.getByRole("button", { name: "Guardar el mínimo" }));
  expect(rechazo.envios).toBe(1);
  await expect(forma.locator("#meses-minimos-error")).toHaveText("Escribe un número entero de meses, de 1 a 12.");
  await expect(campo).toHaveValue("15");
  await expect(campo).toHaveAttribute("aria-invalid", "true");
  await expect(campo).toBeFocused();
  expect(await contar("select 1 from cash_runway_settings where company_id = $1", [EMPRESA()])).toBe(0);
  await foto(page, browserName, "minimo-rechazo-js");

  // Sin JavaScript: el formulario va directo a la acción y la página regresa con el rechazo y lo escrito.
  const sinJs = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: ORIGEN.startsWith("https:") });
  try {
    await entrar(sinJs, CORREOS_RUNWAY.rita);
    const p = await sinJs.newPage();
    await p.goto(en("/consola/flujo"));
    const f = p.locator('form[data-formulario="runway"]');
    await f.locator("#meses-minimos").fill("dos");
    await Promise.all([p.waitForLoadState("load"), f.getByRole("button", { name: "Guardar el mínimo" }).click()]);
    await expect(p.locator("#meses-minimos-error")).toHaveText("Escribe un número entero de meses, de 1 a 12.");
    await expect(p.locator("#meses-minimos")).toHaveValue("dos");
    await expect(p.locator("#meses-minimos")).toHaveAttribute("aria-invalid", "true");
    expect(await contar("select 1 from cash_runway_settings where company_id = $1", [EMPRESA()])).toBe(0);
    await foto(p, browserName, "minimo-rechazo-sin-js");
    // Sin JavaScript también guarda.
    await p.locator("#meses-minimos").fill("5");
    await Promise.all([p.waitForLoadState("load"), p.locator('form[data-formulario="runway"]').getByRole("button", { name: "Guardar el mínimo" }).click()]);
    await expect(p.locator(".alerta-asentado")).toContainText("baje de 5 meses");
    expect(await contar("select 1 from cash_runway_settings where company_id = $1 and meses_minimos = 5", [EMPRESA()])).toBe(1);
  } finally {
    await sinJs.close();
  }

  // Con JavaScript, el valor bueno: una sola escritura y su evento.
  await page.reload();
  await campo.fill("4");
  const listo = await dobleClic(forma.getByRole("button", { name: "Guardar el mínimo" }));
  expect(listo.envios).toBe(1);
  await expect(forma.locator(".alerta-asentado")).toContainText("baje de 4 meses");
  expect(await contar("select 1 from cash_runway_settings where company_id = $1 and meses_minimos = 4", [EMPRESA()])).toBe(1);
  expect(await contar("select 1 from audit_log where company_id = $1 and accion = 'configurar_runway'", [EMPRESA()])).toBe(2);
  await page.reload();
  await expect(page.locator('[data-minimo="4"]')).not.toContainText("sugerido");
  expect(reales(errores, browserName)).toEqual([]);
});

test("6 · tendencia con tres fotos: barras, línea del mínimo y su tabla", async ({ page, context, browserName }) => {
  const errores = vigilar(page);
  // Las dos semanas anteriores, como si la tarea las hubiera tomado (la prueba no puede esperar dos lunes): con su
  // evento. La base solo admite la foto de esta semana o de la anterior (r64-base-N2); la dueña de la base desechable
  // las siembra sin disparadores.
  const semana = lunesDe(hoy());
  const duena = new Client({ connectionString: process.env.E2E_OWNER_DATABASE_URL });
  await duena.connect();
  // La más vieja llega al horizonte: la gráfica la describe igual que la tabla, «12 meses o más» (r64b-N2).
  for (const [dias, conservador, esperado] of [[-14, 53, 53], [-7, 30, 40]] as const) {
    await duena.query("begin");
    await duena.query("set local session_replication_role = replica");
    await duena.query(
      `with foto as (
         insert into cash_runway_snapshots (id, company_id, semana, semanas_conservador, semanas_esperado, horizonte_semanas, saldo_centavos, saldo_al_dia, colchon_centavos, meses_minimos)
         values (gen_random_uuid(), $1, $2::date, $3, $4, 53, 40000000, $2::date, 0, 3) returning id, company_id)
       insert into audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador, origen, cambio)
         select c.operator_id, c.id, 'sistema', 'cliente', 'foto_runway', 'cash_runway_snapshots', foto.id, 'tarea', jsonb_build_object('semana', $2::text)
           from foto join companies c on c.id = foto.company_id`,
      [EMPRESA(), desplazar(semana, dias), conservador, esperado],
    );
    await duena.query("commit");
  }
  await duena.end();
  expect(await contar("select 1 from cash_runway_snapshots where company_id = $1", [EMPRESA()])).toBe(3);
  await entrar(context, CORREOS_RUNWAY.rita);
  await page.goto(en("/consola/flujo"));
  const figura = page.locator('[data-tendencia="real"]');
  await expect(figura.locator(".runway-barras li")).toHaveCount(3);
  await expect(figura.locator('[role="img"]')).toHaveAttribute("aria-label", /últimas 3 semanas: de 12 meses o más la semana del .* Mínimo: 4 meses\./);
  await expect(figura.locator(".runway-barras li").first()).toHaveAttribute("title", /: 12 meses o más$/);
  await expect(figura.locator(".runway-minimo")).toBeAttached();
  await expect(figura.locator(".runway-leyenda")).toContainText("Tu mínimo: 4 meses");
  await page.getByText("Ver los datos en tabla").click();
  await expect(page.locator('[data-tabla="tendencia"] tbody tr')).toHaveCount(3);
  const filas = page.locator('[data-tabla="tendencia"] tbody tr');
  await expect(filas.first()).toContainText("12 meses o más");
  await expect(filas.nth(1)).toContainText("6.8 meses");
  await foto(page, browserName, "tendencia");
  // La red en tiempo de ejecución de la guardia tablas-desplazables (r63h-N1), en el CI: a 390, con la tabla de la tendencia
  // abierta, axe scrollable-region-focusable en Saldo y alertas (mes por mes, tendencia e historial) y en Inicio (flujo por semana).
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [nombre, url] of [["flujo", null], ["inicio", en("/consola")]] as const) {
    if (url) await page.goto(url);
    await page.evaluate(AXE);
    const marcas = await page.evaluate(async () => {
      const r = await (window as unknown as { axe: { run: (c: object, o: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } })
        .axe.run(document, { runOnly: { type: "rule", values: ["scrollable-region-focusable"] } });
      return r.violations.flatMap((v) => v.nodes.map((n) => n.target.join(" ")));
    });
    expect(marcas, `${nombre} a 390`).toEqual([]);
  }
  expect(reales(errores, browserName)).toEqual([]);
});

test("7 · empresa sin saldo declarado: sin runway, sin alertas, con lo comprometido", async ({ page, context, browserName, request }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_RUNWAY.sergio);
  await page.goto(en("/consola/flujo", SIN_SALDO()));
  await expect(page.locator('[data-cifra="runway-conservador"]')).toHaveText("Sin saldo declarado");
  await expect(page.locator('[data-cifra="runway-conservador"]')).toHaveAttribute("data-tipo", "sin_saldo");
  await expect(page.getByText("Sin saldo declarado no hay runway.")).toBeVisible();
  await expect(page.locator('[data-estado-alertas="sin_saldo"]')).toBeVisible();
  await expect(page.locator('[data-tabla="runway-meses"] [data-cifra="cierre"]').first()).toHaveText("Sin saldo");
  await tarea(request);
  expect(await contar("select 1 from cash_alert_states where company_id = $1", [SIN_SALDO()])).toBe(0);
  expect(await contar("select 1 from cash_runway_snapshots where company_id = $1", [SIN_SALDO()])).toBe(0);
  await page.goto(en("/consola", SIN_SALDO()));
  await expect(page.locator('[data-cifra="alcance"]')).toHaveText("Sin saldo declarado");
  await foto(page, browserName, "sin-saldo");
  expect(reales(errores, browserName)).toEqual([]);
});

test("8 · real sin cifras de ejemplo; demostración con ejemplo marcado y aviso simulado", async ({ page, context, browserName, request }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_RUNWAY.dora);
  await page.goto(en("/consola/flujo", DEMO()));
  await expect(page.locator('[data-ejemplo="tendencia"]')).toContainText("Ejemplo · demostración");
  await expect(page.locator('[data-tendencia="ejemplo"] .runway-barras li')).toHaveCount(8);
  await tarea(request);
  expect(await contar("select 1 from cash_alerts where company_id = $1 and estado = 'simulado'", [DEMO()])).toBe(1);
  expect(avisosPara(CORREOS_RUNWAY.dora)).toHaveLength(0);
  await page.reload();
  await expect(page.getByText(/Último aviso: .*simulado: en demostración no sale correo\./)).toBeVisible();
  await foto(page, browserName, "demo-ejemplo");

  // La empresa real nunca muestra la serie de ejemplo ni la insignia.
  await entrar(context, CORREOS_RUNWAY.rita);
  await page.goto(en("/consola/flujo"));
  await expect(page.locator('[data-tendencia="real"]')).toBeVisible();
  await expect(page.locator('[data-tendencia="ejemplo"], [data-ejemplo]')).toHaveCount(0);
  await expect(page.getByText("Ejemplo · demostración")).toHaveCount(0);
  expect(reales(errores, browserName)).toEqual([]);
});

test("9 · permisos: contaduría solo ve, un rol sin flujo, otra empresa y sin sesión no entran", async ({ page, context, browser, browserName }) => {
  const errores = vigilar(page);
  await entrar(context, CORREOS_RUNWAY.cora);
  await page.goto(en("/consola/flujo"));
  await expect(page.locator('[data-cifra="runway-conservador"]')).toBeVisible();
  await expect(page.locator('form[data-formulario="runway"]')).toHaveCount(0);
  await expect(page.locator('[data-cifra="minimo"]')).toContainText("Avisa si el runway conservador baja de 4 meses.");
  await foto(page, browserName, "contadora-solo-lectura");

  await entrar(context, CORREOS_RUNWAY.tito);
  expect((await page.goto(en("/consola/flujo")))?.status()).toBe(404);
  await entrar(context, CORREOS_RUNWAY.sergio);
  expect((await page.goto(en("/consola/flujo")))?.status()).toBe(404);

  const anonimo = await browser.newContext({ ignoreHTTPSErrors: ORIGEN.startsWith("https:") });
  try {
    const p = await anonimo.newPage();
    await p.goto(en("/consola/flujo"));
    await expect(p).toHaveURL(/\/entrar/);
  } finally {
    await anonimo.close();
  }
  expect(reales(errores, browserName)).toEqual([]);
});

test("10 · evidencia: 3 temas × 1440 y 390, axe sin violaciones y sin desplazamiento horizontal", async ({ browser, browserName }) => {
  test.skip(!EVIDENCIA, "Solo con E2E_CAPTURAS (evidencia local).");
  const paginas: [string, string, string][] = [
    ["flujo", en("/consola/flujo"), CORREOS_RUNWAY.rita],
    ["inicio", en("/consola"), CORREOS_RUNWAY.rita],
    ["demo", en("/consola/flujo", DEMO()), CORREOS_RUNWAY.dora],
    ["sin-saldo", en("/consola/flujo", SIN_SALDO()), CORREOS_RUNWAY.sergio],
  ];
  const hallazgos: string[] = [];
  for (const tema of ["claro", "oscuro", "lever"]) {
    for (const ancho of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width: ancho, height: ancho === 390 ? 844 : 1000 }, ignoreHTTPSErrors: ORIGEN.startsWith("https:") });
      try {
        const page = await context.newPage();
        for (const [nombre, url, correo] of paginas) {
          await entrar(context, correo, tema);
          const respuesta = await page.goto(url);
          expect(respuesta?.status(), `${nombre} ${tema} ${ancho}`).toBe(200);
          await page.waitForLoadState("networkidle");
          const desborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          if (desborde > 0) hallazgos.push(`${nombre} ${tema} ${ancho}: desborde ${desborde}px`);
          await page.evaluate(AXE);
          const violaciones = await page.evaluate(async () => {
            const r = await (window as unknown as { axe: { run: (c: object, o: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } })
              .axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
            return r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`);
          });
          for (const v of violaciones) hallazgos.push(`${nombre} ${tema} ${ancho}: ${v}`);
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

test("11 · nómina de una sola persona: el mes dice reservado a quien no tiene el detalle (r64-N3)", async ({ page, context, browserName }) => {
  const errores = vigilar(page);
  // Noé se va ayer: en adelante la nómina de la empresa es de una sola persona (Nora). La dueña lo prepara sin
  // disparadores; lo que se valida es lo que cada quien ve en Flujo de caja.
  const duena = new Client({ connectionString: process.env.E2E_OWNER_DATABASE_URL });
  await duena.connect();
  try {
    await duena.query("begin");
    await duena.query("set local session_replication_role = replica");
    const r = await duena.query("update employees set baja_en = $2::date - 1 where company_id = $1 and nombre = 'Noé Nómina'", [EMPRESA(), hoy()]);
    expect(r.rowCount).toBe(1);
    await duena.query("commit");
  } finally {
    await duena.end();
  }
  const reservados = page.locator('table [data-cifra="salidas"] [data-nomina="reservada"]');

  await entrar(context, CORREOS_RUNWAY.cora);
  await page.goto(en("/consola/flujo"));
  await expect(page.locator('[data-cifra="runway-conservador"]')).toBeVisible();
  expect(await reservados.count()).toBeGreaterThanOrEqual(11);
  await expect(reservados.first()).toHaveText(" · incluye nómina reservada");
  await expect(page.locator('[data-lista="runway-resumen"] li[data-tipo="nomina"] .cifra')).toHaveText("Monto reservado");
  await expect(page.locator('[data-lista="runway-resumen"] li[data-tipo="nomina"] .cifra')).not.toHaveAttribute("data-centavos", /.+/);
  expect(await page.content()).not.toContain("480,000.00");
  await reservados.first().scrollIntoViewIfNeeded();
  await foto(page, browserName, "nomina-reservada-contadora");

  // Rita (administración) tiene el detalle: ningún mes dice reservado y la nómina lleva su monto.
  await entrar(context, CORREOS_RUNWAY.rita);
  await page.goto(en("/consola/flujo"));
  await expect(page.locator('[data-cifra="runway-conservador"]')).toBeVisible();
  await expect(reservados).toHaveCount(0);
  await expect(page.locator('[data-lista="runway-resumen"] li[data-tipo="nomina"] .cifra')).not.toHaveText("Monto reservado");
  expect(reales(errores, browserName)).toEqual([]);
});

test("12 · CSP estricta: las pantallas del runway sin JavaScript, con su nonce y 0 anotaciones de la política", async ({ browser }) => {
  // Con JavaScript las recorre csp.spec (todas las rutas del registro) y cada prueba de este archivo vigila la consola.
  const contexto = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: ORIGEN.startsWith("https:") });
  const sinSaldo = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: ORIGEN.startsWith("https:") });
  await entrar(contexto, CORREOS_RUNWAY.rita);
  await entrar(sinSaldo, CORREOS_RUNWAY.sergio);
  const casos: [BrowserContext, string][] = [
    [contexto, en("/consola/flujo")], [contexto, en("/consola")], [contexto, en("/consola/pendientes")], [sinSaldo, en("/consola/flujo", SIN_SALDO())],
  ];
  for (const [sesion, ruta] of casos) {
    const pagina = await sesion.newPage();
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
  await contexto.close();
  await sinSaldo.close();
});
