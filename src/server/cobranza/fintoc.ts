import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { clabeValida } from "../../dominio/clabe";
import { hoyEnMexico } from "../../dominio/personas";
import { aplicarSentencia, bloquearEmpresa, conContexto, type Consulta, type ContextoDeBase } from "../../nucleo/db";
import { basePlataforma, exigirPersonal, type ContextoDeTenant } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { formatoPesos } from "../../dominio/centavos";
import { actorDePersonal, auditar as auditarPorDefecto, type Actor, type Auditar } from "../bitacora/auditar";
import { leerUrlPublica } from "../correo";
import { plantillaAvisoDevolucionCobranza, plantillaAvisoRetenidoFallidoCobranza } from "../correo/plantillas/cobro";
import { fechaConAnio } from "../../dominio/flujo/fechas";
import { centavos, registro, texto, textoONulo } from "../flujo/lectura";
import { recibirAbono, type AbonoRecibido, type FuenteDeAbonos } from "./abonos";
import { autorDe } from "./comun";
import { avisarAlEquipo, avisarAlEquipoConMotivo, type DependenciasCobranza } from "./servicio";

/**
 * Adaptador de Fintoc (API v2026-02-01, documentación leída el 2026-11-10;
 * contratos y URLs en el RFC de cobranza, §9). Cada empresa tiene su cuenta en
 * Fintoc (Entity → Account) y cada cliente su CLABE en esa cuenta. Fintoc
 * avisa cada abono con un evento `transfer.inbound.succeeded` firmado.
 *
 * Apagado mientras no estén FINTOC_SECRET_KEY y FINTOC_WEBHOOK_SECRET. Nunca
 * acepta las llaves de ejemplo de la documentación. En producción
 * (VERCEL_ENV=production) solo `sk_live_`; en preview y local solo `sk_test_`
 * (el sandbox). La combinación contraria lo deja apagado y lo registra, sin la llave.
 */

export type ModoFintoc = "live" | "test";
export type ConfigFintoc = { llaveSecreta: string; secretoWebhook: string; modo: ModoFintoc };

const API = "https://api.fintoc.com";
const ESPERA_MS = 10_000;
/** Tolerancia de la firma que recomienda Fintoc: cinco minutos. */
export const TOLERANCIA_SEG = 300;
/** Lo más que se acepta de cuerpo en el aviso. Un evento de transferencia pesa ~2 KB. */
export const TOPE_CUERPO = 64 * 1024;
/** Páginas de 300 que se revisan al buscar la CLABE de un cliente (90 000 CLABEs). */
const PAGINAS_DE_BUSQUEDA = 300;

// Las de la documentación (guías de API keys, webhooks y cuentas). No son de nadie.
const LLAVES_DE_EJEMPLO = new Set(["sk_test_0000000000000000", "sk_test_9c8d8CeyBTx1VcJzuDgpm4H", "sk_test_jKaHdEa3mfmP0D105H"]);
const SECRETOS_DE_EJEMPLO = new Set(["YOUR_WEBHOOK_SECRET", "your_webhook_secret", "..."]);

export type MotivoApagado =
  | "sin_llaves"
  | "llave_no_valida"
  | "secreto_no_valido"
  | "llave_de_prueba_en_produccion"
  | "llave_real_fuera_de_produccion";

export function leerConfigFintoc(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { config: ConfigFintoc } | { config: null; motivo: MotivoApagado } {
  const llave = env.FINTOC_SECRET_KEY?.trim() ?? "";
  const secreto = env.FINTOC_WEBHOOK_SECRET?.trim() ?? "";
  if (!llave || !secreto) return { config: null, motivo: "sin_llaves" };
  const forma = /^sk_(live|test)_([A-Za-z0-9]+)$/.exec(llave);
  if (!forma || LLAVES_DE_EJEMPLO.has(llave) || /^(.)\1+$/.test(forma[2]!)) return { config: null, motivo: "llave_no_valida" };
  if (SECRETOS_DE_EJEMPLO.has(secreto) || secreto.length < 16 || /\s/.test(secreto)) return { config: null, motivo: "secreto_no_valido" };
  const modo: ModoFintoc = forma[1] === "live" ? "live" : "test";
  // Producción solo con dinero real; preview y local solo con el sandbox, para no tocar dinero real desde pruebas.
  const produccion = env.VERCEL_ENV === "production";
  if (produccion && modo === "test") return { config: null, motivo: "llave_de_prueba_en_produccion" };
  if (!produccion && modo === "live") return { config: null, motivo: "llave_real_fuera_de_produccion" };
  return { config: { llaveSecreta: llave, secretoWebhook: secreto, modo } };
}

let avisoDeApagado = false;

export function configFintoc(): ConfigFintoc | null {
  const leida = leerConfigFintoc();
  if (leida.config) return leida.config;
  if (leida.motivo !== "sin_llaves" && !avisoDeApagado) {
    avisoDeApagado = true;
    console.error(JSON.stringify({ nivel: "error", origen: "cobranza.fintoc", evento: "fintoc_apagado", motivo: leida.motivo }));
  }
  return null;
}

// Firma -------------------------------------------------------------------------------

export type Firma = "valida" | "invalida" | "vieja";

/**
 * `Fintoc-Signature: t=<unix>,v1=<hex>`: HMAC-SHA256 con el secreto del
 * endpoint sobre `<t>.<cuerpo crudo>`. Se compara en tiempo constante y después
 * se revisa la edad, para no decir nada de una firma falsa.
 */
export function verificarFirma(cuerpo: Uint8Array, encabezado: string | null, secreto: string, ahoraSeg: number): Firma {
  if (!encabezado || encabezado.length > 1024) return "invalida";
  let t: string | null = null;
  const firmas: string[] = [];
  for (const parte of encabezado.split(",")) {
    const i = parte.indexOf("=");
    if (i <= 0) continue;
    const clave = parte.slice(0, i).trim();
    const valor = parte.slice(i + 1).trim();
    if (clave === "t") t = valor;
    else if (clave === "v1") firmas.push(valor);
  }
  if (!t || !/^[0-9]{1,12}$/.test(t) || firmas.length === 0 || firmas.length > 5) return "invalida";
  const esperada = createHmac("sha256", secreto).update(`${t}.`, "utf8").update(cuerpo).digest();
  let coincide = false;
  for (const firma of firmas) {
    if (/^[0-9a-f]{64}$/i.test(firma) && timingSafeEqual(Buffer.from(firma, "hex"), esperada)) coincide = true;
  }
  if (!coincide) return "invalida";
  return Math.abs(ahoraSeg - Number(t)) > TOLERANCIA_SEG ? "vieja" : "valida";
}

/** Para las pruebas y el simulador local: la firma que Fintoc pondría. */
export function firmar(cuerpo: string, secreto: string, t: number): string {
  return `t=${t},v1=${createHmac("sha256", secreto).update(`${t}.${cuerpo}`, "utf8").digest("hex")}`;
}

// El aviso -----------------------------------------------------------------------------

export type AbonoFintoc = Omit<AbonoRecibido, "clienteDeLaCuenta"> & { cuentaId: string; cuentaNumeroId: string };
/** La empresa devolvió al ordenante una transferencia que ya había llegado (r63-N8). */
export type DevolucionFintoc = { idExterno: string; transferenciaId: string; cuentaId: string; cuentaNumeroId: string; montoCentavos: number; recibidoEl: string; referencia: string | null };
export type AvisoFintoc = { eventoId: string; tipo: string; modo: ModoFintoc; abono: AbonoFintoc | null; devolucion: DevolucionFintoc | null };

const ID_EVENTO = /^evt_[A-Za-z0-9]{1,64}$/;
const ID_TRANSFERENCIA = /^tr_[A-Za-z0-9]{1,64}$/;
const ID_CUENTA = /^acc_[A-Za-z0-9]{1,64}$/;
const ID_NUMERO = /^acno_[A-Za-z0-9]{1,64}$/;
export const TIPO_ABONO = "transfer.inbound.succeeded";
/**
 * La doc vigente de Fintoc (inbound transfers, «Returning an inbound transfer»,
 * leída el 2026-11-10) lista este evento al terminar la devolución: la
 * transferencia pasa a `returned`. No publica el cuerpo del evento; se lee con
 * la misma forma de `transfer.inbound.succeeded` y el estado `returned` (lo
 * que dice su sección de pruebas), y se confirma en el sandbox antes de
 * encender Fintoc. `transfer.inbound.return_failed` regresa la transferencia a
 * `succeeded`: no cambia nada en Lever.
 */
export const TIPO_DEVOLUCION = "transfer.inbound.returned";

/** Lo común de la transferencia del evento, con el estado que le toca a su tipo. Nulo si algo no cuadra. */
function leerTransferencia(data: unknown, estado: "succeeded" | "returned") {
  const t = objeto(data);
  const numero = objeto(t?.account_number);
  const id = cadena(t?.id);
  const cuentaId = cadena(numero?.account_id);
  const cuentaNumeroId = cadena(numero?.id);
  const monto = t?.amount;
  const fecha = cadena(t?.transaction_date);
  if (
    !t || t.object !== "transfer" || t.direction !== "inbound" || t.status !== estado || t.currency !== "MXN"
    || !id || !ID_TRANSFERENCIA.test(id) || !cuentaId || !ID_CUENTA.test(cuentaId) || !cuentaNumeroId || !ID_NUMERO.test(cuentaNumeroId)
    || typeof monto !== "number" || !Number.isSafeInteger(monto) || monto <= 0
    || !fecha || Number.isNaN(Date.parse(fecha))
  ) {
    return null;
  }
  const referencia = cadena(t.reference_id);
  return {
    t,
    id,
    cuentaId,
    cuentaNumeroId,
    montoCentavos: monto,
    recibidoEl: hoyEnMexico(new Date(fecha)),
    // Tal como llegó si es numérica: la conciliación decide si son los 7 dígitos de una referencia (r63-N2).
    referencia: referencia && /^[0-9]{1,7}$/.test(referencia) ? referencia : null,
  };
}

/**
 * Lee el evento ya verificado. Devuelve nulo si no tiene la forma de un evento;
 * `abono` y `devolucion` nulos si es otro tipo de evento (se acusa y no se hace
 * nada). Un abono o una devolución con datos que no cuadran (moneda, monto,
 * ids) es nulo: se responde con error para que Fintoc reintente y quede en la alerta.
 */
export function leerAviso(json: unknown): AvisoFintoc | null {
  const evento = objeto(json);
  if (!evento) return null;
  const eventoId = cadena(evento.id);
  const tipo = cadena(evento.type);
  const modo = evento.mode === "live" || evento.mode === "test" ? evento.mode : null;
  if (!eventoId || !ID_EVENTO.test(eventoId) || !tipo || !modo) return null;
  if (tipo === TIPO_DEVOLUCION) {
    const d = leerTransferencia(evento.data, "returned");
    if (!d) return null;
    return {
      eventoId, tipo, modo, abono: null,
      devolucion: { idExterno: `fintoc:${d.id}`, transferenciaId: d.id, cuentaId: d.cuentaId, cuentaNumeroId: d.cuentaNumeroId, montoCentavos: d.montoCentavos, recibidoEl: d.recibidoEl, referencia: d.referencia },
    };
  }
  if (tipo !== TIPO_ABONO) return { eventoId, tipo, modo, abono: null, devolucion: null };
  const d = leerTransferencia(evento.data, "succeeded");
  if (!d) return null;
  const contraparte = objeto(d.t.counterparty);
  const rastreo = cadena(d.t.tracking_key);
  const ordenante = cadena(contraparte?.account_number);
  const nombre = cadena(contraparte?.holder_name)?.replace(/\s+/g, " ").trim().slice(0, 120) ?? null;
  return {
    eventoId,
    tipo,
    modo,
    devolucion: null,
    abono: {
      // El id de la transferencia: el mismo abono avisado en otro evento no crea otro pago.
      idExterno: `fintoc:${d.id}`,
      montoCentavos: d.montoCentavos,
      recibidoEl: d.recibidoEl,
      claveRastreo: rastreo && /^[A-Za-z0-9]{1,30}$/.test(rastreo) ? rastreo : null,
      referencia: d.referencia,
      clabeOrdenante: contraparte?.account_type === "clabe" && clabeValida(ordenante).ok ? ordenante : null,
      nombreOrdenante: nombre && nombre.length > 0 ? nombre : null,
      cuentaId: d.cuentaId,
      cuentaNumeroId: d.cuentaNumeroId,
    },
  };
}

// Cliente HTTP -------------------------------------------------------------------------

export type ClabeFintoc = { id: string; cuentaId: string; numero: string; clienteId: string | null; borrada: boolean };

export interface ClienteFintoc {
  /** Una página de CLABEs de la cuenta, después de `despuesDe`. */
  listarClabes(cuentaId: string, despuesDe: string | null): Promise<ClabeFintoc[]>;
  crearClabe(cuentaId: string, empresaId: string, clienteId: string, llaveIdempotencia: string): Promise<ClabeFintoc>;
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function clienteHttpFintoc(config: ConfigFintoc, hacerFetch: Fetch = fetch): ClienteFintoc {
  async function pedir(ruta: string, init: RequestInit): Promise<unknown> {
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), ESPERA_MS);
    try {
      const respuesta = await hacerFetch(`${API}${ruta}`, {
        ...init,
        signal: corte.signal,
        headers: { ...init.headers, Authorization: config.llaveSecreta, Accept: "application/json" },
      });
      if (!respuesta.ok) {
        console.error(JSON.stringify({ nivel: "error", origen: "cobranza.fintoc", evento: "fintoc_respondio_error", estado: respuesta.status }));
        throw new ErrorDeDominio("proveedor_no_disponible");
      }
      return await respuesta.json();
    } catch (error) {
      if (error instanceof ErrorDeDominio) throw error;
      console.error(JSON.stringify({ nivel: "error", origen: "cobranza.fintoc", evento: "fintoc_sin_respuesta" }));
      throw new ErrorDeDominio("proveedor_no_disponible");
    } finally {
      clearTimeout(reloj);
    }
  }
  return {
    async listarClabes(cuentaId, despuesDe) {
      const q = new URLSearchParams({ account_id: cuentaId, limit: "300" });
      if (despuesDe) q.set("starting_after", despuesDe);
      const lista = await pedir(`/v2/account_numbers?${q.toString()}`, { method: "GET" });
      if (!Array.isArray(lista)) throw new ErrorDeDominio("proveedor_no_disponible");
      return lista.map(leerClabe);
    },
    async crearClabe(cuentaId, empresaId, clienteId, llave) {
      const creada = await pedir("/v2/account_numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": llave },
        body: JSON.stringify({ account_id: cuentaId, description: "Cobranza Lever", metadata: { lever_empresa: empresaId, lever_cliente: clienteId } }),
      });
      return leerClabe(creada);
    },
  };
}

/** Una CLABE del proveedor que no cuadra (id, cuenta o dígito verificador) no se guarda. */
export function leerClabe(json: unknown): ClabeFintoc {
  const o = objeto(json);
  const id = cadena(o?.id);
  const cuentaId = cadena(o?.account_id);
  const numero = cadena(o?.number);
  if (!id || !ID_NUMERO.test(id) || !cuentaId || !ID_CUENTA.test(cuentaId) || !clabeValida(numero).ok) {
    throw new ErrorDeDominio("proveedor_no_disponible");
  }
  const metadata = objeto(o?.metadata);
  return { id, cuentaId, numero: numero!, clienteId: cadena(metadata?.lever_cliente), borrada: Boolean(o?.deleted_at) };
}

// Cuenta de la empresa -----------------------------------------------------------------

/**
 * El personal de Lever registra la cuenta de la empresa en Fintoc (el Account
 * de su Entity, `acc_…`), después de que Fintoc aprobó su KYB. Nunca en una
 * empresa de demostración. Lo usa scripts/cobranza-fintoc.ts.
 */
export async function registrarCuentaFintoc(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { empresaId: unknown; cuentaId: unknown },
  deps?: { auditar?: Auditar },
): Promise<void> {
  const personal = exigirPersonal(ctx, "plataforma.empresa.alta");
  const empresaId = typeof entrada.empresaId === "string" && /^[0-9a-f-]{36}$/i.test(entrada.empresaId) ? entrada.empresaId.toLowerCase() : null;
  const cuentaId = typeof entrada.cuentaId === "string" && ID_CUENTA.test(entrada.cuentaId) ? entrada.cuentaId : null;
  if (!empresaId || !cuentaId) throw new ErrorDeDominio("entrada_invalida");
  await conContexto(basePlataforma(personal, empresaId), async (consulta) => {
    const empresa = await aplicarSentencia(consulta, "select demostracion from companies where id = $1", [empresaId]);
    const fila = empresa.rows[0] ? registro(empresa.rows[0]) : null;
    if (!fila) throw new ErrorDeDominio("sin_empresa");
    if (fila.demostracion === true) throw new ErrorDeDominio("solo_empresas_reales");
    await aplicarSentencia(consulta, "select cobranza_registrar_cuenta_proveedor($1, 'fintoc', $2)", [empresaId, cuentaId]);
    await (deps?.auditar ?? auditarPorDefecto)(consulta, actorDePersonal(personal, empresaId, "comando"), {
      accion: "cuenta_proveedor_cobranza",
      identificador: empresaId,
      cambio: { proveedor: "fintoc", cuenta: cuentaId },
    });
  });
}

export type AvisoSinDestino = {
  eventoId: string;
  tipo: string;
  transferenciaId: string;
  cuentaId: string;
  cuentaNumeroId: string;
  montoCentavos: number;
  recibidoEl: string;
  referencia: string | null;
  recibidoEn: string;
};

/**
 * Los avisos de Fintoc que no llegaron a ninguna empresa ni a ningún pago
 * (r63-N7), los más recientes primero. Solo el personal de administración de
 * la plataforma; la base lo vuelve a revisar (cobranza_avisos_sin_destino).
 */
export async function leerAvisosSinDestino(ctx: ContextoDeTenant | null | undefined, limite = 50): Promise<AvisoSinDestino[]> {
  const personal = exigirPersonal(ctx, "plataforma.empresa.alta");
  const tope = Number.isInteger(limite) ? Math.min(Math.max(limite, 1), 500) : 50;
  return conContexto(basePlataforma(personal), async (consulta) => {
    const r = await aplicarSentencia(
      consulta,
      `select evento_id, tipo, transferencia_id, cuenta_id, cuenta_numero_id, monto_centavos::text as monto,
              to_char(recibido_el, 'YYYY-MM-DD') as recibido_el, referencia, recibido_en::text as recibido_en
         from cobranza_avisos_sin_destino($1)`,
      [tope],
    );
    return r.rows.map(registro).map((f) => ({
      eventoId: texto(f.evento_id),
      tipo: texto(f.tipo),
      transferenciaId: texto(f.transferencia_id),
      cuentaId: texto(f.cuenta_id),
      cuentaNumeroId: texto(f.cuenta_numero_id),
      montoCentavos: centavos(f.monto),
      recibidoEl: texto(f.recibido_el),
      referencia: textoONulo(f.referencia),
      recibidoEn: texto(f.recibido_en),
    }));
  });
}

// CLABE de un cliente ------------------------------------------------------------------

export type ClabeDeCliente = { clabe: string; recuperada: boolean; nueva: boolean };

/**
 * La CLABE propia del cliente en la cuenta de la empresa, creándola si falta.
 * Todo va con el cliente bloqueado (FOR UPDATE): dos altas a la vez del mismo
 * cliente esperan una a la otra y la segunda encuentra la de la primera. Antes
 * de crear se busca en Fintoc una CLABE con el id del cliente en su metadata:
 * si un intento anterior se cayó después de que Fintoc la creó (la llave de
 * idempotencia solo dura 24 h), se recupera esa en lugar de crear otra.
 * Devuelve nulo si la empresa no tiene cuenta en Fintoc.
 */
export async function asegurarClabeDeCliente(
  base: ContextoDeBase,
  actor: Actor,
  auditar: Auditar,
  clienteId: string,
  fintoc: ClienteFintoc,
): Promise<ClabeDeCliente | null> {
  const empresaId = actor.companyId;
  if (!empresaId) throw new ErrorDeDominio("sin_empresa");
  return conContexto(base, async (consulta) => {
    const cliente = await aplicarSentencia(
      consulta,
      "select id from collection_customers where company_id = $1 and id = $2 and estado = 'activo' for update",
      [empresaId, clienteId],
    );
    if (cliente.rows.length !== 1) throw new ErrorDeDominio("cliente_no_encontrado");
    const guardada = await clabeGuardada(consulta, empresaId, clienteId);
    if (guardada) return { clabe: guardada, recuperada: false, nueva: false };
    const cuenta = await aplicarSentencia(
      consulta,
      "select cuenta_id from collection_provider_accounts where company_id = $1 and proveedor = 'fintoc'",
      [empresaId],
    );
    const cuentaId = cuenta.rows[0] ? texto(registro(cuenta.rows[0]).cuenta_id) : null;
    if (!cuentaId) return null;
    let clabe = await buscarClabeDelCliente(fintoc, cuentaId, clienteId);
    const recuperada = clabe !== null;
    clabe ??= await fintoc.crearClabe(cuentaId, empresaId, clienteId, `lever-clabe-${clienteId}`);
    if (clabe.cuentaId !== cuentaId || (clabe.clienteId !== null && clabe.clienteId !== clienteId)) {
      throw new ErrorDeDominio("proveedor_no_disponible");
    }
    const id = randomUUID();
    await aplicarSentencia(
      consulta,
      `insert into collection_virtual_accounts (id, company_id, customer_id, proveedor, cuenta_numero_id, clabe, creado_por)
       values ($1, $2, $3, 'fintoc', $4, $5, $6)`,
      [id, empresaId, clienteId, clabe.id, clabe.numero, autorDe(actor)],
    );
    await auditar(consulta, actor, {
      accion: "clabe_cliente_cobranza",
      identificador: id,
      cambio: { proveedor: "fintoc", terminacion: clabe.numero.slice(-4), recuperada },
    });
    return { clabe: clabe.numero, recuperada, nueva: true };
  });
}

export async function clabeGuardada(consulta: Consulta, empresaId: string, clienteId: string): Promise<string | null> {
  const r = await aplicarSentencia(
    consulta,
    "select clabe from collection_virtual_accounts where company_id = $1 and customer_id = $2 and proveedor = 'fintoc'",
    [empresaId, clienteId],
  );
  return r.rows[0] ? texto(registro(r.rows[0]).clabe) : null;
}

async function buscarClabeDelCliente(fintoc: ClienteFintoc, cuentaId: string, clienteId: string): Promise<ClabeFintoc | null> {
  let despuesDe: string | null = null;
  for (let pagina = 0; pagina < PAGINAS_DE_BUSQUEDA; pagina += 1) {
    const clabes = await fintoc.listarClabes(cuentaId, despuesDe);
    const suya = clabes.find((c) => c.clienteId === clienteId && !c.borrada);
    if (suya) return suya;
    if (clabes.length < 300) return null;
    despuesDe = clabes[clabes.length - 1]!.id;
  }
  // No se terminó de revisar: crear otra podría duplicarla.
  throw new ErrorDeDominio("proveedor_no_disponible");
}

// El aviso de un abono -----------------------------------------------------------------

export type RespuestaAviso = { estado: 200 | 400 | 404 | 413 | 500; cuerpo: Record<string, unknown> };

export type DepsAviso = {
  config: ConfigFintoc | null;
  ahora: () => Date;
  auditar: Auditar;
} & Pick<DependenciasCobranza, "enviador" | "urlPublica" | "registrar">;

/**
 * Atiende `POST /webhooks/fintoc`. 400 solo con firma inválida o vieja (más de
 * cinco minutos). El mismo evento otra vez, con firma válida, es un reintento
 * de Fintoc: 200 sin efecto. Responde en cuanto la transacción confirma.
 */
export async function atenderAviso(cuerpo: Uint8Array, firma: string | null, deps: DepsAviso): Promise<RespuestaAviso> {
  const config = deps.config;
  if (!config) return { estado: 404, cuerpo: { error: "no_encontrado" } };
  if (cuerpo.byteLength > TOPE_CUERPO) return { estado: 413, cuerpo: { error: "muy_grande" } };
  const verificada = verificarFirma(cuerpo, firma, config.secretoWebhook, Math.floor(deps.ahora().getTime() / 1000));
  if (verificada !== "valida") {
    registrar("warn", "aviso_rechazado", { motivo: verificada });
    return { estado: 400, cuerpo: { error: "firma_no_valida" } };
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(cuerpo));
  } catch {
    registrar("error", "aviso_ilegible", {});
    return { estado: 400, cuerpo: { error: "aviso_ilegible" } };
  }
  const aviso = leerAviso(json);
  if (!aviso) {
    registrar("error", "aviso_ilegible", {});
    return { estado: 500, cuerpo: { error: "aviso_ilegible" } };
  }
  if (!aviso.abono && !aviso.devolucion) return { estado: 200, cuerpo: { ok: true, efecto: "ignorado" } };
  if (aviso.modo !== config.modo) {
    registrar("error", "aviso_de_otro_modo", { evento_id: aviso.eventoId, modo: aviso.modo });
    return { estado: 200, cuerpo: { ok: true, efecto: "ignorado" } };
  }
  const transferencia = aviso.abono ?? aviso.devolucion!;
  const destino = await conContexto({ rol: "plataforma_cliente" }, (consulta) => destinoDe(consulta, transferencia));
  if (!destino) return guardarSinDestino(aviso, transferencia);
  // r63j-N2: con la empresa activa, primero los retenidos que queden de su suspensión, en el orden en que llegaron: una
  // devolución nunca se adelanta a su abono. Con la empresa suspendida no hace nada.
  await procesarRetenidos(destino.empresaId, destino.operadorId, deps);
  // Todo bajo el candado de la empresa, el mismo que toman la suspensión y la reactivación (r63j-N2): el estado que se
  // lee aquí no cambia hasta el commit.
  const atender = () => conContexto(baseDe(destino), async (consulta): Promise<ResultadoAplicado | ResultadoRetenido> => {
    // Dos entregas del mismo evento a la vez: la segunda espera y lo encuentra visto.
    await bloquearEmpresa(consulta, destino.empresaId);
    if (await eventoVisto(consulta, aviso.eventoId)) return { efecto: "repetido" };
    // r63i-N1: la empresa suspendida (o de baja) no escribe; el aviso se retiene sin aplicarse.
    if (await empresaSinOperar(consulta, destino.empresaId)) return retenerAviso(consulta, aviso, destino, deps);
    return aplicarAviso(consulta, aviso, destino, deps);
  });
  let resultado: ResultadoAplicado | ResultadoRetenido;
  try {
    resultado = await atender();
  } catch (error) {
    // Una suspensión que no toma el candado (la de la lista de personas bloqueadas, dentro de la base) confirmó
    // mientras este aviso escribía y la base lo frenó a medio camino (bloqueo_empresa_suspendida). Nada de lo anterior
    // quedó; la segunda vuelta ve la empresa suspendida y lo retiene.
    if (!(error instanceof ErrorDeDominio && error.codigo === "empresa_suspendida")) throw error;
    resultado = await atender();
  }
  if (esRetenido(resultado)) {
    registrar("warn", "aviso_retenido", { evento_id: aviso.eventoId, nuevo: resultado.efecto === "retenido" });
    return { estado: 200, cuerpo: { ok: true, efecto: resultado.efecto === "retenido" ? "retenido" : "repetido" } };
  }
  return terminarAviso(aviso, resultado, destino, deps);
}

type ResultadoRetenido = { efecto: "retenido" | "retenido_repetido" };
const esRetenido = (r: ResultadoAplicado | ResultadoRetenido): r is ResultadoRetenido => r.efecto === "retenido" || r.efecto === "retenido_repetido";

type Destino = { empresaId: string; operadorId: string; clienteDeLaCuenta: string | null };

/** El efecto de un aviso ya aplicado en su transacción; lo que falta (correo, «sin destino») va después del commit. */
type ResultadoAplicado =
  | { efecto: "registrado" | "repetido" | "sin_pago" | "anulado" }
  | { efecto: "devuelto"; pagoId: string; cliente: string | null; monto: number };

async function destinoDe(consulta: Consulta, t: AbonoFintoc | DevolucionFintoc): Promise<Destino | null> {
  const fila = (await aplicarSentencia(consulta, "select company_id, operator_id, customer_id from cobranza_destino_fintoc($1, $2)", [t.cuentaId, t.cuentaNumeroId])).rows.map(registro)[0];
  if (!fila) return null;
  return { empresaId: texto(fila.company_id), operadorId: texto(fila.operator_id), clienteDeLaCuenta: fila.customer_id ? texto(fila.customer_id) : null };
}

const baseDe = (d: Destino): ContextoDeBase => ({ rol: "plataforma_cliente", companyId: d.empresaId, operadorId: d.operadorId });
const actorDe = (d: Destino): Actor => ({ operadorId: d.operadorId, companyId: d.empresaId, actorTipo: "sistema", actorId: null, superficie: "cliente", peticionId: null, origen: "fintoc" });

async function eventoVisto(consulta: Consulta, eventoId: string): Promise<boolean> {
  const r = await aplicarSentencia(consulta, "select 1 from collection_provider_events where proveedor = 'fintoc' and evento_id = $1", [eventoId]);
  return r.rows.length > 0;
}

async function empresaSinOperar(consulta: Consulta, empresaId: string): Promise<boolean> {
  const r = await aplicarSentencia(consulta, "select estado from companies where id = $1", [empresaId]);
  const estado = r.rows[0] ? registro(r.rows[0]).estado : null;
  return estado === "suspendida" || estado === "baja";
}

/** El camino normal de un aviso, dentro de la transacción de quien llama, con la empresa bloqueada y el evento sin ver. */
async function aplicarAviso(consulta: Consulta, aviso: AvisoFintoc, destino: Destino, deps: Pick<DepsAviso, "auditar">): Promise<ResultadoAplicado> {
  const actor = actorDe(destino);
  if (aviso.devolucion) return aplicarDevolucion(consulta, aviso, aviso.devolucion, destino.empresaId, actor, deps);
  const { idExterno, montoCentavos, recibidoEl, claveRastreo, referencia, clabeOrdenante, nombreOrdenante } = aviso.abono!;
  const recibido = await recibirAbono(consulta, actor, deps.auditar, "fintoc", {
    idExterno, montoCentavos, recibidoEl, claveRastreo, referencia, clabeOrdenante, nombreOrdenante, clienteDeLaCuenta: destino.clienteDeLaCuenta,
  });
  await registrarEvento(consulta, aviso, destino, recibido.pagoId, recibido.repetido, deps);
  return { efecto: recibido.repetido ? "repetido" : "registrado" };
}

async function registrarEvento(consulta: Consulta, aviso: AvisoFintoc, destino: Destino, pagoId: string, repetido: boolean, deps: Pick<DepsAviso, "auditar">): Promise<void> {
  const id = randomUUID();
  await aplicarSentencia(
    consulta,
    "insert into collection_provider_events (id, company_id, proveedor, evento_id, payment_id) values ($1, $2, 'fintoc', $3, $4)",
    [id, destino.empresaId, aviso.eventoId, pagoId],
  );
  await deps.auditar(consulta, actorDe(destino), { accion: "aviso_proveedor_cobranza", identificador: id, cambio: { proveedor: "fintoc", repetido } });
}

/** Lo que va después del commit: la devolución sin pago queda «sin destino» y la devuelta avisa al equipo. */
async function terminarAviso(aviso: AvisoFintoc, resultado: ResultadoAplicado, destino: Destino, deps: DepsAviso | DepsRetenidos): Promise<RespuestaAviso> {
  if (resultado.efecto === "sin_pago") return guardarSinDestino(aviso, aviso.devolucion!);
  if (resultado.efecto === "devuelto") {
    const empresa = await conContexto(baseDe(destino), async (consulta) =>
      registro((await aplicarSentencia(consulta, "select razon_social, demostracion from companies where id = $1", [destino.empresaId])).rows[0]));
    await avisarAlEquipo({ empresa: { id: destino.empresaId, operadorId: destino.operadorId, demostracion: empresa.demostracion === true } }, deps, plantillaAvisoDevolucionCobranza({
      razonSocial: texto(empresa.razon_social),
      cliente: resultado.cliente,
      monto: formatoPesos(resultado.monto),
      enlace: `${(deps.urlPublica ?? (() => leerUrlPublica()))()}/c/${destino.empresaId}/consola/cobros`,
    }), `cobranza-devolucion/${resultado.pagoId}`);
  }
  registrar("info", "aviso_atendido", { evento_id: aviso.eventoId, efecto: resultado.efecto });
  return { estado: 200, cuerpo: { ok: true, efecto: resultado.efecto } };
}

/**
 * r63i-N1 (decisión de Gil): el aviso de una empresa suspendida o de baja se guarda sin aplicarse, con su evento en
 * la bitácora (sin datos del ordenante), y Cumplimiento lo ve en su bandeja. Va en la transacción de quien llama, con
 * la empresa bloqueada: 200 solo después del commit; si no se pudo, la excepción llega a la ruta, que responde 500 y
 * Fintoc reintenta. El mismo evento otra vez no se duplica.
 */
async function retenerAviso(consulta: Consulta, aviso: AvisoFintoc, destino: Destino, deps: Pick<DepsAviso, "auditar">): Promise<ResultadoRetenido> {
  const t = aviso.abono ?? aviso.devolucion!;
  const r = await aplicarSentencia(
    consulta,
    "select cobranza_retener_aviso($1, $2, $3, $4::date, $5::jsonb) as id",
    [aviso.eventoId, aviso.tipo, t.montoCentavos, t.recibidoEl, JSON.stringify(aviso)],
  );
  const id = registro(r.rows[0]).id;
  if (!id) return { efecto: "retenido_repetido" };
  await deps.auditar(consulta, actorDe(destino), {
    accion: "retener_aviso_cobranza",
    identificador: texto(id),
    cambio: { proveedor: "fintoc", tipo: aviso.abono ? "abono" : "devolucion", monto_centavos: t.montoCentavos },
  });
  return { efecto: "retenido" };
}

type DatosRetenido = { devolucion: boolean; montoCentavos: number; recibidoEl: string; referencia: string | null };

/**
 * Decisión de Gil (2026-11-11): un retenido que queda fallido se avisa por correo a administración y finanzas de la
 * empresa (avisarAlEquipo: solo personas activas de esa empresa con esos roles), además de la bandeja de Cumplimiento.
 * Si el envío falla, el fallido no se deshace; el evento de la bitácora dice cuántos correos nuevos salieron y cuántas
 * personas siguen sin recibirlo, y la tarea diaria se lo vuelve a mandar solo a ellas (r63m, reavisarFallidos).
 *
 * r63o: la llave es por persona (`cobranza-retenido-fallido/<retenido>/<persona>`) y la fila guarda los ids de quienes
 * ya lo recibieron. Quien lo manda lo reserva antes (cobranza_tomar_aviso_fallido), así que el aviso y la tarea no lo
 * mandan a la vez ni la bitácora cuenta dos veces un correo. Se reintenta como máximo 7 días desde que quedó fallido.
 * Decisiones del líder: una empresa de demostración no recibe nada y queda cerrada (r63n); sin nadie activo de
 * administración o finanzas, el primer aviso deja un evento con ese motivo y la tarea revisa en silencio esos 7 días:
 * en cuanto haya alguien, le llega, y mientras no, no deja eventos (r63n-4).
 */
async function avisarRetenidoFallido(empresa: Destino, id: string, d: DatosRetenido, deps: DepsRetenidos, reintento = false): Promise<number> {
  let previos: string[] | null;
  let fila: Record<string, unknown>;
  try {
    [previos, fila] = await conContexto(baseDe(empresa), async (consulta) => {
      const tomado = registro((await aplicarSentencia(consulta, "select cobranza_tomar_aviso_fallido($1)::text[] as recibieron", [id])).rows[0]).recibieron;
      const datos = registro((await aplicarSentencia(consulta, "select razon_social, demostracion from companies where id = $1", [empresa.empresaId])).rows[0]);
      return [Array.isArray(tomado) ? tomado.map(texto) : null, datos] as const;
    });
  } catch {
    registrar("error", "aviso_retenido_fallido_no_preparado", {});
    return 0;
  }
  // Ya le llegó a todos, pasaron los 7 días, o alguien más lo está mandando.
  if (previos === null) return 0;
  // Sin la plantilla (la URL pública sin configurar) no sale nada: queda pendiente, para el reintento.
  let r: Awaited<ReturnType<typeof avisarAlEquipoConMotivo>> = { enviados: 0, recibieron: [], fallaron: [], pendientes: 1, sinEnvio: null };
  try {
    r = await avisarAlEquipoConMotivo({ empresa: { id: empresa.empresaId, operadorId: empresa.operadorId, demostracion: fila.demostracion === true } }, deps,
      plantillaAvisoRetenidoFallidoCobranza({
        razonSocial: texto(fila.razon_social),
        devolucion: d.devolucion,
        monto: formatoPesos(d.montoCentavos),
        fecha: fechaConAnio(d.recibidoEl),
        referencia: d.referencia,
        enlace: `${(deps.urlPublica ?? (() => leerUrlPublica()))()}/c/${empresa.empresaId}/consola/cobros`,
      }), `cobranza-retenido-fallido/${id}`, new Set(previos));
  } catch {
    registrar("error", "aviso_retenido_fallido_no_preparado", {});
  }
  // r63p: la base solo lo cierra si además ya no falta nadie a quien se le haya intentado antes (aunque hoy no esté activo).
  const cerrar = r.sinEnvio === "demostracion" || (r.sinEnvio === null && r.pendientes === 0);
  // En el reintento, sin nadie a quién mandarlo (o sin nadie nuevo), no queda evento: sería ruido diario.
  const sinEvento = reintento && (r.sinEnvio === "sin_destinatarios" || (r.sinEnvio === null && r.recibieron.length === 0 && r.pendientes === 0));
  try {
    await conContexto(baseDe(empresa), async (consulta) => {
      // r63q-2: «pendientes» son todas las personas que siguen en faltan al soltar (también las que hoy no están activas),
      // no solo las que fallaron en esta vuelta; soltar y el evento van en la misma transacción. Si el correo no se pudo
      // preparar, nadie quedó en faltan y ese envío sin hacer cuenta aparte (r.pendientes − r.fallaron).
      const faltan = Number(registro((await aplicarSentencia(consulta,
        "select cobranza_soltar_aviso_fallido($1, $2::uuid[], $3::uuid[], $4) as faltan", [id, r.recibieron, r.fallaron, cerrar])).rows[0]).faltan);
      if (!sinEvento) {
        await deps.auditar(consulta, actorDe(empresa), {
          accion: "aviso_retenido_fallido_cobranza",
          identificador: id,
          cambio: r.sinEnvio ? { enviados: 0, motivo: r.sinEnvio } : { enviados: r.enviados, recibidos: r.recibieron.length, pendientes: faltan + r.pendientes - r.fallaron.length },
        });
      }
    });
  } catch {
    // La reserva vence sola en una hora; lo que salió queda en el registro.
    registrar("error", "aviso_retenido_fallido_sin_bitacora", { enviados: r.enviados });
  }
  return r.enviados;
}

/** Lo que el correo de un retenido necesita de su fila guardada: monto, fecha, tipo y referencia, sin el ordenante. */
function datosDeRetenido(fila: Record<string, unknown>): DatosRetenido {
  const aviso = fila.aviso as AvisoFintoc | null;
  return {
    devolucion: texto(fila.tipo) === "transfer.inbound.returned",
    montoCentavos: centavos(fila.monto),
    recibidoEl: texto(fila.recibido_el),
    referencia: aviso?.abono?.referencia ?? aviso?.devolucion?.referencia ?? null,
  };
}

/**
 * r63m: los fallidos de la empresa cuyo correo no le llegó a todos se vuelven a avisar, solo a quienes faltan y con la
 * llave de cada persona (r63o), uno por uno. Lo llama la tarea diaria, hasta 7 días después de que quedó fallido.
 * Devuelve a cuántos fallidos les salió al menos un correo nuevo.
 */
export async function reavisarFallidos(empresaId: string, operadorId: string, deps: DepsRetenidos): Promise<number> {
  const empresa: Destino = { empresaId, operadorId, clienteDeLaCuenta: null };
  const filas = await conContexto(baseDe(empresa), async (consulta) =>
    (await aplicarSentencia(
      consulta,
      "select id, aviso, tipo, monto_centavos::text as monto, recibido_el::text as recibido_el from cobranza_fallidos_sin_aviso()",
    )).rows.map(registro));
  let avisados = 0;
  for (const fila of filas) {
    if ((await avisarRetenidoFallido(empresa, texto(fila.id), datosDeRetenido(fila), deps, true)) > 0) avisados += 1;
  }
  return avisados;
}

/**
 * r63k-N2: lo que puede pasar solo (la base sin respuesta, un interbloqueo o una conexión caída, o la bitácora). La base
 * traduce también sus errores de datos a base_no_disponible: por eso el reintento tiene tope (cobranza_retenido_reintento).
 */
const PASAJEROS = new Set(["base_no_disponible", "auditoria_no_disponible"]);

export type DepsRetenidos = Pick<DepsAviso, "auditar" | "enviador" | "urlPublica" | "registrar">;

/**
 * Los avisos retenidos de una empresa que ya está activa, uno por transacción y en el orden en que llegaron, por el
 * camino normal: el freno de duplicados, el cliente sin duda y el evento visto hacen que nada se aplique dos veces.
 * Idempotente: con la empresa bloqueada, dos corridas a la vez se forman y la segunda ya no los ve. Lo llaman la
 * reactivación (después de su commit, con un tope), la tarea diaria y cada aviso nuevo de la empresa (r63j-N2). Con la
 * empresa suspendida o de baja no hace nada.
 *
 * r63j-N1: cada retenido va aislado. Si el camino normal lo rechaza por una regla, su transacción se deshace y queda
 * «fallido» con el código del error (sin datos), a la vista de Cumplimiento, y los demás siguen: uno envenenado no frena
 * la cobranza de la empresa. r63k-N2: si el error es pasajero, la corrida se detiene y el retenido sigue pendiente con
 * un intento más; al quinto, queda fallido. Si ni siquiera se puede anotar, la corrida se detiene igual.
 */
export async function procesarRetenidos(empresaId: string, operadorId: string, deps: DepsRetenidos, tope = Number.POSITIVE_INFINITY): Promise<number> {
  const empresa: Destino = { empresaId, operadorId, clienteDeLaCuenta: null };
  let procesados = 0;
  while (procesados < tope) {
    let pendiente: string | null = null;
    let datos: DatosRetenido | null = null;
    let paso: { aviso: AvisoFintoc; resultado: ResultadoAplicado; destino: Destino } | null;
    try {
      paso = await conContexto(baseDe(empresa), async (consulta) => {
        await bloquearEmpresa(consulta, empresaId);
        const fila = (await aplicarSentencia(
          consulta,
          "select id, aviso, tipo, monto_centavos::text as monto, recibido_el::text as recibido_el from cobranza_retenidos_de_empresa() limit 1",
        )).rows.map(registro)[0];
        if (!fila) return null;
        pendiente = texto(fila.id);
        const aviso = fila.aviso as AvisoFintoc;
        datos = datosDeRetenido(fila);
        const t = aviso.abono ?? aviso.devolucion;
        // Un aviso guardado sin abono ni devolución no se aplicará nunca: permanente, no pasajero (r63k-N2).
        if (!t) throw new ErrorDeDominio("aviso_ilegible");
        // La CLABE propia sigue diciendo el cliente si es de esta empresa; si la cuenta cambió de empresa, sin cliente.
        const ahora = await destinoDe(consulta, t);
        const destino: Destino = { ...empresa, clienteDeLaCuenta: ahora?.empresaId === empresaId ? ahora.clienteDeLaCuenta : null };
        const resultado: ResultadoAplicado = (await eventoVisto(consulta, aviso.eventoId))
          ? { efecto: "repetido" }
          : await aplicarAviso(consulta, aviso, destino, deps);
        await aplicarSentencia(consulta, "select cobranza_retenido_procesado($1, $2)", [pendiente, resultado.efecto]);
        await deps.auditar(consulta, actorDe(destino), { accion: "procesar_retenido_cobranza", identificador: pendiente, cambio: { efecto: resultado.efecto } });
        return { aviso, resultado, destino };
      });
    } catch (error) {
      if (pendiente === null) throw error;
      const id: string = pendiente;
      const motivo = error instanceof ErrorDeDominio ? error.codigo : "desconocido";
      const pasajero = PASAJEROS.has(motivo);
      let fallido: boolean;
      try {
        fallido = await conContexto(baseDe(empresa), async (consulta) => {
          await bloquearEmpresa(consulta, empresaId);
          const quedo = pasajero
            ? registro((await aplicarSentencia(consulta, "select cobranza_retenido_reintento($1, $2) as fallido", [id, motivo])).rows[0]).fallido === true
            : (await aplicarSentencia(consulta, "select cobranza_retenido_fallido($1, $2)", [id, motivo]), true);
          if (quedo) await deps.auditar(consulta, actorDe(empresa), { accion: "retenido_fallido_cobranza", identificador: id, cambio: { motivo } });
          return quedo;
        });
      } catch {
        // Ni siquiera se pudo anotar (la base no responde): el retenido sigue pendiente y se reintenta después.
        throw error;
      }
      // r63k-N2: un error pasajero detiene la corrida y deja el retenido pendiente (con un intento más) para el
      // siguiente aviso o la tarea; los que vienen detrás esperan, en orden. Al quinto queda fallido y los demás siguen.
      if (!fallido) throw error;
      registrar("error", "retenido_fallido", { motivo });
      if (datos) await avisarRetenidoFallido(empresa, id, datos, deps);
      procesados += 1;
      continue;
    }
    if (!paso) return procesados;
    await terminarAviso(paso.aviso, paso.resultado, paso.destino, deps);
    procesados += 1;
  }
  return procesados;
}

/**
 * Un aviso que no llega a ninguna empresa (cuenta sin registrar) o una
 * devolución de una transferencia que Lever no tiene: queda guardado «sin
 * destino» para que el personal lo revise (r63-N7). Responder 200 sin guardarlo
 * perdía el abono, porque Fintoc ya no reintenta. El registro no lleva datos.
 */
async function guardarSinDestino(aviso: AvisoFintoc, t: AbonoFintoc | DevolucionFintoc): Promise<RespuestaAviso> {
  const transferenciaId = "transferenciaId" in t ? t.transferenciaId : t.idExterno.slice("fintoc:".length);
  const nuevo = await conContexto({ rol: "plataforma_cliente" }, async (consulta) => {
    const r = await aplicarSentencia(
      consulta,
      "select cobranza_guardar_aviso_sin_destino($1, $2, $3, $4, $5, $6, $7::date, $8) as nuevo",
      [aviso.eventoId, aviso.tipo, transferenciaId, t.cuentaId, t.cuentaNumeroId, t.montoCentavos, t.recibidoEl, t.referencia],
    );
    return registro(r.rows[0]).nuevo === true;
  });
  registrar("error", "aviso_sin_destino", { nuevo });
  return { estado: 200, cuerpo: { ok: true, efecto: nuevo ? "sin_destino" : "repetido" } };
}

const MOTIVO_DEVOLUCION = "Fintoc avisó que la empresa devolvió esta transferencia al ordenante.";

/**
 * `transfer.inbound.returned` (r63-N8): la empresa le devolvió el abono al
 * ordenante desde Fintoc. Se revierte cada aplicación del pago (el cargo vuelve
 * a emitido con su saldo y vuelve a recibir recordatorios), el pago queda
 * «devuelto» (sin saldo a favor) y se avisa a administración y finanzas.
 */
async function aplicarDevolucion(
  consulta: Consulta,
  aviso: AvisoFintoc,
  devolucion: DevolucionFintoc,
  empresaId: string,
  actor: Actor,
  deps: Pick<DepsAviso, "auditar">,
): Promise<ResultadoAplicado> {
  const r = await aplicarSentencia(
    consulta,
    `select p.id, p.estado, p.monto_centavos::text as monto, k.nombre as cliente
       from collection_payments p left join collection_customers k on k.id = p.customer_id and k.company_id = p.company_id
      where p.company_id = $1 and p.fuente = 'fintoc' and p.id_externo = $2 for update of p`,
    [empresaId, devolucion.idExterno],
  );
  const pago = r.rows[0] ? registro(r.rows[0]) : null;
  if (!pago) return { efecto: "sin_pago" as const };
  const pagoId = texto(pago.id);
  let devuelto = false;
  // r63j-N1: la empresa ya lo había descartado como duplicado (anulado, sin aplicaciones): la devolución no tiene nada
  // que revertir. Queda resuelta con su evento, sin error; antes lanzaba pago_anulado (500 y Fintoc reintentaba).
  const anulado = pago.estado === "anulado";
  if (pago.estado !== "devuelto" && !anulado) {
    const aplicaciones = await aplicarSentencia(
      consulta,
      `select a.id, a.charge_id, a.monto_centavos::text as monto from collection_applications a
        where a.company_id = $1 and a.payment_id = $2 and a.regla <> 'reversion'
          and not exists (select 1 from collection_applications x where x.company_id = a.company_id and x.revierte_a = a.id)
        order by a.aplicado_en, a.id`,
      [empresaId, pagoId],
    );
    for (const a of aplicaciones.rows.map(registro)) {
      const monto = centavos(a.monto);
      const id = randomUUID();
      await aplicarSentencia(
        consulta,
        `insert into collection_applications (id, company_id, payment_id, charge_id, monto_centavos, regla, revierte_a, aplicado_por)
         values ($1, $2, $3, $4, $5, 'reversion', $6, null)`,
        [id, empresaId, pagoId, texto(a.charge_id), -monto, texto(a.id)],
      );
      await deps.auditar(consulta, actor, { accion: "aplicacion_cobranza", identificador: id, motivo: MOTIVO_DEVOLUCION, cambio: { monto_centavos: -monto, regla: "reversion" } });
      const cargo = await aplicarSentencia(
        consulta,
        `update collection_charges set pagado_centavos = pagado_centavos - $3, estado = 'emitido', pagado_el = null
          where company_id = $1 and id = $2 and estado in ('emitido', 'pagado') returning pagado_centavos::text as pagado`,
        [empresaId, texto(a.charge_id), monto],
      );
      if (!cargo.rows[0]) throw new ErrorDeDominio("cargo_ya_resuelto");
      await deps.auditar(consulta, actor, { accion: "abono_cargo", identificador: texto(a.charge_id), cambio: { pagado_centavos: centavos(registro(cargo.rows[0]).pagado), estado: "emitido" } });
    }
    const marcado = await aplicarSentencia(
      consulta,
      `update collection_payments set aplicado_centavos = 0, estado = 'devuelto', motivo_anulacion = $3
        where company_id = $1 and id = $2 and estado in ('abierto', 'aplicado')`,
      [empresaId, pagoId, MOTIVO_DEVOLUCION],
    );
    if (marcado.rowCount !== 1) throw new ErrorDeDominio("pago_anulado");
    await deps.auditar(consulta, actor, { accion: "devolver_pago_cobranza", identificador: pagoId, motivo: MOTIVO_DEVOLUCION, cambio: { proveedor: "fintoc", monto_centavos: centavos(pago.monto) } });
    devuelto = true;
  }
  const id = randomUUID();
  await aplicarSentencia(
    consulta,
    "insert into collection_provider_events (id, company_id, proveedor, evento_id, payment_id) values ($1, $2, 'fintoc', $3, $4)",
    [id, empresaId, aviso.eventoId, pagoId],
  );
  await deps.auditar(consulta, actor, { accion: "aviso_proveedor_cobranza", identificador: id, cambio: { proveedor: "fintoc", repetido: !devuelto } });
  if (anulado) return { efecto: "anulado" as const };
  return devuelto
    ? { efecto: "devuelto" as const, pagoId, cliente: textoONulo(pago.cliente), monto: centavos(pago.monto) }
    : { efecto: "repetido" as const };
}

/** Fintoc como fuente: hay llaves y la empresa no es de demostración. Falta además su cuenta registrada (collection_provider_accounts). */
export const fuenteFintoc: FuenteDeAbonos = {
  fuente: "fintoc",
  disponiblePara: (empresa) => !empresa.demostracion && configFintoc() !== null,
};

function registrar(nivel: "info" | "warn" | "error", evento: string, datos: Record<string, unknown>): void {
  const linea = JSON.stringify({ nivel, origen: "cobranza.fintoc", evento, ...datos });
  if (nivel === "error") console.error(linea);
  else if (nivel === "warn") console.warn(linea);
  else console.info(linea);
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function cadena(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= 500 ? v : null;
}
