// Recorrido funcional de «Endurece cuentas y separa superficies», con
// Playwright headless contra un `next dev` local y un Postgres desechable.
//
//   BASE=http://localhost:4805 \
//   DUENO_URL=postgres://dueno@127.0.0.1:5531/plataforma \
//   SEMILLAS=/ruta/fuera/del/repo/semillas.json \
//   [SOLO=a,b,c,d,e,f,h] [CASO_CORREO=proveedor_lento_3s] \
//   node scripts/evidencia/seguridad-cuentas.mjs
//
// SEMILLAS guarda la semilla TOTP de cada persona en cuanto se inscribe, para
// que una corrida parcial (SOLO) pueda volver a entrar. Nunca dentro del repo.
//
// Pasos previos y personas sembradas: docs/evidencia/seguridad-cuentas/README.md.
// Todo pasa por clics. La base solo se toca como dueño para simular el paso del
// tiempo (mover segundo_factor_en o ultimo_uso hacia atrás), para dejar el
// enlace de recuperación que llegaría por correo (en local el correo no sale) y
// para leer la bitácora que prueba cada paso. Rechaza un DUENO_URL que no sea local.

import { createHash, createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const BASE = process.env.BASE ?? "http://localhost:4805";
const DUENO = process.env.DUENO_URL ?? "";
const SALIDA = process.env.SALIDA ?? "docs/evidencia/seguridad-cuentas";
const CLAVE = process.env.CLAVE ?? "clave-segura-12";
const SOLO = (process.env.SOLO ?? "").split(",").filter(Boolean);
const SEMILLAS = process.env.SEMILLAS ?? "";
// Con qué proveedor de correo corre el servidor en esta corrida: (e) guarda sus tiempos bajo esta clave.
const CASO_CORREO = process.env.CASO_CORREO ?? "correo_rechazado_al_instante";

if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost)(:\d+)?\//.test(DUENO)) {
  throw new Error("DUENO_URL tiene que apuntar a un Postgres local desechable (127.0.0.1 o localhost).");
}

const requerir = createRequire(import.meta.url);
const { chromium } = requerir("playwright");
mkdirSync(SALIDA, { recursive: true });

if (!SEMILLAS || SEMILLAS.includes("/docs/") || SEMILLAS.startsWith("docs/")) {
  throw new Error("SEMILLAS tiene que ser un archivo fuera del repositorio.");
}
const guardado = existsSync(SEMILLAS) ? JSON.parse(readFileSync(SEMILLAS, "utf8")) : {};
const semillas = new Map(Object.entries(guardado.semillas ?? {}));
// El último paso TOTP usado por persona: una corrida nueva no repite el código de la anterior.
const ultimoPaso = new Map(Object.entries(guardado.pasos ?? {}));

function persistir() {
  writeFileSync(SEMILLAS, JSON.stringify({ semillas: Object.fromEntries(semillas), pasos: Object.fromEntries(ultimoPaso) }));
}

function guardarSemilla(correo, semilla) {
  semillas.set(correo, semilla);
  ultimoPaso.delete(correo);
  persistir();
}
const hallazgos = [];

function anotar(texto) {
  console.log(`OK ${texto}`);
  hallazgos.push(texto);
}

function exigir(condicion, texto) {
  if (!condicion) throw new Error(`FALLO ${texto}`);
  anotar(texto);
}

function sql(consulta) {
  return execFileSync("psql", [DUENO, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", consulta], { encoding: "utf8" }).trim();
}

function idDe(correo) {
  return sql(`select id from users where correo = '${correo}'`);
}

function totp(semilla, paso) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of semilla.replace(/\s+/g, "").toUpperCase()) bits += alfabeto.indexOf(c).toString(2).padStart(5, "0");
  const llave = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const mensaje = Buffer.alloc(8);
  mensaje.writeBigUInt64BE(BigInt(paso));
  const h = createHmac("sha1", llave).update(mensaje).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

/** Un código que todavía no se usó: un paso TOTP no sirve dos veces. */
async function codigoFresco(correo) {
  const semilla = semillas.get(correo);
  if (!semilla) throw new Error(`sin semilla para ${correo}`);
  let paso = Math.floor(Date.now() / 30_000);
  while (paso <= (ultimoPaso.get(correo) ?? -1)) {
    await new Promise((r) => setTimeout(r, 1_000));
    paso = Math.floor(Date.now() / 30_000);
  }
  ultimoPaso.set(correo, paso);
  persistir();
  return totp(semilla, paso);
}

async function captura(page, nombre) {
  await page.screenshot({ path: `${SALIDA}/${nombre}.png`, fullPage: true });
  anotar(`captura ${nombre}.png`);
}

async function inscribirOVerificar(page, correo, operacion) {
  await page.waitForLoadState("networkidle");
  const semilla = page.locator(".arco-semilla");
  if (await semilla.isVisible().catch(() => false)) {
    guardarSemilla(correo, (await semilla.innerText()).trim());
    await page.getByLabel("Código que muestra la app").fill(await codigoFresco(correo));
    await page.getByRole("button", { name: /Confirmar el código/ }).click();
    if (operacion) {
      await page.getByRole("button", { name: "Abrir operación" }).click();
    } else {
      await page.getByText("Ya los guardé en un lugar seguro").click();
      await page.getByRole("button", { name: "Entrar al portal" }).click();
    }
  } else {
    await page.getByLabel("Código de la app autenticadora").fill(await codigoFresco(correo));
    await page.getByRole("button", { name: "Entrar con el código" }).click();
  }
  await page.waitForLoadState("networkidle");
}

/** Entra por la puerta cliente y espera el destino final (consola de su empresa, o /empresas sin ella). */
async function entrarCliente(page, correo, destino = /\/consola|\/empresas/) {
  await page.goto(`${BASE}/entrar`);
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/entrar\/continuar/);
  await inscribirOVerificar(page, correo, false);
  await page.waitForURL(destino, { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

async function entrarOperacion(page, correo) {
  await page.goto(`${BASE}/operacion/entrar`);
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/operacion\/continuar/);
  await inscribirOVerificar(page, correo, true);
  await page.waitForURL(/\/operacion(\?|$)/);
}

/**
 * Simula que el factor de la sesión se probó hace `minutos`. En la aplicación el
 * sello solo avanza y con su evento; la simulación del reloj corre como dueña
 * con los triggers apagados en esa transacción.
 */
function envejecerFactor(correo, minutos) {
  const id = idDe(correo);
  sql(`begin; set local session_replication_role = replica;
       update sessions set segundo_factor_en = now() - interval '${minutos} minutes' where user_id = '${id}'; commit;`);
}

async function confirmarConCodigo(page, correo) {
  const panel = page.getByRole("region", { name: "Confirma que eres tú" });
  await panel.getByLabel("Código de la app autenticadora").fill(await codigoFresco(correo));
  await panel.getByRole("button", { name: "Confirmar con el código" }).click();
  await panel.waitFor({ state: "detached", timeout: 15_000 });
}

function auditoria(accion, correo) {
  return Number(sql(`select count(*) from audit_log where accion = '${accion}' and actor_id = '${idDe(correo)}'`));
}

/** La cookie sin su valor: la evidencia guarda los atributos, nunca el token. */
function sinValor({ name, domain, path, expires, httpOnly, secure, sameSite }) {
  return { name, domain, path, expires, httpOnly, secure, sameSite };
}

function toca(flujo) {
  return SOLO.length === 0 || SOLO.includes(flujo);
}

const navegador = await chromium.launch({ headless: true });
try {
  const ana = "ana@demo.test";
  const op = "op@lever.test";
  const ctxAna = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const pagAna = await ctxAna.newPage();
  // Autenticador de plataforma virtual: registra y usa passkeys reales en Chromium headless.
  const cdp = await ctxAna.newCDPSession(pagAna);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  });

  await entrarCliente(pagAna, ana);
  exigir(/\/consola/.test(pagAna.url()), `Ana entra a la consola con TOTP (${new URL(pagAna.url()).pathname})`);

  if (toca("a")) {
    // (a) Regenerar respaldos con el factor de hace más de cinco minutos.
    envejecerFactor(ana, 6);
    await pagAna.goto(`${BASE}/entrar/seguridad`);
    const panel = pagAna.getByRole("region", { name: "Confirma que eres tú" });
    exigir(await panel.isVisible(), "(a) con el factor de hace 6 min la página pide «Confirma que eres tú»");
    await captura(pagAna, "a1-pide-confirmar");
    const antesRespaldo = auditoria("respaldo_generado", ana);
    await pagAna.getByRole("button", { name: "Generar códigos nuevos" }).click();
    await pagAna.getByText(/cambiar tus métodos exige tu segundo factor/).first().waitFor();
    exigir(auditoria("respaldo_generado", ana) === antesRespaldo, "(a) regenerar sin confirmar no genera códigos");
    await captura(pagAna, "a2-regenerar-rechazado");
    await confirmarConCodigo(pagAna, ana);
    exigir(auditoria("reautenticacion", ana) >= 1, "(a) confirmar con el código queda auditado como reautenticacion");
    await captura(pagAna, "a3-confirmado");
    await pagAna.getByRole("button", { name: "Generar códigos nuevos" }).click();
    await pagAna.getByRole("heading", { name: "Códigos de respaldo." }).waitFor();
    exigir(auditoria("respaldo_generado", ana) === antesRespaldo + 1, "(a) tras confirmar, los códigos nuevos quedan auditados");
    await captura(pagAna, "a4-codigos-nuevos");
  }

  if (toca("b")) {
    // (b) Agregar una passkey y cambiar la app autenticadora con la misma regla.
    envejecerFactor(ana, 6);
    await pagAna.goto(`${BASE}/entrar/seguridad`);
    await pagAna.getByRole("button", { name: "Agregar una passkey" }).click();
    await pagAna.getByText(/cambiar tus métodos exige tu segundo factor/).first().waitFor();
    exigir(Number(sql(`select count(*) from auth_passkeys where user_id = '${idDe(ana)}'`)) === 0, "(b) sin confirmar no se registra la passkey");
    await captura(pagAna, "b1-passkey-rechazada");
    await confirmarConCodigo(pagAna, ana);
    await pagAna.getByRole("button", { name: "Agregar una passkey" }).click();
    await pagAna.getByText("Este dispositivo").waitFor();
    exigir(auditoria("passkey_registrada", ana) === 1, "(b) tras confirmar, la passkey queda registrada y auditada");
    await captura(pagAna, "b2-passkey-agregada");

    envejecerFactor(ana, 6);
    await pagAna.goto(`${BASE}/entrar/seguridad`);
    await pagAna.getByRole("button", { name: "Revocar la app" }).click();
    await pagAna.waitForURL(/aviso=reautenticacion_requerida/);
    exigir(auditoria("totp_revocado", ana) === 0, "(b) sin confirmar no se quita la app autenticadora");
    await captura(pagAna, "b3-quitar-totp-rechazado");
    const panel = pagAna.getByRole("region", { name: "Confirma que eres tú" });
    await panel.getByRole("button", { name: "Confirmar con passkey" }).click();
    await panel.waitFor({ state: "detached", timeout: 15_000 });
    exigir(Number(sql(`select count(*) from sessions where user_id = '${idDe(ana)}' and segundo_factor_metodo = 'passkey'`)) === 1, "(b) confirmar con passkey renueva el factor de la sesión");
    await pagAna.getByRole("button", { name: "Revocar la app" }).click();
    await pagAna.getByRole("button", { name: "Configurar la app autenticadora" }).waitFor();
    exigir(auditoria("totp_revocado", ana) === 1, "(b) tras confirmar, la app se quita y queda auditada");

    envejecerFactor(ana, 6);
    await pagAna.goto(`${BASE}/entrar/seguridad`);
    await pagAna.getByRole("button", { name: "Configurar la app autenticadora" }).click();
    await pagAna.getByText(/cambiar tus métodos exige tu segundo factor/).first().waitFor();
    exigir(!(await pagAna.locator(".arco-qr").isVisible()), "(b) sin confirmar no se muestra un QR nuevo");
    await captura(pagAna, "b4-inscribir-totp-rechazado");
    await pagAna.getByRole("region", { name: "Confirma que eres tú" }).getByRole("button", { name: "Confirmar con passkey" }).click();
    await pagAna.getByRole("region", { name: "Confirma que eres tú" }).waitFor({ state: "detached", timeout: 15_000 });
    await pagAna.getByRole("button", { name: "Configurar la app autenticadora" }).click();
    guardarSemilla(ana, (await pagAna.locator(".arco-semilla").innerText()).trim());
    await pagAna.getByLabel("Código que muestra la app").fill(await codigoFresco(ana));
    await pagAna.getByRole("button", { name: "Confirmar" }).click();
    await pagAna.getByText("La app autenticadora está activa.").waitFor();
    exigir(auditoria("totp_confirmado", ana) === 2, "(b) tras confirmar, la app nueva queda activa y auditada");
    await captura(pagAna, "b5-totp-reinscrito");
  }

  const ctxOp = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const pagOp = await ctxOp.newPage();

  if (toca("c")) {
    // (c) Ana pide recuperar su segundo factor; el personal la aprueba desde Operación.
    const ctxPerdida = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const pagPerdida = await ctxPerdida.newPage();
    await pagPerdida.goto(`${BASE}/entrar`);
    await pagPerdida.getByLabel("Correo").fill(ana);
    await pagPerdida.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
    await pagPerdida.getByRole("button", { name: "Continuar" }).click();
    await pagPerdida.waitForURL(/\/entrar\/continuar/);
    await pagPerdida.getByRole("button", { name: "Perdí el segundo factor" }).click();
    await pagPerdida.getByLabel("Qué pasó").fill("Se me cayó el teléfono al agua");
    await pagPerdida.getByRole("button", { name: "Pedir recuperación" }).click();
    await pagPerdida.waitForURL(/aviso=recuperacion/);
    exigir(sql(`select estado from auth_recuperaciones where user_id = '${idDe(ana)}' order by solicitada_en desc limit 1`) === "solicitada", "(c) Ana deja una solicitud de recuperación");
    await ctxPerdida.close();

    await entrarOperacion(pagOp, op);
    await pagOp.goto(`${BASE}/entrar/recuperaciones`);
    await pagOp.waitForURL(/\/operacion\/recuperaciones/);
    exigir(true, "(c) la ruta vieja /entrar/recuperaciones ya no aprueba: lleva a /operacion/recuperaciones");
    envejecerFactor(op, 6);
    await pagOp.goto(`${BASE}/operacion/recuperaciones`);
    exigir(await pagOp.getByRole("region", { name: "Confirma que eres tú" }).isVisible(), "(c) con el factor de hace 6 min Operación pide confirmar");
    await captura(pagOp, "c1-operacion-pide-confirmar");
    await pagOp.getByRole("button", { name: "Aprobar" }).first().click();
    await pagOp.waitForURL(/aviso=reautenticacion_factor/);
    exigir(sql(`select estado from auth_recuperaciones where user_id = '${idDe(ana)}' order by solicitada_en desc limit 1`) === "solicitada", "(c) aprobar sin confirmar no cambia la solicitud");
    await captura(pagOp, "c2-aprobar-rechazado");
    await confirmarConCodigo(pagOp, op);
    await pagOp.getByRole("button", { name: "Aprobar" }).first().click();
    await pagOp.waitForURL(/aviso=decision_registrada/);
    exigir(sql(`select estado from auth_recuperaciones where user_id = '${idDe(ana)}' order by solicitada_en desc limit 1`) === "aprobada", "(c) tras confirmar, la solicitud queda aprobada");
    exigir(auditoria("recuperacion_aprobada", op) === 1, "(c) la aprobación queda en la bitácora a nombre del personal");
    await captura(pagOp, "c3-aprobada");

    // Quien pidió no aprueba: el personal pide la suya por la puerta cliente e intenta aprobarla.
    const ctxPropia = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const pagPropia = await ctxPropia.newPage();
    await pagPropia.goto(`${BASE}/entrar`);
    await pagPropia.getByLabel("Correo").fill(op);
    await pagPropia.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
    await pagPropia.getByRole("button", { name: "Continuar" }).click();
    await pagPropia.waitForURL(/\/entrar\/continuar/);
    await pagPropia.getByRole("button", { name: "Perdí el segundo factor" }).click();
    await pagPropia.getByLabel("Qué pasó").fill("Prueba: el personal no aprueba su propia solicitud");
    await pagPropia.getByRole("button", { name: "Pedir recuperación" }).click();
    await pagPropia.waitForURL(/aviso=recuperacion/);
    await ctxPropia.close();
    await pagOp.goto(`${BASE}/operacion/recuperaciones`);
    await pagOp.getByRole("button", { name: "Aprobar" }).first().click();
    await pagOp.waitForURL(/aviso=misma_persona_en_recuperacion/);
    exigir(sql(`select estado from auth_recuperaciones where user_id = '${idDe(op)}' order by solicitada_en desc limit 1`) === "solicitada", "(c) el personal no aprueba su propia solicitud");
    await captura(pagOp, "c4-propia-rechazada");
  }

  if (toca("d")) {
    // (d) El personal que entra por /entrar no ve ni usa capacidades de plataforma.
    const ctxPuerta = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const pagPuerta = await ctxPuerta.newPage();
    await entrarCliente(pagPuerta, op);
    exigir(sql(`select superficie from sessions where user_id = '${idDe(op)}'`) === "cliente", "(d) el personal tiene sesión cliente al entrar por /entrar");
    await captura(pagPuerta, "d1-personal-por-entrar");
    await pagPuerta.goto(`${BASE}/precios`);
    exigir((await pagPuerta.getByLabel("Suscripción mensual, en pesos").count()) === 0, "(d) en /precios no aparece el formulario de publicar");
    await captura(pagPuerta, "d2-precios-sin-publicar");
    await pagPuerta.goto(`${BASE}/consola/lista-69b`);
    exigir((await pagPuerta.getByRole("button", { name: /Guardar|copia/i }).count()) === 0, "(d) en /consola/lista-69b no aparece cargar la 69-B");
    await captura(pagPuerta, "d3-lista69b-sin-cargar");
    await pagPuerta.goto(`${BASE}/operacion/recuperaciones`);
    await pagPuerta.waitForURL(/\/operacion\/entrar/);
    exigir(true, "(d) con sesión cliente, /operacion/recuperaciones manda a la puerta de operación");
    await ctxPuerta.close();

    // Contraste: la misma persona por la puerta SOFIPO sí ve publicar, y publicar exige factor reciente.
    await entrarOperacion(pagOp, op);
    await pagOp.goto(`${BASE}/precios`);
    const monto = pagOp.getByLabel("Suscripción mensual, en pesos");
    exigir((await monto.count()) > 0, "(d) con sesión SOFIPO el formulario de publicar sí aparece");
    envejecerFactor(op, 31);
    await monto.first().fill("1500.00");
    await pagOp.getByRole("button", { name: /Publicar/ }).click();
    await pagOp.getByText(/segundo factor verificado en los últimos 30 minutos/).waitFor();
    exigir(sql("select count(*) from platform_pricing where suscripcion_centavos is not null") === "0", "(d) con el factor de hace 31 min el precio no se publica");
    await captura(pagOp, "d4-publicar-exige-factor-reciente");
  }

  if (toca("e")) {
    // (e) /recuperar responde igual con correo existente e inexistente.
    const ctxRec = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const pagRec = await ctxRec.newPage();
    const tiempos = {};
    for (const [clave, correo] of [["existente", ana], ["inexistente", "nadie@demo.test"]]) {
      await pagRec.goto(`${BASE}/recuperar`);
      await pagRec.getByLabel("Correo").fill(correo);
      const inicio = Date.now();
      await pagRec.getByRole("button", { name: "Enviar el enlace" }).click();
      const resultado = pagRec.locator(".alerta");
      await resultado.waitFor();
      tiempos[clave] = { ms: Date.now() - inicio, texto: (await resultado.innerText()).trim() };
      await captura(pagRec, `e-${clave}`);
    }
    exigir(tiempos.existente.texto === tiempos.inexistente.texto, `(e) misma respuesta: «${tiempos.existente.texto.replace(/\s+/g, " ")}»`);
    exigir(
      Math.abs(tiempos.existente.ms - tiempos.inexistente.ms) < 400,
      `(e) [${CASO_CORREO}] tiempos parecidos: existente ${tiempos.existente.ms} ms, inexistente ${tiempos.inexistente.ms} ms`,
    );
    const archivoTiempos = `${SALIDA}/e-tiempos.json`;
    let previos = {};
    try {
      previos = JSON.parse(readFileSync(archivoTiempos, "utf8"));
    } catch {
      previos = {};
    }
    // Un caso por proveedor de correo; el formato viejo (sin casos) se reemplaza.
    const casos = previos && typeof previos === "object" && !("existente" in previos) ? previos : {};
    casos[CASO_CORREO] = tiempos;
    writeFileSync(archivoTiempos, `${JSON.stringify(casos, null, 2)}\n`);
    await ctxRec.close();
  }

  if (toca("f")) {
    // (f) Sesión inactiva 30 minutos: hay que volver a entrar.
    await pagAna.goto(`${BASE}/consola`);
    exigir(/\/consola/.test(pagAna.url()), "(f) con uso reciente la consola abre");
    sql(`update sessions set ultimo_uso = now() - interval '31 minutes' where user_id = '${idDe(ana)}'`);
    await pagAna.goto(`${BASE}/consola`);
    await pagAna.waitForURL(/\/entrar/);
    exigir(/\/entrar/.test(pagAna.url()), "(f) tras 31 min sin uso la consola manda a entrar");
    await captura(pagAna, "f1-inactiva-vuelve-a-entrar");
    // Ana conserva su app autenticadora: la recuperación aprobada en (c) no le quita factores.
    await entrarCliente(pagAna, ana, /\/consola/);
    exigir(/\/consola/.test(pagAna.url()), "(f) al volver a entrar con su segundo factor, la consola abre otra vez");
    await captura(pagAna, "f2-vuelve-a-entrar");
  }
  if (toca("g")) {
    // (g) Contra `next build && next start` (producción): las cookies llevan __Host-.
    const ctxProd = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const pagProd = await ctxProd.newPage();
    await pagProd.goto(`${BASE}/entrar`);
    await pagProd.getByLabel("Correo").fill(op);
    await pagProd.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
    await pagProd.getByRole("button", { name: "Continuar" }).click();
    await pagProd.waitForURL(/\/entrar\/continuar/);
    const deEntrada = (await ctxProd.cookies()).map(sinValor);
    exigir(deEntrada.some((c) => c.name === "__Host-entrada" && c.secure && c.path === "/" && !c.domain.startsWith(".")), "(g) tras la contraseña, la cookie es __Host-entrada (Secure, Path=/, sin Domain)");
    exigir(!deEntrada.some((c) => c.name === "entrada"), "(g) no queda una cookie «entrada» sin prefijo");
    await inscribirOVerificar(pagProd, op, false);
    await pagProd.waitForURL(/\/consola|\/empresas/, { timeout: 30_000 });
    const deSesion = (await ctxProd.cookies()).map(sinValor);
    const sesion = deSesion.find((c) => c.name === "__Host-sesion");
    exigir(Boolean(sesion?.secure && sesion.httpOnly && sesion.path === "/" && !sesion.domain.startsWith(".")), "(g) tras el factor, la sesión vive en __Host-sesion (HttpOnly, Secure, Path=/, sin Domain)");
    exigir(!deSesion.some((c) => c.name === "sesion"), "(g) no hay cookie «sesion» sin prefijo");
    await pagProd.goto(`${BASE}/entrar/seguridad`);
    exigir(/\/entrar\/seguridad/.test(pagProd.url()), "(g) el portal honra la cookie __Host-sesion");
    await captura(pagProd, "g1-produccion-host-cookies");
    writeFileSync(`${SALIDA}/g-cookies.json`, `${JSON.stringify({ tras_contrasena: deEntrada, tras_segundo_factor: deSesion }, null, 2)}\n`);
    await ctxProd.close();
  }
  if (toca("h")) {
    // (h) Cambiar la contraseña con el enlace del correo cierra todo y no salta el segundo factor.
    const NUEVA = "clave-nueva-del-correo-34";
    const enlaceDeRecuperacion = (correo) => {
      const token = randomBytes(32).toString("base64url");
      const hash = createHash("sha256").update(token).digest("hex");
      sql(`insert into password_resets (id, user_id, token_hash, creado_en, vence_en)
           values (gen_random_uuid(), '${idDe(correo)}', '${hash}', now(), now() + interval '1 hour')`);
      return `${BASE}/recuperar/${token}`;
    };
    const guardarContrasena = async (page, enlace, clave) => {
      await page.goto(enlace);
      await page.getByLabel("Contraseña nueva").fill(clave);
      await page.getByLabel("Otra vez").fill(clave);
      await page.getByRole("button", { name: "Guardar la contraseña" }).click();
      await page.getByText("La contraseña quedó guardada").waitFor();
    };
    const sesionesDeAna = () => Number(sql(`select count(*) from sessions where user_id = '${idDe(ana)}'`));

    await pagAna.goto(`${BASE}/consola`);
    await pagAna.waitForURL(/\/consola/);
    exigir(sesionesDeAna() >= 1, "(h) Ana tiene su sesión abierta en la consola");
    const ctxRes = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const pagRes = await ctxRes.newPage();
    const restablecidasAntes = auditoria("contrasena_restablecida", ana);
    const recuperacionDeAna = () =>
      sql(`select estado from auth_recuperaciones where user_id = '${idDe(ana)}' order by solicitada_en desc limit 1`);
    const recuperacionAntes = recuperacionDeAna();
    await guardarContrasena(pagRes, enlaceDeRecuperacion(ana), NUEVA);
    await captura(pagRes, "h1-contrasena-guardada");
    if (recuperacionAntes === "aprobada") {
      exigir(recuperacionDeAna() === "vencida", "(h) la recuperación de segundo factor que (c) le aprobó a Ana quedó vencida");
    }
    exigir(sesionesDeAna() === 0, "(h) al guardar se cierran todas las sesiones de Ana");
    exigir(sql(`select count(*) from auth_entradas where user_id = '${idDe(ana)}' and consumida_en is null`) === "0", "(h) no queda ninguna entrada a medias de antes del cambio");
    exigir(auditoria("contrasena_restablecida", ana) === restablecidasAntes + 1, "(h) el cambio queda en la bitácora");
    await pagAna.goto(`${BASE}/consola`);
    await pagAna.waitForURL(/\/entrar/);
    exigir(true, "(h) la sesión que Ana tenía abierta ya no abre la consola");
    await captura(pagAna, "h2-sesion-anterior-cerrada");

    await pagRes.goto(`${BASE}/entrar`);
    await pagRes.getByLabel("Correo").fill(ana);
    await pagRes.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
    await pagRes.getByRole("button", { name: "Continuar" }).click();
    await pagRes.getByText("El correo o la contraseña no coinciden.").waitFor();
    exigir(/\/entrar(\?|$)/.test(pagRes.url()), "(h) la contraseña anterior ya no entra");
    // React vacía el formulario al volver la acción: se escriben los dos campos otra vez.
    await pagRes.getByLabel("Correo").fill(ana);
    await pagRes.getByLabel("Contraseña", { exact: true }).fill(NUEVA);
    await pagRes.getByRole("button", { name: "Continuar" }).click();
    await pagRes.waitForURL(/\/entrar\/continuar/);
    await pagRes.getByLabel("Código de la app autenticadora").waitFor();
    exigir(
      Number(sql(`select count(*) from sessions where user_id = '${idDe(ana)}' and segundo_factor_en is not null`)) === 0,
      "(h) con la contraseña nueva la puerta pide el segundo factor y todavía no hay sesión",
    );
    await captura(pagRes, "h3-contrasena-nueva-pide-factor");
    await pagRes.getByLabel("Código de la app autenticadora").fill(await codigoFresco(ana));
    await pagRes.getByRole("button", { name: "Entrar con el código" }).click();
    await pagRes.waitForURL(/\/consola/, { timeout: 30_000 });
    exigir(true, "(h) con la contraseña nueva y su app autenticadora de siempre, la consola abre");
    await captura(pagRes, "h4-entra-con-factor");
    // Deja la contraseña de siempre para que otra corrida parcial pueda entrar.
    await guardarContrasena(pagRes, enlaceDeRecuperacion(ana), CLAVE);
    await ctxRes.close();
  }
  writeFileSync(`${SALIDA}/recorrido${SOLO.length ? `-${SOLO.join("")}` : ""}.txt`, `${hallazgos.join("\n")}\n`);
} finally {
  await navegador.close();
}
