// Recorrido funcional de «Corrige la recuperación aprobada del segundo factor»,
// con Playwright headless contra `next start` y un Postgres local desechable.
//
//   BASE=http://localhost:4805 \
//   DUENO_URL=postgres://dueno@127.0.0.1:5531/plataforma \
//   SERVIDOR_LOG=/ruta/fuera/del/repo/prod.log \
//   node scripts/evidencia/recuperacion-factor-nuevo.mjs
//
// Personas sembradas y pasos previos: docs/evidencia/recuperacion-factor-nuevo/README.md.
// Todo pasa por clics. La base solo se toca como dueña para simular el paso
// del tiempo (el sello del factor del personal) y para leer lo que prueba
// cada paso. SERVIDOR_LOG es la salida de `next start`: en local el correo no
// sale y el aviso queda registrado ahí. Rechaza un DUENO_URL que no sea local.

import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const BASE = process.env.BASE ?? "http://localhost:4805";
const DUENO = process.env.DUENO_URL ?? "";
const SERVIDOR_LOG = process.env.SERVIDOR_LOG ?? "";
const SALIDA = process.env.SALIDA ?? "docs/evidencia/recuperacion-factor-nuevo";
const CLAVE = process.env.CLAVE ?? "clave-segura-12";

if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost)(:\d+)?\//.test(DUENO)) {
  throw new Error("DUENO_URL tiene que apuntar a un Postgres local desechable (127.0.0.1 o localhost).");
}
if (!SERVIDOR_LOG || SERVIDOR_LOG.includes("/docs/")) throw new Error("SERVIDOR_LOG tiene que ser la salida de next start, fuera del repo.");

const requerir = createRequire(import.meta.url);
const { chromium } = requerir("playwright");
mkdirSync(SALIDA, { recursive: true });

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
function contar(consulta) {
  return Number(sql(consulta));
}
async function esperar(condicion, texto) {
  for (let i = 0; i < 30; i += 1) {
    if (condicion()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`FALLO sin respuesta: ${texto}`);
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

/** Un código en un paso que esa semilla todavía no usó: un paso TOTP no sirve dos veces. */
const ultimoPaso = new Map();
async function codigoFresco(semilla) {
  let paso = Math.floor(Date.now() / 30_000);
  while (paso <= (ultimoPaso.get(semilla) ?? -1)) {
    await new Promise((r) => setTimeout(r, 1_000));
    paso = Math.floor(Date.now() / 30_000);
  }
  ultimoPaso.set(semilla, paso);
  return totp(semilla, paso);
}

async function captura(page, nombre) {
  await page.screenshot({ path: `${SALIDA}/${nombre}.png`, fullPage: true });
  anotar(`captura ${nombre}.png`);
}

/** Escribe la contraseña en la puerta cliente (/entrar) o en la de Operación (/operacion/entrar). */
async function contrasena(page, correo, superficie = "") {
  await page.goto(`${BASE}${superficie}/entrar`);
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(new RegExp(`${superficie}/(entrar/)?continuar`));
  await page.waitForLoadState("networkidle");
}

const laura = "laura@demo.test";
const op = "op@lever.test";
const idLaura = sql(`select id from users where correo = '${laura}'`);
const idOp = sql(`select id from users where correo = '${op}'`);
const appsDeLaura = (filtro) => contar(`select count(*) from auth_totp where user_id = '${idLaura}' and ${filtro}`);
const sesionesDeLaura = () => contar(`select count(*) from sessions where user_id = '${idLaura}'`);
const ventana = { viewport: { width: 1280, height: 900 } };

const navegador = await chromium.launch({ headless: true });
try {
  // 1. Laura entra por primera vez: registra su app y recibe diez códigos. Esta sesión queda abierta en «otro equipo».
  const ctxOtro = await navegador.newContext(ventana);
  const pagOtro = await ctxOtro.newPage();
  await contrasena(pagOtro, laura);
  const semillaVieja = (await pagOtro.locator(".arco-semilla").innerText()).trim();
  await pagOtro.getByLabel("Código que muestra la app").fill(await codigoFresco(semillaVieja));
  await pagOtro.getByRole("button", { name: /Confirmar el código/ }).click();
  await pagOtro.getByRole("heading", { name: "Códigos de respaldo." }).waitFor();
  const codigosViejos = await pagOtro.locator(".arco-codigos li").allInnerTexts();
  await pagOtro.getByText("Ya los guardé en un lugar seguro").click();
  await pagOtro.getByRole("button", { name: "Entrar al portal" }).click();
  await pagOtro.waitForURL(/\/consola/, { timeout: 30_000 });
  const appVieja = sql(`select id from auth_totp where user_id = '${idLaura}' and confirmado_en is not null`);
  exigir(codigosViejos.length === 10 && appsDeLaura("revocado_en is null and confirmado_en is not null") === 1, "1. Laura tiene su app y diez códigos de respaldo");
  await captura(pagOtro, "01-otro-equipo-con-sesion");

  // 2. Pierde el teléfono y pide recuperación desde otro navegador.
  const ctxPide = await navegador.newContext(ventana);
  const pagPide = await ctxPide.newPage();
  await contrasena(pagPide, laura);
  await pagPide.getByRole("button", { name: "Perdí el segundo factor" }).click();
  await pagPide.getByLabel("Qué pasó").fill("Se me cayó el teléfono con la app");
  await captura(pagPide, "02-pide-recuperacion");
  await pagPide.getByRole("button", { name: "Pedir recuperación" }).click();
  await pagPide.waitForURL(/aviso=recuperacion/);
  exigir(sql(`select estado from auth_recuperaciones where user_id = '${idLaura}'`) === "solicitada", "2. queda la solicitud de recuperación");
  await ctxPide.close();

  // 3. Otra persona del personal la aprueba desde Operación, con «Confirma que eres tú».
  const ctxOp = await navegador.newContext(ventana);
  const pagOp = await ctxOp.newPage();
  await contrasena(pagOp, op, "/operacion");
  const semillaOp = (await pagOp.locator(".arco-semilla").innerText()).trim();
  await pagOp.getByLabel("Código que muestra la app").fill(await codigoFresco(semillaOp));
  await pagOp.getByRole("button", { name: /Confirmar el código/ }).click();
  await pagOp.getByRole("button", { name: "Abrir operación" }).click();
  await pagOp.waitForURL(/\/operacion(\?|$)/);
  sql(`begin; set local session_replication_role = replica;
       update sessions set segundo_factor_en = now() - interval '6 minutes' where user_id = '${idOp}'; commit;`);
  await pagOp.goto(`${BASE}/operacion/recuperaciones`);
  const panel = pagOp.getByRole("region", { name: "Confirma que eres tú" });
  exigir(await panel.isVisible(), "3. con el factor de hace 6 min, Operación pide «Confirma que eres tú»");
  await captura(pagOp, "03-operacion-confirma-que-eres-tu");
  await panel.getByLabel("Código de la app autenticadora").fill(await codigoFresco(semillaOp));
  await panel.getByRole("button", { name: "Confirmar con el código" }).click();
  await panel.waitFor({ state: "detached", timeout: 15_000 });
  await pagOp.getByRole("button", { name: "Aprobar" }).first().click();
  await pagOp.waitForURL(/aviso=decision_registrada/);
  exigir(sql(`select estado from auth_recuperaciones where user_id = '${idLaura}'`) === "aprobada", "3. op aprueba la recuperación");
  await captura(pagOp, "04-aprobada");
  await ctxOp.close();

  // 4. Laura entra con su contraseña: ya no le pide el factor perdido, le pide registrar uno nuevo.
  const ctxNuevo = await navegador.newContext(ventana);
  const pagNuevo = await ctxNuevo.newPage();
  await contrasena(pagNuevo, laura);
  await pagNuevo.getByRole("heading", { name: "Registra un factor nuevo." }).waitFor();
  exigir(await pagNuevo.getByText("Recuperación aprobada").isVisible(), "4. con la contraseña ve «Recuperación aprobada · Registra un factor nuevo»");
  exigir(sesionesDeLaura() === 1, "4. la contraseña sola no abre sesión (solo sigue la del otro equipo)");
  exigir(
    appsDeLaura("revocado_en is null and confirmado_en is not null") === 1 && appsDeLaura("revocado_en is null and confirmado_en is null") === 1,
    "4. la app nueva queda pendiente junto a la vieja, que sigue viva hasta confirmar",
  );
  await captura(pagNuevo, "05-registra-factor-nuevo");

  // 5. Confirma la app nueva con doble clic.
  const semillaNueva = (await pagNuevo.locator(".arco-semilla").innerText()).trim();
  exigir(semillaNueva !== semillaVieja, "5. el QR es de una semilla nueva");
  await pagNuevo.getByLabel("Código que muestra la app").fill(await codigoFresco(semillaNueva));
  await pagNuevo.getByRole("button", { name: /Confirmar el código/ }).dblclick();
  await pagNuevo.getByRole("heading", { name: "Códigos de respaldo." }).waitFor();
  await pagNuevo.waitForLoadState("networkidle");
  await pagNuevo.waitForTimeout(2_000);
  exigir(await pagNuevo.getByRole("heading", { name: "Códigos de respaldo." }).isVisible(), "5. tras el doble clic siguen a la vista los códigos nuevos");
  exigir(appsDeLaura("revocado_en is null and confirmado_en is not null") === 1, "5. doble clic: exactamente una app confirmada vigente");
  exigir(appsDeLaura("revocado_en is null and confirmado_en is null") === 0, "5. no queda ninguna app pendiente");
  exigir(contar(`select count(*) from audit_log where actor_id = '${idLaura}' and accion = 'totp_confirmado'`) === 2, "5. solo una confirmación nueva en la bitácora (2 en total con la del primer ingreso)");
  const appNueva = sql(`select id from auth_totp where user_id = '${idLaura}' and revocado_en is null and confirmado_en is not null`);
  exigir(appNueva !== appVieja, "5. la app vigente es la nueva");
  exigir(sql(`select revocado_por from auth_totp where id = '${appVieja}'`) === idLaura, "5. la app vieja quedó revocada a nombre de Laura");
  exigir(
    contar(`select count(*) from auth_codigos_respaldo where user_id = '${idLaura}' and usado_en is null and invalidado_en is null`) === 10,
    "5. solo valen los diez códigos nuevos",
  );
  exigir(sql(`select estado from auth_recuperaciones where user_id = '${idLaura}'`) === "cumplida", "5. la recuperación queda cumplida");
  await captura(pagNuevo, "06-codigos-nuevos");
  await pagNuevo.getByText("Ya los guardé en un lugar seguro").click();
  await pagNuevo.getByRole("button", { name: "Entrar al portal" }).click();
  await pagNuevo.waitForURL(/\/consola/, { timeout: 30_000 });
  exigir(sesionesDeLaura() === 1, "5. Laura queda con una sola sesión, la nueva");
  await captura(pagNuevo, "07-consola-con-factor-nuevo");

  // 6. Lo viejo ya no abre nada.
  await pagOtro.goto(`${BASE}/consola`);
  await pagOtro.waitForURL(/\/entrar/, { timeout: 15_000 });
  exigir(true, "6. la sesión del otro equipo se cerró: /consola lo manda a /entrar");
  await captura(pagOtro, "08-otro-equipo-cerrado");

  const ctxViejo = await navegador.newContext(ventana);
  const pagViejo = await ctxViejo.newPage();
  const fallos = () => contar(`select count(*) from audit_log where actor_id = '${idLaura}' and accion = 'segundo_factor_fallido'`);
  await contrasena(pagViejo, laura);
  const antesApp = fallos();
  await pagViejo.getByLabel("Código de la app autenticadora").fill(await codigoFresco(semillaVieja));
  await pagViejo.getByRole("button", { name: "Entrar con el código" }).click();
  await pagViejo.getByText("Ese código no coincide.").first().waitFor();
  await esperar(() => fallos() === antesApp + 1, "fallo de la app vieja");
  exigir(/\/entrar\/continuar/.test(pagViejo.url()) && sesionesDeLaura() === 1, "6. el código de la app vieja ya no entra (queda como intento fallido)");
  await captura(pagViejo, "09-app-vieja-rechazada");
  await pagViejo.getByLabel("Código de respaldo").fill(codigosViejos[0]);
  await pagViejo.getByRole("button", { name: "Usar un código de respaldo" }).click();
  await esperar(() => fallos() === antesApp + 2, "fallo del código de respaldo viejo");
  await pagViejo.waitForLoadState("networkidle");
  exigir(/\/entrar\/continuar/.test(pagViejo.url()) && sesionesDeLaura() === 1, "6. un código de respaldo viejo ya no entra (queda como intento fallido)");
  await captura(pagViejo, "10-respaldo-viejo-rechazado");
  await pagViejo.getByLabel("Código de la app autenticadora").fill(await codigoFresco(semillaNueva));
  await pagViejo.getByRole("button", { name: "Entrar con el código" }).click();
  await pagViejo.waitForURL(/\/consola/, { timeout: 30_000 });
  exigir(true, "6. control: la app nueva sí entra");
  await captura(pagViejo, "11-app-nueva-entra");
  await ctxViejo.close();
  await ctxOtro.close();
  await ctxNuevo.close();

  // 7. Bitácora y aviso.
  const filas = sql(
    `select accion || ' ' || entidad || ' ' || identificador || ' ' || superficie from audit_log
     where txid = (select txid from audit_log where accion = 'recuperacion_cumplida' and actor_id = '${idLaura}')
     order by id`,
  ).split("\n");
  const acciones = filas.map((fila) => fila.split(" ")[0]).sort();
  exigir(
    JSON.stringify(acciones) ===
      JSON.stringify(["entrada_completa", "recuperacion_cumplida", "respaldo_generado", "sesion_cerrada", "totp_confirmado", "totp_revocado"]),
    `7. una sola transacción con su bitácora: ${acciones.join(", ")}`,
  );
  exigir(filas.some((fila) => fila.startsWith(`totp_revocado auth_totp ${appVieja}`)), "7. totp_revocado apunta a la app vieja");
  writeFileSync(`${SALIDA}/bitacora.txt`, `${filas.join("\n")}\n`);
  const aviso = readFileSync(SERVIDOR_LOG, "utf8")
    .split("\n")
    .filter((linea) => linea.includes('"factor_reinscrito"'));
  exigir(
    aviso.length === 1 && aviso[0].includes('"aviso_seguridad_no_enviado"') && !aviso[0].includes(laura),
    "7. el aviso factor_reinscrito se intentó; en local el correo no sale y queda registrado sin datos personales",
  );
  writeFileSync(`${SALIDA}/aviso-registrado.jsonl`, `${aviso.join("\n")}\n`);
  writeFileSync(`${SALIDA}/recorrido.txt`, `${hallazgos.join("\n")}\n`);
} finally {
  await navegador.close();
}
