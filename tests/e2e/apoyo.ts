import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";

/**
 * Lo que comparten los recorridos nuevos. La base solo se toca como dueña para
 * abrir sesiones, leer lo que prueba cada paso y mover relojes que la prueba no
 * puede esperar (un factor de hace 31 minutos). Todo lo que cambia datos de la
 * aplicación pasa por clics.
 */

export const ORIGEN = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PUERTO ?? "3109"}`;
export const CLAVE = "clave-segura-12";

export const altamar = () => requerida("E2E_ALTAMAR_ID");
export const bahia = () => requerida("E2E_BAHIA_ID");

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta ${nombre}: lo define tests/e2e/siembra.ts.`);
  return valor;
}

/** Una consulta como dueña de la base desechable. */
export async function consultar<T extends Record<string, unknown>>(sql: string, valores: unknown[] = []): Promise<T[]> {
  const cliente = new Client({ connectionString: requerida("E2E_OWNER_DATABASE_URL") });
  await cliente.connect();
  try {
    return (await cliente.query<T>(sql, valores)).rows;
  } finally {
    await cliente.end();
  }
}

export async function contar(sql: string, valores: unknown[] = []): Promise<number> {
  const [fila] = await consultar<{ n: string | number }>(`select count(*) as n from (${sql}) as conteo`, valores);
  return Number(fila?.n ?? 0);
}

export async function idDe(correo: string): Promise<string> {
  const [fila] = await consultar<{ id: string }>("select id from users where correo = $1", [correo]);
  if (!fila) throw new Error(`No existe ${correo} en la base de la prueba.`);
  return fila.id;
}

/**
 * Abre una sesión con segundo factor para la persona (como los e2e de Pagos) y
 * la deja en la cookie __Host-sesion del contexto. `factorHace` envejece la
 * prueba del factor: el trigger de sessions no deja reescribirla y el dueño lo
 * salta solo en esa transacción, en la base desechable.
 */
export async function sesionDe(
  contexto: BrowserContext,
  correo: string,
  opciones: { superficie?: "cliente" | "sofipo"; factorHaceMinutos?: number } = {},
): Promise<void> {
  const token = `S${randomUUID().replace(/-/g, "")}AAAAAAAAAA`.slice(0, 43);
  const entrada = randomUUID();
  const sesion = randomUUID();
  const userId = await idDe(correo);
  const cliente = new Client({ connectionString: requerida("E2E_OWNER_DATABASE_URL") });
  await cliente.connect();
  try {
    await cliente.query("begin");
    await cliente.query(
      `insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
       values ($1, $2, $3, now(), now() + interval '10 minutes', 'totp', now(), now())`,
      [entrada, userId, createHash("sha256").update(entrada).digest("hex")],
    );
    await cliente.query(
      `insert into sessions (id, user_id, token_hash, expires_at, superficie, segundo_factor, entrada_id)
       values ($1, $2, $3, now() + interval '8 hours', $4, 'totp', $5)`,
      [sesion, userId, createHash("sha256").update(token).digest("hex"), opciones.superficie ?? "cliente", entrada],
    );
    await cliente.query("commit");
  } finally {
    await cliente.end();
  }
  if (opciones.factorHaceMinutos !== undefined) await envejecerFactor(correo, opciones.factorHaceMinutos);
  await contexto.clearCookies();
  // `next start` corre en producción: la cookie lleva el prefijo __Host- (Secure, Path=/, sin Domain).
  // Con domain + path queda host-only; con `url` http, Playwright le quitaría `secure`.
  await contexto.addCookies([
    { name: "__Host-sesion", value: token, domain: new URL(ORIGEN).hostname, path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
  ]);
}

/** El segundo factor de todas las sesiones de la persona se probó hace `minutos`. */
export async function envejecerFactor(correo: string, minutos: number): Promise<void> {
  const cliente = new Client({ connectionString: requerida("E2E_OWNER_DATABASE_URL") });
  await cliente.connect();
  try {
    await cliente.query("begin");
    await cliente.query("set local session_replication_role = replica");
    await cliente.query(
      `update sessions set segundo_factor_en = now() - make_interval(mins => $2::int)
       where user_id = (select id from users where correo = $1)`,
      [correo, minutos],
    );
    await cliente.query("commit");
  } finally {
    await cliente.end();
  }
}

// ---------- TOTP ----------

function deBase32(texto: string): Buffer {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of texto.replace(/[\s=]+/g, "").toUpperCase()) {
    const indice = alfabeto.indexOf(c);
    if (indice < 0) throw new Error("Semilla TOTP con un carácter fuera de base32.");
    bits += indice.toString(2).padStart(5, "0");
  }
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}

function codigoDelPaso(semilla: string, paso: number): string {
  const mensaje = Buffer.alloc(8);
  mensaje.writeBigUInt64BE(BigInt(paso));
  const h = createHmac("sha1", deBase32(semilla)).update(mensaje).digest();
  const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

/** Semilla sembrada por tests/e2e/siembra.ts para esa persona. */
export function semillaDe(correo: string): string {
  const semillas = JSON.parse(process.env.E2E_SEMILLAS ?? "{}") as Record<string, string>;
  const semilla = semillas[correo];
  if (!semilla) throw new Error(`Sin semilla TOTP sembrada para ${correo}.`);
  return semilla;
}

/**
 * Un código que el servidor acepta y que nadie ha usado. El servidor acepta el
 * paso actual y uno a cada lado, siempre que sea posterior al último usado
 * (auth_totp.ultimo_paso): así hay hasta tres códigos por medio minuto sin
 * esperar. El paso anterior solo se usa si faltan más de 5 s para el cambio;
 * si los tres ya se usaron, se espera la condición «llegó un paso nuevo».
 */
export async function codigoTotp(correo: string, semilla = semillaDe(correo)): Promise<string> {
  const [fila] = await consultar<{ ultimo: string | null }>(
    `select max(t.ultimo_paso)::text as ultimo from auth_totp t join users u on u.id = t.user_id
     where u.correo = $1 and t.revocado_en is null and t.confirmado_en is not null`,
    [correo],
  );
  const ultimo = fila?.ultimo === null || fila?.ultimo === undefined ? -1 : Number(fila.ultimo);
  const libre = () => {
    const ahora = Date.now();
    const actual = Math.floor(ahora / 30_000);
    const restante = 30_000 - (ahora % 30_000);
    return [restante > 5_000 ? actual - 1 : null, actual, actual + 1].find((p): p is number => p !== null && p > ultimo) ?? null;
  };
  let paso = libre();
  if (paso === null) {
    await expect.poll(() => libre(), { timeout: 35_000, message: "esperando un paso TOTP sin usar" }).not.toBeNull();
    paso = libre()!;
  }
  return codigoDelPaso(semilla, paso);
}

/** El código para confirmar una semilla recién mostrada en pantalla (todavía sin pasos usados). */
export function codigoDeSemilla(semilla: string): string {
  return codigoDelPaso(semilla, Math.floor(Date.now() / 30_000));
}

// ---------- Envíos ----------

/**
 * Doble clic real en un botón de envío. Cuenta las acciones de servidor que
 * salen del navegador (POST con encabezado next-action) o, con `documento`,
 * los POST de formularios de documento (acciones con redirect). Espera a que
 * la respuesta llegue y a que React deje de marcar el formulario ocupado; la
 * prueba revisa después la base.
 */
export async function dobleClic(boton: Locator, opciones: { esperar?: RegExp; pausaMs?: number } = {}): Promise<{ envios: number; ocupado: boolean }> {
  const pagina = boton.page();
  await pagina.evaluate(() => {
    const vistos: string[] = [];
    const revisar = () => {
      for (const b of document.querySelectorAll<HTMLButtonElement>('button[aria-busy="true"]')) vistos.push(`${b.disabled}`);
    };
    const observador = new MutationObserver(revisar);
    observador.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    (window as unknown as { __ocupados: string[] }).__ocupados = vistos;
    (window as unknown as { __soltar: () => void }).__soltar = () => observador.disconnect();
  });
  let envios = 0;
  const contar = (peticion: { method(): string; headers(): Record<string, string> }) => {
    if (peticion.method() === "POST" && (peticion.headers()["next-action"] || peticion.headers()["content-type"]?.startsWith("multipart/form-data"))) envios += 1;
  };
  pagina.on("request", contar);
  const respuesta = pagina.waitForResponse((r) => r.request().method() === "POST", { timeout: 30_000 });
  // Sin pausa, el segundo clic llega mientras la acción corre (el caso que BotonEnviar protege).
  await boton.dblclick({ delay: opciones.pausaMs ?? 0 });
  await respuesta;
  if (opciones.esperar) await pagina.waitForURL(opciones.esperar, { timeout: 30_000 });
  await pagina.waitForFunction(() => !document.querySelector('form[aria-busy="true"], button[aria-busy="true"]'), null, { timeout: 30_000 });
  pagina.off("request", contar);
  const ocupado = await pagina.evaluate(() => {
    (window as unknown as { __soltar?: () => void }).__soltar?.();
    return ((window as unknown as { __ocupados?: string[] }).__ocupados ?? []).includes("true");
  }).catch(() => true);
  return { envios, ocupado };
}

/** Errores de la página y de la consola del navegador durante un recorrido. */
export function vigilarConsola(pagina: Page): string[] {
  const errores: string[] = [];
  pagina.on("pageerror", (error) => errores.push(`pageerror ${error.message.slice(0, 300)}`));
  pagina.on("console", (mensaje) => {
    if (mensaje.type() !== "error") return;
    // Las 404 a propósito: el navegador anota el documento fallido.
    if (/status of 404/.test(mensaje.text())) return;
    errores.push(mensaje.text().slice(0, 300));
  });
  return errores;
}

// ---------- Correo ----------

export type Correo = { para: string[]; asunto: string; texto: string; html: string; idempotencia: string };

/** Los correos que la aplicación mandó al proveedor falso (tests/e2e/correo-local/preload.mjs). */
export function correos(): Correo[] {
  const archivo = requerida("E2E_CORREO_ARCHIVO");
  let texto = "";
  try {
    texto = readFileSync(archivo, "utf8");
  } catch {
    return [];
  }
  return texto.split("\n").filter(Boolean).map((linea) => JSON.parse(linea) as Correo);
}

export const correosPara = (correo: string) => correos().filter((c) => c.para.includes(correo));

/** El último enlace de la aplicación que trae un correo, ya en el origen de la prueba. */
export function enlaceDe(correo: Correo, ruta: RegExp): string {
  const encontrado = correo.texto.match(new RegExp(`https?://[^\\s"<>]*${ruta.source}[^\\s"<>]*`));
  if (!encontrado) throw new Error(`El correo «${correo.asunto}» no trae un enlace a ${ruta}.`);
  const url = new URL(encontrado[0]);
  return `${ORIGEN}${url.pathname}${url.search}`;
}
