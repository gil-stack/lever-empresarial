import { ErrorEfevoo } from "./errores";
import { centavosAPesos, pesosACentavos } from "./montos";
import { registrarEfevoo } from "./registros";
import type { ConfigEfevoo } from "./config";

/**
 * Cliente HTTP de Efevoo Pay (colección «API EfevooPay 2026-2» y lo medido en
 * el sandbox el 2026-11-12: docs/evidencia/efevoo/investigacion.md). Un solo
 * endpoint, `POST /v1/apiservice`, con `{method, payload}`. Cada método regresa
 * solo lo que Lever usa: ids, estados, montos en centavos y terminaciones.
 *
 * - Espera 15 s. Nunca reintenta: un timeout, un 5xx o una respuesta ilegible
 *   son `efevoo_incierto`, y quien llama decide (concilia antes de repetir).
 * - Éxito = HTTP 200 y `status.code` 0 (llega como número o como texto). En los
 *   métodos que devuelven un id, además un id positivo: el sandbox responde
 *   «Operación realizada correctamente» con id 0 cuando el correo no es el de
 *   la tarjeta, sin mover nada.
 * - El método de datos de la tarjeta (getCardData) no existe aquí a propósito:
 *   devuelve el número completo. Tampoco depositCard ni withdrawalCard, que
 *   mueven el saldo del emisor (cliente.test.ts lo comprueba en todo src).
 */

export const ESPERA_MS = 15_000;

/** La referencia de Efevoo: exactamente 7 dígitos (el sandbox rechaza otra forma). */
export const REFERENCIA = /^[0-9]{7}$/;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type EstadoTarjetaEfevoo = "inStock" | "active" | "blocked" | "cancelled";
const ESTADOS: readonly EstadoTarjetaEfevoo[] = ["inStock", "active", "blocked", "cancelled"];

export type DatosEmpresa = {
  correo: string;
  razonSocial: string;
  rfc?: string | null;
  telefono?: string | null;
  domicilio?: {
    calle?: string | null;
    numExt?: string | null;
    numInt?: string | null;
    colonia?: string | null;
    municipio?: string | null;
    codigoPostal?: string | null;
    ciudad?: string | null;
    estado?: string | null;
    pais?: string | null;
  };
  representantes?: { nombre: string; rfc?: string | null; curp?: string | null }[];
};

export type Titular = {
  nombre: string;
  primerApellido: string;
  segundoApellido: string;
  nombreEmbozar: string;
  telefono: string;
  correo: string;
  paisNacimiento: string;
  domicilio: string;
};

export type ClienteResumen = { idepCliente: number; nombre: string | null; saldoCentavos: number | null; totalTarjetas: number | null };
export type ClienteDetalle = { idepCliente: number; correo: string | null; estatus: number | null; saldoCentavos: number | null };
export type MovimientoCliente = {
  id: number;
  centavos: number;
  operacion: "deposit" | "withdraw";
  registradoEn: string;
  saldoPrevioCentavos: number | null;
  saldoNuevoCentavos: number | null;
};
export type TarjetaEfevoo = {
  id: number;
  terminacion: string;
  estado: EstadoTarjetaEfevoo;
  saldoCentavos: number | null;
  idepCliente: number;
  producto: number | null;
  subproducto: number | null;
  conTitular: boolean;
};
export type ListaDeTarjetas = { total: number; enInventario: number | null; paginaFinal: number; tarjetas: TarjetaEfevoo[] };
/**
 * Un movimiento de getTransactionsCard. El importe llega sin signo: el signo lo
 * da TipoMovimientoCargoAbono (Abono = carga, «PAGO A TARJETA»; Cargo = retiro,
 * «DEVOLUCIÓN PAGO A TARJETA»). FechaHora viene en hora de México. El
 * IDMovimiento es de otra serie que el id que responde fundCard/unfundCard.
 */
export type MovimientoTarjeta = {
  idMovimiento: string;
  referencia: string | null;
  centavos: number | null;
  tipo: "abono" | "cargo" | null;
  concepto: string;
  fechaHora: string;
  saldoDespuesCentavos: number | null;
};
export type OperacionDeTarjeta = { id: number; saldoFinalCentavos: number | null };

export interface ClienteEfevoo {
  crearCliente(datos: DatosEmpresa): Promise<{ idepCliente: number }>;
  leerCliente(idepCliente: number): Promise<ClienteDetalle>;
  listarClientes(ids?: number[]): Promise<ClienteResumen[]>;
  /** Depósito o retiro al saldo de la empresa (solo sandbox, lo decide quien llama). No lleva referencia. */
  moverSaldoCliente(idepCliente: number, centavos: number, operacion: "deposit" | "withdraw"): Promise<{ saldoPrevioCentavos: number | null; saldoNuevoCentavos: number | null }>;
  movimientosCliente(idepCliente: number, pagina: number, tamano: number): Promise<MovimientoCliente[]>;
  listarTarjetas(filtro: { estados: EstadoTarjetaEfevoo[] | "todas"; pagina: number; tamano: number }): Promise<ListaDeTarjetas>;
  /** El correo del titular de una tarjeta: solo en memoria, para los métodos que lo piden. */
  correoDeTarjeta(idTarjeta: number): Promise<string | null>;
  saldoDeTarjetas(ids: number[]): Promise<{ terminacion: string; saldoCentavos: number | null }[]>;
  movimientosDeTarjeta(idTarjeta: number, correo: string): Promise<MovimientoTarjeta[]>;
  asignarTarjeta(entrada: { producto: number; subproducto: number; idepCliente: number; ultimos8: string; titular: Titular }): Promise<{ id: number; terminacion: string }>;
  activarTarjeta(idTarjeta: number, correo: string): Promise<void>;
  asignarTarjetasACliente(idepCliente: number, ids: number[]): Promise<{ idTarjeta: number; asignada: boolean }[]>;
  cargarTarjeta(idTarjeta: number, correo: string, centavos: number, referencia: string, observaciones: string): Promise<OperacionDeTarjeta>;
  retirarTarjeta(idTarjeta: number, correo: string, centavos: number, referencia: string, observaciones: string): Promise<OperacionDeTarjeta>;
  bloquearTarjeta(idTarjeta: number, correo: string, accion: "block" | "unblock"): Promise<void>;
  cancelarTarjeta(idTarjeta: number, correo: string): Promise<void>;
}

// Lectura ---------------------------------------------------------------------

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function entero(v: unknown): number | null {
  const n = typeof v === "string" && /^-?[0-9]{1,15}$/.test(v.trim()) ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) ? n : null;
}
function idPositivo(v: unknown): number | null {
  const n = entero(v);
  return n !== null && n > 0 ? n : null;
}
function texto(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
/** Los últimos 4 dígitos de un bin enmascarado ("44958300****9476") o de una terminación ("9927"). */
export function terminacionDe(v: unknown): string | null {
  const t = texto(v)?.trim() ?? "";
  const m = /([0-9]{4})$/.exec(t);
  return m ? m[1]! : null;
}
function ilegible(metodo: string): ErrorEfevoo {
  registrarEfevoo("error", "efevoo_forma_inesperada", { metodo });
  return new ErrorEfevoo("efevoo_incierto", "forma");
}

/** `status.code` normalizado a texto: 0, "0" y " 0 " son lo mismo. */
export function codigoDeEstado(cuerpo: unknown): string | null {
  const status = objeto(objeto(cuerpo)?.status);
  const codigo = status?.code;
  if (typeof codigo === "number" && Number.isInteger(codigo)) return String(codigo);
  if (typeof codigo === "string" && /^\s*-?[0-9]{1,6}\s*$/.test(codigo)) return String(Number(codigo.trim()));
  return null;
}

// Cliente HTTP ------------------------------------------------------------------

export function clienteHttpEfevoo(config: ConfigEfevoo, hacerFetch: Fetch = fetch, esperaMs = ESPERA_MS): ClienteEfevoo {
  /**
   * Una llamada. El monto, si lo hay, viaja como el número JSON exacto que
   * sale de los centavos ("12.34"), sin pasar por un flotante.
   */
  async function pedir(metodo: string, payload: Record<string, unknown>, montoCentavos?: number): Promise<unknown> {
    // El monto se agrega al final del payload como el número JSON exacto ("12.34"), sin
    // pasar por un flotante y sin marcador de texto que otro campo pudiera repetir.
    let cuerpo = JSON.stringify({ method: metodo, payload });
    if (montoCentavos !== undefined) {
      if (!cuerpo.endsWith("}}")) throw new Error("cuerpo_invalido");
      cuerpo = `${cuerpo.slice(0, -2)}${cuerpo.endsWith("{}}") ? "" : ","}"amount":${centavosAPesos(montoCentavos)}}}`;
    }
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), esperaMs);
    const inicio = Date.now();
    let respuesta: Response;
    let crudo: string;
    try {
      respuesta = await hacerFetch(config.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-API-USER": config.usuario, "X-API-KEY": config.llave },
        body: cuerpo,
        signal: corte.signal,
        redirect: "error",
        cache: "no-store",
      });
      crudo = await respuesta.text();
    } catch {
      registrarEfevoo("error", corte.signal.aborted ? "efevoo_timeout" : "efevoo_sin_respuesta", { metodo, ms: Date.now() - inicio });
      throw new ErrorEfevoo("efevoo_incierto", corte.signal.aborted ? "timeout" : "sin_respuesta");
    } finally {
      clearTimeout(reloj);
    }
    const ms = Date.now() - inicio;
    if (respuesta.status === 401) {
      registrarEfevoo("error", "efevoo_no_autorizado", { metodo, http: 401, ms });
      throw new ErrorEfevoo("efevoo_no_autorizado", "401");
    }
    if (respuesta.status >= 500) {
      registrarEfevoo("error", "efevoo_respondio_5xx", { metodo, http: respuesta.status, ms });
      throw new ErrorEfevoo("efevoo_incierto", `http_${respuesta.status}`);
    }
    if (respuesta.status !== 200) {
      registrarEfevoo("error", "efevoo_rechazo", { metodo, http: respuesta.status, ms });
      throw new ErrorEfevoo("efevoo_rechazo", `http_${respuesta.status}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(crudo);
    } catch {
      registrarEfevoo("error", "efevoo_ilegible", { metodo, http: 200, ms });
      throw new ErrorEfevoo("efevoo_incierto", "ilegible");
    }
    const raiz = objeto(json);
    if (!raiz) {
      registrarEfevoo("error", "efevoo_ilegible", { metodo, http: 200, ms });
      throw new ErrorEfevoo("efevoo_incierto", "ilegible");
    }
    if (!objeto(raiz.status)) {
      // Una validación de campos llega sin status: {"Reference": "Debe contener exactamente 7 dígitos numéricos."}.
      registrarEfevoo("error", "efevoo_rechazo", { metodo, http: 200, codigo: "validacion", ms });
      throw new ErrorEfevoo("efevoo_rechazo", "validacion");
    }
    const codigo = codigoDeEstado(raiz);
    if (codigo !== "0") {
      registrarEfevoo("error", "efevoo_rechazo", { metodo, http: 200, codigo: codigo ?? "sin_codigo", ms });
      throw new ErrorEfevoo("efevoo_rechazo", codigo ?? "sin_codigo");
    }
    registrarEfevoo("info", "efevoo_ok", { metodo, ms });
    return raiz.response;
  }

  async function listarTarjetas(filtro: { estados: EstadoTarjetaEfevoo[] | "todas"; pagina: number; tamano: number }): Promise<ListaDeTarjetas> {
    const r = objeto(await pedir("getCardsList", {
      status: filtro.estados === "todas" ? [] : filtro.estados,
      size: filtro.tamano,
      page: filtro.pagina,
      currency: "MXN",
      card_bin: "",
    }));
    const lista = r?.cards;
    const total = entero(r?.total_cards);
    if (!r || !Array.isArray(lista) || total === null) throw ilegible("getCardsList");
    const tarjetas = lista.map((c) => {
      const t = objeto(c);
      const id = idPositivo(t?.id);
      const terminacion = terminacionDe(t?.bin);
      const estado = ESTADOS.find((e) => e === t?.status);
      if (!t || id === null || !terminacion || !estado) throw ilegible("getCardsList");
      return {
        id,
        terminacion,
        estado,
        saldoCentavos: pesosACentavos(t.balance),
        idepCliente: entero(t.subclient) ?? 0,
        producto: entero(t.product),
        subproducto: entero(t.subproduct),
        conTitular: typeof t.email === "string" && t.email.trim() !== "",
      };
    });
    return { total, enInventario: entero(r.cards_in_stock), paginaFinal: entero(r.final_page) ?? 1, tarjetas };
  }

  async function operarTarjeta(metodo: "fundCard" | "unfundCard", idTarjeta: number, correo: string, centavos: number, referencia: string, observaciones: string) {
    if (!REFERENCIA.test(referencia)) throw new Error("referencia_invalida");
    const r = objeto(await pedir(metodo, { idCard: idTarjeta, emailCard: correo, observations: observaciones.slice(0, 100), reference: referencia }, centavos));
    const id = entero(r?.id);
    if (!r || id === null) throw ilegible(metodo);
    if (id <= 0) {
      // «Operación realizada correctamente» con id 0: no movió nada (medido en el sandbox).
      registrarEfevoo("error", "efevoo_rechazo", { metodo, codigo: "id_cero" });
      throw new ErrorEfevoo("efevoo_rechazo", "id_cero");
    }
    if (idPositivo(r.idCard) !== null && idPositivo(r.idCard) !== idTarjeta) throw ilegible(metodo);
    return { id, saldoFinalCentavos: pesosACentavos(r.finalCardBalance) };
  }

  return {
    async crearCliente(d) {
      const domicilio = d.domicilio ?? {};
      const r = objeto(await pedir("createClient", {
        email: d.correo,
        comercio: {
          razonSocial: d.razonSocial,
          rfc: d.rfc ?? null,
          fechaConst: null,
          giroSocial: null,
          paisConst: null,
          telefono: d.telefono ?? null,
          email: d.correo,
        },
        domicilio: {
          calle: domicilio.calle ?? null,
          numInt: domicilio.numInt ?? null,
          numExt: domicilio.numExt ?? null,
          colonia: domicilio.colonia ?? null,
          municipio: domicilio.municipio ?? null,
          codigoPostal: domicilio.codigoPostal ?? null,
          ciudad: domicilio.ciudad ?? null,
          estado: domicilio.estado ?? null,
          pais: domicilio.pais ?? null,
        },
        contactos: [],
        representantes: (d.representantes ?? []).slice(0, 4).map((p) => ({
          nombre: p.nombre,
          fechaNacimiento: null,
          rfc: p.rfc ?? null,
          curp: p.curp ?? null,
          pais: null,
          acreditacion: null,
          numeroAcreditacion: null,
        })),
      }));
      const id = idPositivo(r?.id);
      if (id === null) throw ilegible("createClient");
      return { idepCliente: id };
    },

    async leerCliente(idepCliente) {
      const r = objeto(await pedir("getClient", { idepCliente }));
      const id = idPositivo(r?.idepCliente);
      if (!r || id === null || id !== idepCliente) throw ilegible("getClient");
      return { idepCliente: id, correo: texto(r.email)?.trim().toLowerCase() ?? null, estatus: entero(r.estatus), saldoCentavos: pesosACentavos(r.balance) };
    },

    async listarClientes(ids = []) {
      const r = objeto(await pedir("getClientList", { idepClientes: ids }));
      if (!r || !Array.isArray(r.clients)) throw ilegible("getClientList");
      return r.clients.map((c) => {
        const o = objeto(c);
        const id = idPositivo(o?.idepCliente);
        if (!o || id === null) throw ilegible("getClientList");
        return { idepCliente: id, nombre: texto(o.name), saldoCentavos: pesosACentavos(o.balance), totalTarjetas: entero(o.totalCards) };
      });
    },

    async moverSaldoCliente(idepCliente, centavos, operacion) {
      const r = objeto(await pedir("clientBalance", { idepCliente, operation: operacion }, centavos));
      if (!r) throw ilegible("clientBalance");
      return { saldoPrevioCentavos: pesosACentavos(r.previousBalance), saldoNuevoCentavos: pesosACentavos(r.updatedBalance) };
    },

    async movimientosCliente(idepCliente, pagina, tamano) {
      const r = objeto(await pedir("balanceMovements", { idepCliente, page: pagina, pageSize: tamano }));
      if (!r || !Array.isArray(r.movements)) throw ilegible("balanceMovements");
      return r.movements.map((m) => {
        const o = objeto(m);
        const id = idPositivo(o?.id);
        const centavos = pesosACentavos(o?.amount);
        const operacion = o?.operation === "deposit" || o?.operation === "withdraw" ? o.operation : null;
        if (!o || id === null || centavos === null || !operacion) throw ilegible("balanceMovements");
        return {
          id,
          centavos,
          operacion,
          registradoEn: texto(o.registerDate) ?? "",
          saldoPrevioCentavos: pesosACentavos(o.previousBalance),
          saldoNuevoCentavos: pesosACentavos(o.updatedBalance),
        };
      });
    },

    listarTarjetas,

    async correoDeTarjeta(idTarjeta) {
      // getCardsList no filtra por id: se recorre por páginas (tope de 40 × 50 = 2000 tarjetas).
      for (let pagina = 1; pagina <= 40; pagina++) {
        const r = objeto(await pedir("getCardsList", { status: [], size: 50, page: pagina, currency: "MXN", card_bin: "" }));
        if (!r || !Array.isArray(r.cards)) throw ilegible("getCardsList");
        for (const c of r.cards) {
          const t = objeto(c);
          if (idPositivo(t?.id) === idTarjeta) {
            const correo = texto(t?.email)?.trim() ?? "";
            return correo === "" ? null : correo;
          }
        }
        if (pagina >= (entero(r.final_page) ?? 1)) break;
      }
      return null;
    },

    async saldoDeTarjetas(ids) {
      const r = objeto(await pedir("getCardsBalance", { cards: ids }));
      if (!r || !Array.isArray(r.cards)) throw ilegible("getCardsBalance");
      return r.cards.map((c) => {
        const o = objeto(c);
        const terminacion = terminacionDe(o?.bin);
        if (!o || !terminacion) throw ilegible("getCardsBalance");
        return { terminacion, saldoCentavos: pesosACentavos(o.balance) };
      });
    },

    async movimientosDeTarjeta(idTarjeta, correo) {
      const r = objeto(await pedir("getTransactionsCard", { email: correo, card: idTarjeta, descending: true, card_bin: "" }));
      if (!r || !Array.isArray(r.transactions)) throw ilegible("getTransactionsCard");
      return r.transactions.map((m) => {
        const o = objeto(m);
        const idMovimiento = texto(o?.IDMovimiento) ?? (entero(o?.IDMovimiento) !== null ? String(o?.IDMovimiento) : null);
        if (!o || !idMovimiento) throw ilegible("getTransactionsCard");
        const referencia = texto(o.Referencia)?.trim() ?? null;
        const tipo = texto(o.TipoMovimientoCargoAbono)?.trim().toLowerCase();
        return {
          idMovimiento,
          referencia: referencia && REFERENCIA.test(referencia) ? referencia : null,
          centavos: pesosACentavos(o.ImporteMovimiento ?? o.Importe),
          tipo: tipo === "abono" || tipo === "cargo" ? tipo : null,
          concepto: (texto(o.ConceptoMovimiento) ?? "").slice(0, 80),
          fechaHora: texto(o.FechaHora) ?? "",
          saldoDespuesCentavos: pesosACentavos(o.SaldoDespuesMovimiento),
        };
      });
    },

    async asignarTarjeta(e) {
      if (!/^[0-9]{8}$/.test(e.ultimos8)) throw new Error("tarjeta_invalida");
      const t = e.titular;
      const r = objeto(await pedir("assignCard", {
        product: e.producto,
        subproduct: e.subproducto,
        subclient: e.idepCliente,
        type: "F",
        card: e.ultimos8,
        client_data: {
          nombre: t.nombre,
          primerApellido: t.primerApellido,
          segundoApellido: t.segundoApellido,
          nombreEmbozar: t.nombreEmbozar,
          telefono: t.telefono,
          correo: t.correo,
          paisNacimiento: t.paisNacimiento,
          address: t.domicilio,
        },
      }));
      const id = idPositivo(r?.id);
      const terminacion = terminacionDe(r?.card);
      if (id === null || !terminacion) throw ilegible("assignCard");
      return { id, terminacion };
    },

    async activarTarjeta(idTarjeta, correo) {
      await pedir("activateCard", { email: correo, id: idTarjeta });
    },

    async asignarTarjetasACliente(idepCliente, ids) {
      const r = objeto(await pedir("assignCards", { idepCliente, cards: ids }));
      if (!r || !Array.isArray(r.results)) throw ilegible("assignCards");
      return r.results.map((x) => {
        const o = objeto(x);
        const idTarjeta = idPositivo(o?.idCard);
        if (!o || idTarjeta === null) throw ilegible("assignCards");
        return { idTarjeta, asignada: o.success === true };
      });
    },

    cargarTarjeta: (id, correo, centavos, referencia, observaciones) => operarTarjeta("fundCard", id, correo, centavos, referencia, observaciones),
    retirarTarjeta: (id, correo, centavos, referencia, observaciones) => operarTarjeta("unfundCard", id, correo, centavos, referencia, observaciones),

    async bloquearTarjeta(idTarjeta, correo, accion) {
      await pedir("cardBlocker", { email: correo, card: idTarjeta, action: accion });
    },

    async cancelarTarjeta(idTarjeta, correo) {
      await pedir("cancelCard", { email: correo, card: idTarjeta });
    },
  };
}
