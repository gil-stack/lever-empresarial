import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { clabeValida } from "../../dominio/clabe";
import { hoyEnMexico } from "../../dominio/personas";
import { aplicarSentencia, bloquearEmpresa, conContexto, type Consulta, type ContextoDeBase } from "../../nucleo/db";
import { basePlataforma, exigirPersonal, type ContextoDeTenant } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { formatoPesos } from "../../dominio/centavos";
import { actorDePersonal, auditar as auditarPorDefecto, type Actor, type Auditar } from "../bitacora/auditar";
import { leerUrlPublica } from "../correo";
import { plantillaAvisoDevolucionCobranza } from "../correo/plantillas/cobro";
import { centavos, registro, texto, textoONulo } from "../flujo/lectura";
import { recibirAbono, type AbonoRecibido, type FuenteDeAbonos } from "./abonos";
import { autorDe } from "./comun";
import { avisarAlEquipo, type DependenciasCobranza } from "./servicio";

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
  const destino = await conContexto({ rol: "plataforma_cliente" }, async (consulta) =>
    (await aplicarSentencia(consulta, "select company_id, operator_id, customer_id from cobranza_destino_fintoc($1, $2)", [transferencia.cuentaId, transferencia.cuentaNumeroId])).rows.map(registro)[0] ?? null,
  );
  if (!destino) return guardarSinDestino(aviso, transferencia);
  const empresaId = texto(destino.company_id);
  const operadorId = texto(destino.operator_id);
  const clienteDeLaCuenta = destino.customer_id ? texto(destino.customer_id) : null;
  const actor: Actor = { operadorId, companyId: empresaId, actorTipo: "sistema", actorId: null, superficie: "cliente", peticionId: null, origen: "fintoc" };
  if (aviso.devolucion) return atenderDevolucion(aviso, aviso.devolucion, empresaId, operadorId, actor, deps);
  const abono = aviso.abono!;
  const efecto = await conContexto({ rol: "plataforma_cliente", companyId: empresaId, operadorId }, async (consulta) => {
    // Dos entregas del mismo evento a la vez: la segunda espera y lo encuentra visto.
    await bloquearEmpresa(consulta, empresaId);
    const visto = await aplicarSentencia(
      consulta,
      "select 1 from collection_provider_events where proveedor = 'fintoc' and evento_id = $1",
      [aviso.eventoId],
    );
    if (visto.rows.length > 0) return "repetido" as const;
    const { idExterno, montoCentavos, recibidoEl, claveRastreo, referencia, clabeOrdenante, nombreOrdenante } = abono;
    const recibido = await recibirAbono(consulta, actor, deps.auditar, "fintoc", {
      idExterno, montoCentavos, recibidoEl, claveRastreo, referencia, clabeOrdenante, nombreOrdenante, clienteDeLaCuenta,
    });
    const id = randomUUID();
    await aplicarSentencia(
      consulta,
      "insert into collection_provider_events (id, company_id, proveedor, evento_id, payment_id) values ($1, $2, 'fintoc', $3, $4)",
      [id, empresaId, aviso.eventoId, recibido.pagoId],
    );
    await deps.auditar(consulta, actor, { accion: "aviso_proveedor_cobranza", identificador: id, cambio: { proveedor: "fintoc", repetido: recibido.repetido } });
    return recibido.repetido ? ("repetido" as const) : ("registrado" as const);
  });
  registrar("info", "aviso_atendido", { evento_id: aviso.eventoId, efecto });
  return { estado: 200, cuerpo: { ok: true, efecto } };
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
async function atenderDevolucion(
  aviso: AvisoFintoc,
  devolucion: DevolucionFintoc,
  empresaId: string,
  operadorId: string,
  actor: Actor,
  deps: DepsAviso,
): Promise<RespuestaAviso> {
  const resultado = await conContexto({ rol: "plataforma_cliente", companyId: empresaId, operadorId }, async (consulta) => {
    await bloquearEmpresa(consulta, empresaId);
    const visto = await aplicarSentencia(consulta, "select 1 from collection_provider_events where proveedor = 'fintoc' and evento_id = $1", [aviso.eventoId]);
    if (visto.rows.length > 0) return { efecto: "repetido" as const };
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
    if (pago.estado !== "devuelto") {
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
    return devuelto
      ? { efecto: "devuelto" as const, pagoId, cliente: textoONulo(pago.cliente), monto: centavos(pago.monto) }
      : { efecto: "repetido" as const };
  });
  if (resultado.efecto === "sin_pago") return guardarSinDestino(aviso, devolucion);
  if (resultado.efecto === "devuelto") {
    const empresa = await conContexto({ rol: "plataforma_cliente", companyId: empresaId, operadorId }, async (consulta) =>
      registro((await aplicarSentencia(consulta, "select razon_social, demostracion from companies where id = $1", [empresaId])).rows[0]));
    await avisarAlEquipo({ empresa: { id: empresaId, operadorId, demostracion: empresa.demostracion === true } }, deps, plantillaAvisoDevolucionCobranza({
      razonSocial: texto(empresa.razon_social),
      cliente: resultado.cliente,
      monto: formatoPesos(resultado.monto),
      enlace: `${(deps.urlPublica ?? (() => leerUrlPublica()))()}/c/${empresaId}/consola/cobros`,
    }), `cobranza-devolucion/${resultado.pagoId}`);
  }
  registrar("info", "aviso_atendido", { evento_id: aviso.eventoId, efecto: resultado.efecto });
  return { estado: 200, cuerpo: { ok: true, efecto: resultado.efecto } };
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
