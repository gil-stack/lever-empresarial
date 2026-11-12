import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Socket } from "node:net";

/**
 * Efevoo falso para las pruebas y la e2e: nunca se llama al sandbox desde el CI.
 * Escucha en 127.0.0.1, guarda en memoria y responde con la forma real que dio
 * el sandbox el 2026-11-12 (tests/efevoo/contrato/ y
 * docs/evidencia/efevoo/investigacion.md), incluidas sus rarezas:
 * `status.code` a veces número y a veces texto, la validación de la referencia
 * sin `status`, el falso éxito con id 0 cuando el correo no es el de la tarjeta,
 * y el 401 de un método que no existe (getCardData incluido).
 *
 * A diferencia del sandbox, aquí clientBalance, assignCard y activateCard sí
 * funcionan como dice la documentación: son los pasos bloqueados del lado de Efevoo.
 *
 * Control (sin credenciales, solo en 127.0.0.1):
 *   POST /simular   {"metodo": "fundCard", "falla": "901"|"401"|"5xx"|"ilegible"|"timeout"|"timeout_sin_efecto", "idCard"?: 557, "idepCliente"?: 300}
 *                   La siguiente llamada a ese método (y a esa tarjeta o cliente, si se dice) falla una sola vez.
 *                   `ilegible` y `timeout` aplican el efecto antes de fallar: Efevoo sí lo hizo y Lever no lo sabe.
 *   POST /simular   {"metodo": "movimiento", "idCard": 557, "concepto": "…", "importe": 12.34, "tipo": "Abono"|"Cargo", "referencia"?: "1234567", "fecha"?: ISO}
 *                   Solo para pruebas: agrega a la tarjeta un movimiento con ese concepto, sin tocar su saldo.
 *   GET  /estado    Clientes, tarjetas y movimientos, para revisar qué hizo la aplicación.
 *   POST /reiniciar Vuelve al inventario inicial.
 */

export type Falla = "901" | "401" | "5xx" | "ilegible" | "timeout" | "timeout_sin_efecto";
type FallaPendiente = { metodo: string; falla: Falla; idCard?: number; idepCliente?: number };

type ClienteFalso = { id: number; email: string; razonSocial: string; saldoCentavos: number; movimientos: MovimientoCliente[] };
type MovimientoCliente = { id: number; centavos: number; operacion: "deposit" | "withdraw"; fecha: Date; previo: number; nuevo: number };
type TarjetaFalsa = {
  id: number;
  bin: string;
  ultimos8: string;
  estado: "inStock" | "active" | "blocked" | "cancelled";
  saldoCentavos: number;
  subcliente: number;
  email: string;
  nombre: string;
  activada: boolean;
  producto: number;
  subproducto: number;
  transacciones: MovimientoFalso[];
};

/**
 * Como los da getTransactionsCard en el sandbox (lectura de -03 de la tarjeta 560,
 * revision-efevoo-e1.md): importe sin signo como texto «x.0000»; el signo lo da
 * TipoMovimientoCargoAbono; una carga es «PAGO A TARJETA» (Abono, M09282600MXN484)
 * y un retiro «DEVOLUCIÓN PAGO A TARJETA» (Cargo, M09DT2600MXN484); el
 * IDMovimiento es de otra serie que el id que responde fundCard o unfundCard.
 */
export type MovimientoFalso = {
  idMovimiento: number;
  referencia: string | null;
  centavos: number;
  tipo: "Abono" | "Cargo";
  concepto: string;
  clave: string;
  fecha: Date;
  observaciones: string;
  saldoDespuesCentavos: number | null;
};
export type MovimientoInyectado = { idCard: number; concepto: string; importe: number; tipo: "Abono" | "Cargo"; referencia?: string; fecha?: string };

export type EfevooFalso = {
  /** Valor de EFEVOO_URL. */
  url: string;
  usuario: string;
  llave: string;
  simular(f: FallaPendiente): void;
  /** Solo pruebas: un movimiento con concepto a medida, sin tocar el saldo. */
  inyectarMovimiento(m: MovimientoInyectado): void;
  estado(): { clientes: ClienteFalso[]; tarjetas: TarjetaFalsa[] };
  reiniciar(): void;
  cerrar(): Promise<void>;
};

/** El inventario inicial: los cinco plásticos en inStock del sandbox, con sus terminaciones reales. */
export const INVENTARIO = [
  { id: 557, terminacion: "1363", saldoCentavos: 0 },
  { id: 563, terminacion: "0168", saldoCentavos: 0 },
  { id: 564, terminacion: "3474", saldoCentavos: 0 },
  { id: 567, terminacion: "7992", saldoCentavos: 6_035_234 },
  { id: 568, terminacion: "8182", saldoCentavos: 0 },
] as const;
/** Los últimos 8 del plástico, que en la vida real se leen del plástico físico: aquí, «4000» + la terminación. */
export const ultimos8De = (terminacion: string) => `4000${terminacion}`;

const OK_NUMERO = { code: 0, message: "Message OK." };
const OK_TEXTO = { code: "0", message: "Message OK." };
const ERROR_1 = (response: unknown = "Ha ocurrido un error") => ({ response, status: { code: 1, message: "Error" } });
const ERROR_TEXTO = (code: string, message: string) => ({ status: { code, message, mensaje: message }, response: {} });

function fechaRegistro(d: Date): string {
  // Como la da balanceMovements en el sandbox: "4/1/2026 5:22:52 PM".
  const h = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${h}:${dos(d.getMinutes())}:${dos(d.getSeconds())} ${d.getHours() < 12 ? "AM" : "PM"}`;
}
/** FechaHora de getTransactionsCard: hora de México (UTC−6, sin horario de verano desde 2022). */
function fechaHora(d: Date): string {
  const m = new Date(d.getTime() - 6 * 3_600_000);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${m.getUTCFullYear()}-${dos(m.getUTCMonth() + 1)}-${dos(m.getUTCDate())} ${dos(m.getUTCHours())}:${dos(m.getUTCMinutes())}:${dos(m.getUTCSeconds())}`;
}
const importeTexto = (centavos: number) => `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}00`;
const pesos = (centavos: number) => Number((centavos / 100).toFixed(2));
/** Pesos que llegan en el JSON → centavos, con texto para no arrastrar flotantes. */
function centavos(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(v));
  if (!m) return null;
  const c = Number(m[2]) * 100 + Number(((m[3] ?? "") + "00").slice(0, 2));
  return m[1] ? -c : c;
}

export async function iniciarEfevooFalso(puerto = 0, credenciales = { usuario: "efevoo-falso", llave: "llave-del-efevoo-falso" }): Promise<EfevooFalso> {
  let clientes = new Map<number, ClienteFalso>();
  let tarjetas = new Map<number, TarjetaFalsa>();
  let fallas: FallaPendiente[] = [];
  let siguienteCliente = 300;
  let siguienteMovimiento = 120_600;
  // Series distintas, como en el sandbox: el id que responde fundCard (3060…), el de unfundCard (2664…) y el IDMovimiento (4526…).
  let siguienteCarga = 3000;
  let siguienteRetiro = 2600;
  let siguienteIdMovimiento = 4500;
  const colgados = new Set<ServerResponse>();
  const sockets = new Set<Socket>();

  function reiniciar() {
    clientes = new Map();
    tarjetas = new Map(INVENTARIO.map((t) => [t.id, {
      id: t.id, bin: `44958300****${t.terminacion}`, ultimos8: ultimos8De(t.terminacion), estado: "inStock", saldoCentavos: t.saldoCentavos,
      subcliente: 0, email: "", nombre: "", activada: false, producto: 16, subproducto: 19, transacciones: [],
    } satisfies TarjetaFalsa]));
    fallas = [];
    siguienteCliente = 300;
    siguienteMovimiento = 120_600;
    siguienteCarga = 3000;
    siguienteRetiro = 2600;
    siguienteIdMovimiento = 4500;
  }

  function inyectarMovimiento(m: MovimientoInyectado) {
    const t = tarjetas.get(Number(m.idCard));
    const c = centavos(m.importe);
    if (!t || c === null || c <= 0 || (m.tipo !== "Abono" && m.tipo !== "Cargo") || typeof m.concepto !== "string") throw new Error("movimiento no válido");
    t.transacciones.push({
      idMovimiento: siguienteIdMovimiento++, referencia: m.referencia ?? null, centavos: c, tipo: m.tipo, concepto: m.concepto.slice(0, 200),
      clave: m.tipo === "Abono" ? "M09282600MXN484" : "M09DT2600MXN484", fecha: m.fecha ? new Date(m.fecha) : new Date(),
      observaciones: "", saldoDespuesCentavos: null,
    });
  }
  reiniciar();

  function tomarFalla(metodo: string, payload: Record<string, unknown>): Falla | null {
    const i = fallas.findIndex((f) =>
      f.metodo === metodo
      && (f.idCard === undefined || f.idCard === Number(payload.idCard ?? payload.card ?? payload.id))
      && (f.idepCliente === undefined || f.idepCliente === Number(payload.idepCliente)));
    if (i < 0) return null;
    return fallas.splice(i, 1)[0]!.falla;
  }

  function tarjetaJson(t: TarjetaFalsa) {
    return {
      name: t.nombre, lastName1: "", lastName2: "", phone: t.email ? "5500000000" : " ", id: t.id, email: t.email, company: 1,
      company_name: "Efevoo Pay", bin: t.bin, coin: "MXN", balance: pesos(t.saldoCentavos), balance2: pesos(t.saldoCentavos),
      status: t.estado, cardType: "F", assigned_date: "2026-01-08 19:14:16", alias: "", subclient: t.subcliente,
      subclient_name: t.subcliente ? clientes.get(t.subcliente)?.razonSocial ?? "" : "N/A", subcompany: 0, product: t.producto,
      subproduct: t.subproducto, subproduct_name: "EPCVC", ext: 0, client_address: "", credit: false,
    };
  }

  /** Lo que haría Efevoo con el método. Devuelve [estado HTTP, cuerpo]. */
  function atender(metodo: string, p: Record<string, unknown>): [number, unknown] {
    switch (metodo) {
      case "getClientList": {
        const ids = Array.isArray(p.idepClientes) ? p.idepClientes.map(Number) : [];
        const lista = [...clientes.values()].filter((c) => ids.length === 0 || ids.includes(c.id));
        return [200, { response: { clients: lista.map((c) => ({
          idepCliente: c.id, name: c.razonSocial, balance: pesos(c.saldoCentavos),
          totalCardBalance: pesos([...tarjetas.values()].filter((t) => t.subcliente === c.id).reduce((s, t) => s + t.saldoCentavos, 0)),
          totalCards: [...tarjetas.values()].filter((t) => t.subcliente === c.id).length,
        })) }, status: OK_NUMERO }];
      }
      case "getClient": {
        const c = clientes.get(Number(p.idepCliente));
        if (!c) return [200, ERROR_1()];
        return [200, { response: { company: 1, email: c.email, estatus: 1, idepCliente: c.id, balance: pesos(c.saldoCentavos),
          comercio: { razonSocial: c.razonSocial, email: c.email }, domicilio: {}, contactos: [], representantes: [] }, status: OK_NUMERO }];
      }
      case "createClient": {
        const email = typeof p.email === "string" ? p.email.trim().toLowerCase() : "";
        const comercio = (p.comercio ?? {}) as Record<string, unknown>;
        const razonSocial = typeof comercio.razonSocial === "string" ? comercio.razonSocial : "";
        if (!email || !razonSocial || comercio.email !== p.email) return [200, ERROR_1()];
        if ([...clientes.values()].some((c) => c.email === email)) return [200, ERROR_1("Cliente previamente registrado")];
        const id = siguienteCliente++;
        clientes.set(id, { id, email, razonSocial, saldoCentavos: 0, movimientos: [] });
        return [200, { response: { id, mensaje: "Cliente creado" }, status: OK_NUMERO }];
      }
      case "clientBalance": {
        const c = clientes.get(Number(p.idepCliente));
        const monto = centavos(p.amount);
        if (!c || monto === null || monto <= 0 || (p.operation !== "deposit" && p.operation !== "withdraw")) return [200, ERROR_1()];
        const previo = c.saldoCentavos;
        c.saldoCentavos += p.operation === "deposit" ? monto : -monto;
        c.movimientos.unshift({ id: siguienteMovimiento++, centavos: monto, operacion: p.operation, fecha: new Date(), previo, nuevo: c.saldoCentavos });
        return [200, { response: { updatedBalance: pesos(c.saldoCentavos), previousBalance: pesos(previo), message: "Balance actualizado", idepCliente: c.id }, status: OK_NUMERO }];
      }
      case "balanceMovements": {
        const c = clientes.get(Number(p.idepCliente));
        const pagina = Math.max(1, Number(p.page) || 1);
        const tamano = Math.max(1, Number(p.pageSize) || 50);
        const lista = c ? c.movimientos.slice((pagina - 1) * tamano, pagina * tamano) : [];
        return [200, { response: { movements: lista.map((m) => ({
          id: m.id, amount: pesos(m.centavos), operation: m.operacion, idepCliente: c!.id, clientName: c!.razonSocial,
          registerDate: fechaRegistro(m.fecha), previousBalance: pesos(m.previo), updatedBalance: pesos(m.nuevo),
        })), page: pagina, pageSize: tamano }, status: OK_NUMERO }];
      }
      case "getCardsList": {
        const estados = Array.isArray(p.status) ? p.status : [];
        const lista = [...tarjetas.values()].filter((t) => estados.length === 0 || estados.includes(t.estado));
        const tamano = Math.max(1, Number(p.size) || 10);
        const pagina = Math.max(1, Number(p.page) || 1);
        return [200, { status: OK_TEXTO, response: {
          total_cards: lista.length, cards_with_balance: lista.filter((t) => t.saldoCentavos !== 0).length,
          total_credit: 0, total_balance: pesos(lista.reduce((s, t) => s + t.saldoCentavos, 0)),
          cards_in_stock: [...tarjetas.values()].filter((t) => t.estado === "inStock").length,
          current_page: pagina, final_page: Math.max(1, Math.ceil(lista.length / tamano)),
          cards: lista.slice((pagina - 1) * tamano, pagina * tamano).map(tarjetaJson),
        } }];
      }
      case "getCardsBalance": {
        const ids = Array.isArray(p.cards) ? p.cards.map(Number) : [];
        const lista = ids.map((id) => tarjetas.get(id));
        const faltante = ids.find((id) => !tarjetas.has(id));
        if (faltante !== undefined) return [200, { status: { code: "122", message: "ERROR: Tarjeta no encontrada.", mensaje: "ERROR: Tarjeta no encontrada." }, response: { card: faltante } }];
        return [200, { status: OK_TEXTO, response: { total_balance: pesos(lista.reduce((s, t) => s + t!.saldoCentavos, 0)), cards: lista.map((t) => ({ bin: t!.bin, balance: pesos(t!.saldoCentavos) })) } }];
      }
      case "getTransactionsCard": {
        const t = tarjetas.get(Number(p.card));
        if (!t || !t.email || t.email !== p.email) return [200, ERROR_TEXTO("115", "ERROR: Cuenta no encontrada.")];
        const lista = [...t.transacciones].sort((a, b) => (p.descending === false ? a.idMovimiento - b.idMovimiento : b.idMovimiento - a.idMovimiento));
        return [200, { status: OK_TEXTO, response: { transactions: lista.map((x) => ({
          MCC: "", Correo: t.email, IDSpei: null, Moneda: "MXN", Nombre: t.nombre, Importe: importeTexto(x.centavos), Tarjeta: t.bin, company: 1,
          Comercio: null, FechaHora: fechaHora(x.fecha), EnTransito: null, Referencia: x.referencia ?? "", IDOperacion: "0", IdOperacion: "",
          MedioAcceso: t.bin, Autorizacion: "", IDMovimiento: String(x.idMovimiento), IdMovimiento: String(x.idMovimiento), Organizacion: "EPCVC",
          Observaciones: x.observaciones, ClaveMovimiento: x.clave, FechaMovimiento: fechaHora(x.fecha), TipoTransaccion: null, MonedaMovimiento: "MXN",
          ImporteMovimiento: importeTexto(x.centavos), ConceptoMovimiento: x.concepto, ReferenciaNumerica: x.referencia ?? "",
          DescripcionMovimiento: x.concepto, SaldoDespuesMovimiento: x.saldoDespuesCentavos === null ? "" : (x.saldoDespuesCentavos / 100).toFixed(2),
          ImporteOrigenMovimiento: importeTexto(x.centavos), TipoMovimientoCargoAbono: x.tipo,
        })) } }];
      }
      case "assignCard": {
        const d = (p.client_data ?? {}) as Record<string, unknown>;
        const campos = ["nombre", "primerApellido", "segundoApellido", "nombreEmbozar", "telefono", "correo", "paisNacimiento", "address"];
        if (p.type !== "F" || typeof p.card !== "string" || campos.some((c) => typeof d[c] !== "string")) return [200, ERROR_TEXTO("101", "ERROR: Hash incorrecto.")];
        const t = [...tarjetas.values()].find((x) => x.ultimos8 === p.card);
        if (!t) return [200, ERROR_TEXTO("101", "ERROR: Hash incorrecto.")];
        if (t.email) return [200, ERROR_TEXTO("163", "ERROR: La tarjeta ya ha sido asignada.")];
        const sub = Number(p.subclient ?? 0);
        if (sub && !clientes.has(sub)) return [200, ERROR_TEXTO("112", "ERROR: Empresa/Emisor no encontrado.")];
        t.email = String(d.correo).toLowerCase();
        t.nombre = String(d.nombre);
        t.subcliente = sub;
        t.producto = Number(p.product);
        t.subproducto = Number(p.subproduct);
        return [200, { status: OK_TEXTO, response: { CuentaInterna: "0000000000", card: t.bin.slice(-4), expDate: "**/**", id: t.id, client_id: 16947 } }];
      }
      case "activateCard": {
        const t = tarjetas.get(Number(p.id));
        if (!t || !t.email || t.email !== p.email) return [200, ERROR_TEXTO("112", "ERROR: Empresa/Emisor no encontrado.")];
        t.activada = true;
        t.estado = "active";
        return [200, { status: OK_TEXTO, response: {} }];
      }
      case "assignCards": {
        const c = clientes.get(Number(p.idepCliente));
        if (p.idepCliente === undefined) return [200, { IdepCliente: "Campo obligatorio" }];
        const ids = Array.isArray(p.cards) ? p.cards.map(Number) : [];
        if (!c || ids.some((id) => !tarjetas.get(id)?.email)) return [200, ERROR_1()];
        return [200, { response: { results: ids.map((id) => {
          const t = tarjetas.get(id)!;
          const libre = t.saldoCentavos === 0 && t.transacciones.length === 0;
          if (libre) t.subcliente = c.id;
          return { email: t.email, idCard: id, message: libre ? "Asignada" : "No asignada", success: libre };
        }) }, status: OK_NUMERO }];
      }
      case "fundCard":
      case "unfundCard": {
        if (typeof p.reference !== "string" || !/^[0-9]{7}$/.test(p.reference)) return [200, { Reference: "Debe contener exactamente 7 dígitos numéricos." }];
        const t = tarjetas.get(Number(p.idCard));
        const monto = centavos(p.amount);
        if (!t || monto === null || monto <= 0) return [200, ERROR_1()];
        // Medido: un correo que no es el de la tarjeta da «éxito» con id 0 y no mueve nada.
        if (!t.email || t.email !== p.emailCard) return [200, { response: { id: 0, idCard: t.id, finalCardBalance: 0, message: "Operación realizada correctamente" }, status: OK_NUMERO }];
        // Medido: el sandbox no valida saldos. El falso tampoco: los valida Lever.
        const signo = metodo === "fundCard" ? 1 : -1;
        t.saldoCentavos += signo * monto;
        const c = clientes.get(t.subcliente);
        if (c) c.saldoCentavos -= signo * monto;
        const carga = metodo === "fundCard";
        t.transacciones.push({
          idMovimiento: siguienteIdMovimiento++, referencia: p.reference, centavos: monto, tipo: carga ? "Abono" : "Cargo",
          concepto: carga ? "PAGO A TARJETA" : "DEVOLUCIÓN PAGO A TARJETA", clave: carga ? "M09282600MXN484" : "M09DT2600MXN484",
          fecha: new Date(), observaciones: String(p.observations ?? ""), saldoDespuesCentavos: t.saldoCentavos,
        });
        const id = carga ? siguienteCarga++ : siguienteRetiro++;
        return [200, { response: { id, idCard: t.id, finalCardBalance: pesos(t.saldoCentavos), message: "Operación realizada correctamente" }, status: OK_NUMERO }];
      }
      case "cardBlocker": {
        const t = tarjetas.get(Number(p.card));
        if (!t || !t.email || t.email !== p.email) return [200, ERROR_TEXTO("115", "ERROR: Cuenta no encontrada.")];
        if (p.action === "block" && t.estado === "active") t.estado = "blocked";
        else if (p.action === "unblock" && t.estado === "blocked") t.estado = "active";
        else return [200, ERROR_TEXTO("100", "ERROR: Error desconocido.")];
        return [200, { status: OK_TEXTO, response: { errors: [] } }];
      }
      case "cancelCard": {
        const t = tarjetas.get(Number(p.card));
        if (!t || !t.email || t.email !== p.email) return [200, ERROR_TEXTO("115", "ERROR: Cuenta no encontrada.")];
        t.estado = "cancelled";
        return [200, { status: OK_TEXTO, response: { ID: t.id } }];
      }
      case "getCompanyBalance":
        return [200, { status: { code: "901", message: "ERROR: PARABILIUM API CONSULTAR TARJETA ERROR", mensaje: "" }, response: {} }];
      default:
        // Un método que no existe (getCardData incluido): 401, como el sandbox.
        return [401, { code: 401, message: "Unauthorized" }];
    }
  }

  const servidor: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const responder = (estado: number, cuerpo: unknown) => {
      res.statusCode = estado;
      res.setHeader("content-type", "application/json");
      res.end(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo));
    };
    let cuerpo: unknown;
    try {
      const texto = await leer(req);
      cuerpo = texto ? JSON.parse(texto) : {};
    } catch {
      return responder(400, { code: 400, message: "Bad Request" });
    }

    if (url.pathname === "/salud") return responder(200, { ok: true });
    if (url.pathname === "/estado" && req.method === "GET") return responder(200, { clientes: [...clientes.values()], tarjetas: [...tarjetas.values()] });
    if (url.pathname === "/reiniciar" && req.method === "POST") {
      reiniciar();
      return responder(200, { ok: true });
    }
    if (url.pathname === "/simular" && req.method === "POST" && (cuerpo as { metodo?: unknown })?.metodo === "movimiento") {
      try {
        inyectarMovimiento(cuerpo as MovimientoInyectado);
      } catch {
        return responder(400, { error: "movimiento no válido" });
      }
      return responder(200, { ok: true });
    }
    if (url.pathname === "/simular" && req.method === "POST") {
      const f = cuerpo as FallaPendiente;
      if (typeof f?.metodo !== "string" || !["901", "401", "5xx", "ilegible", "timeout", "timeout_sin_efecto"].includes(f.falla)) return responder(400, { error: "falla no válida" });
      fallas.push({ metodo: f.metodo, falla: f.falla, idCard: f.idCard, idepCliente: f.idepCliente });
      return responder(200, { ok: true });
    }
    if (url.pathname !== "/v1/apiservice" || req.method !== "POST") return responder(404, { code: 404, message: "Not Found" });
    if (req.headers["x-api-user"] !== credenciales.usuario || req.headers["x-api-key"] !== credenciales.llave) return responder(401, { code: 401, message: "Unauthorized" });

    const o = (cuerpo ?? {}) as { method?: unknown; payload?: unknown };
    const metodo = typeof o.method === "string" ? o.method : "";
    const payload = (o.payload && typeof o.payload === "object" ? o.payload : {}) as Record<string, unknown>;
    const falla = tomarFalla(metodo, payload);
    if (falla === "401") return responder(401, { code: 401, message: "Unauthorized" });
    if (falla === "5xx") return responder(502, "<html><body>502 Bad Gateway</body></html>");
    if (falla === "901") return responder(200, { status: { code: "901", message: "ERROR: PARABILIUM API CONSULTAR TARJETA ERROR", mensaje: "" }, response: {} });
    if (falla === "timeout_sin_efecto") {
      colgados.add(res);
      return;
    }
    const [estado, respuesta] = atender(metodo, payload);
    if (falla === "timeout") {
      // Efevoo ya lo hizo; Lever nunca recibe la respuesta.
      colgados.add(res);
      return;
    }
    if (falla === "ilegible") return responder(200, "<html>Service Unavailable</html>");
    return responder(estado, respuesta);
  });
  servidor.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });

  await new Promise<void>((resolver, rechazar) => {
    servidor.once("error", rechazar);
    servidor.listen(puerto, "127.0.0.1", () => resolver());
  });
  const { port } = servidor.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    usuario: credenciales.usuario,
    llave: credenciales.llave,
    simular: (f) => fallas.push(f),
    inyectarMovimiento,
    estado: () => ({ clientes: [...clientes.values()], tarjetas: [...tarjetas.values()] }),
    reiniciar,
    cerrar: () => new Promise<void>((resolver) => {
      for (const r of colgados) r.destroy();
      for (const s of sockets) s.destroy();
      servidor.close(() => resolver());
    }),
  };
}

async function leer(req: IncomingMessage): Promise<string> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of req) {
    total += (parte as Buffer).length;
    if (total > 256 * 1024) throw new Error("cuerpo demasiado grande");
    partes.push(parte as Buffer);
  }
  return Buffer.concat(partes).toString("utf8");
}
