import { randomUUID } from "node:crypto";

import { etiquetaPeriodo, esPeriodicidad } from "../../dominio/cobranza/periodos";
import type { TipoCorreo } from "../../dominio/cobranza/recordatorios";
import { desplazar } from "../../dominio/flujo/fechas";
import { aplicarSentencia, bloquearEmpresa, conContexto, type Consulta, type ContextoDeBase } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type { Actor, Auditar } from "../bitacora/auditar";
import { ErrorDeCorreo } from "../correo/errores";
import { plantillaCobro } from "../correo/plantillas/cobro";
import type { Enviador } from "../correo/tipos";
import { booleano, centavos, entero, registro, texto, textoONulo } from "../flujo/lectura";
import { autorDe, nuevoToken } from "./comun";
import { bancoDeClabe, fechaDe } from "./repositorio";

/**
 * El único camino de un correo de cobro o recordatorio, para la consola y para
 * el cron:
 * 1. apartar (una transacción): la fila (cargo, tipo, secuencia) en «enviando»
 *    con un enlace nuevo. Si ya existe y salió, no hay nada que hacer; si falló,
 *    se reintenta (hasta 3 intentos); si quedó «enviando» más de 30 minutos, se
 *    da por interrumpida y se reintenta.
 * 2. mandar a cada correo del cliente que todavía no lo recibió, con la llave
 *    `cobranza/<correo>/<índice>` (Resend descarta el repetido por 24 horas y la
 *    fila de entrega cubre después).
 * 3. cerrar: «enviado» si llegó a todos, «fallido» con su código si no.
 * En una empresa de demostración no sale nada: queda «simulado».
 */

export const TOPE_DIARIO = 300;
export const INTENTOS = 3;
export const REENVIOS = 5;
export const ESPERA_REENVIO_MIN = 10;
const INTERRUMPIDO = "30 minutes";
/** El enlace del pagador sirve hasta 120 días después del vencimiento. */
const VIGENCIA_ENLACE_DIAS = 120;
const CODIGO = /^[a-z][a-z0-9_]{0,63}$/;

export type ResultadoCorreo = "enviado" | "simulado" | "fallido" | "ya_enviado" | "tope" | "no_aplica";

export type PasoCorreo = {
  enviador: () => Enviador;
  urlPublica: () => string;
  auditar: Auditar;
  /** Turno compartido para no pasar el límite del proveedor (el cron lo usa). */
  turno?: () => Promise<void>;
  registrar: (campos: Readonly<Record<string, string | number>>) => void;
};

type Apartado = {
  emailId: string;
  token: string;
  demostracion: boolean;
  datos: Parameters<typeof plantillaCobro>[0];
  correos: string[];
  entregados: Set<number>;
  contacto: string | null;
};

export async function enviarCorreoDeCargo(
  base: ContextoDeBase,
  actor: Actor,
  cargoId: string,
  tipo: TipoCorreo,
  secuencia: number,
  hoy: string,
  paso: PasoCorreo,
): Promise<ResultadoCorreo> {
  const apartado = await conContexto(base, (consulta) => apartar(consulta, actor, cargoId, tipo, secuencia, hoy, paso));
  if (typeof apartado === "string") return apartado;
  if (apartado.demostracion) return "simulado";

  let codigo: string | null = null;
  const plantilla = plantillaCobro({ ...apartado.datos, enlace: `${paso.urlPublica()}/pagar/${apartado.token}` });
  let enviador: Enviador;
  try {
    enviador = paso.enviador();
  } catch (error) {
    codigo = codigoDe(error);
    await conContexto(base, (consulta) => cerrar(consulta, actor, paso.auditar, apartado.emailId, tipo, apartado.entregados.size, codigo));
    return "fallido";
  }
  for (const [indice, para] of apartado.correos.entries()) {
    if (apartado.entregados.has(indice)) continue;
    try {
      await paso.turno?.();
      await enviador({
        para,
        ...plantilla,
        idempotencia: `cobranza/${apartado.emailId}/${indice}`,
        etiqueta: "cobranza",
        ...(apartado.contacto ? { responderA: apartado.contacto } : {}),
      });
    } catch (error) {
      // La llave ya se usó con otro contenido: ese correo ya salió y solo faltó registrarlo.
      if (!(error instanceof ErrorDeCorreo && error.codigo === "correo_ya_enviado")) {
        codigo ??= codigoDe(error);
        paso.registrar({ evento: "correo_cobranza_destinatario_fallido", empresa: base.companyId ?? "", correo: apartado.emailId, indice, codigo: codigoDe(error) });
        continue;
      }
    }
    try {
      await conContexto(base, (consulta) => registrarEntrega(consulta, actor, paso.auditar, apartado.emailId, base.companyId ?? "", indice));
      apartado.entregados.add(indice);
    } catch (error) {
      codigo ??= codigoDe(error);
      paso.registrar({ evento: "correo_cobranza_entrega_sin_registro", empresa: base.companyId ?? "", correo: apartado.emailId, indice, codigo: codigoDe(error) });
    }
  }
  const final = apartado.entregados.size === apartado.correos.length ? null : (codigo ?? "entrega_incompleta");
  await conContexto(base, (consulta) => cerrar(consulta, actor, paso.auditar, apartado.emailId, tipo, apartado.entregados.size, final));
  return final ? "fallido" : "enviado";
}

async function apartar(
  consulta: Consulta,
  actor: Actor,
  cargoId: string,
  tipo: TipoCorreo,
  secuencia: number,
  hoy: string,
  paso: PasoCorreo,
): Promise<Apartado | ResultadoCorreo> {
  const empresaId = actor.companyId;
  if (!empresaId) throw new ErrorDeDominio("sin_empresa");
  await bloquearEmpresa(consulta, empresaId);
  const r = await aplicarSentencia(
    consulta,
    `select c.estado, c.concepto, c.monto_centavos::text as monto, c.pagado_centavos::text as pagado, c.vencimiento, c.referencia,
            p.periodicidad, k.nombre, k.correos, s.correo_contacto, e.razon_social, e.demostracion,
            -- La CLABE propia del cliente (proveedor SPEI) va primero: ahí el abono dice solo quién pagó.
            case when s.company_id is null then null else coalesce(v.clabe, s.clabe) end as clabe,
            case when v.clabe is not null then e.razon_social else s.beneficiario end as beneficiario
       from collection_charges c
       join collection_customers k on k.id = c.customer_id and k.company_id = c.company_id
       left join collection_plans p on p.id = c.plan_id and p.company_id = c.company_id
       join companies e on e.id = c.company_id
       left join collection_settings s on s.company_id = c.company_id
       left join collection_virtual_accounts v on v.company_id = c.company_id and v.customer_id = c.customer_id and v.proveedor = 'fintoc'
      where c.company_id = $1 and c.id = $2`,
    [empresaId, cargoId],
  );
  const fila = r.rows[0] ? registro(r.rows[0]) : null;
  if (!fila) throw new ErrorDeDominio("cargo_ausente");
  if (fila.estado !== "emitido") return "no_aplica";
  if (fila.clabe === null || fila.clabe === undefined) throw new ErrorDeDominio("cobranza_sin_configurar");
  const demostracion = booleano(fila.demostracion);

  if (!demostracion) {
    const enviados = await aplicarSentencia(
      consulta,
      "select count(*) as n from collection_email_deliveries where company_id = $1 and entregado_en > now() - interval '24 hours'",
      [empresaId],
    );
    if (entero(registro(enviados.rows[0]).n) >= TOPE_DIARIO) {
      paso.registrar({ evento: "correo_cobranza_tope", empresa: empresaId });
      return "tope";
    }
  }

  const vencimiento = fechaDe(fila.vencimiento);
  const { token, hash } = nuevoToken();
  const vence = desplazar(vencimiento > hoy ? vencimiento : hoy, VIGENCIA_ENLACE_DIAS);
  const nuevo = randomUUID();
  const insertado = await aplicarSentencia(
    consulta,
    `insert into collection_emails (id, company_id, charge_id, tipo, secuencia, estado, enlace_hash, enlace_vence, solicitado_por)
     values ($1, $2, $3, $4, $5, 'enviando', $6, $7::date, $8)
     on conflict (charge_id, tipo, secuencia) do nothing
     returning id`,
    [nuevo, empresaId, cargoId, tipo, secuencia, hash, vence, autorDe(actor)],
  );
  let emailId: string = nuevo;
  if (insertado.rows.length === 0) {
    const previo = registro((await aplicarSentencia(
      consulta,
      `select id, estado, intentos, clock_timestamp() - intentado_en > $3::interval as interrumpido
         from collection_emails where charge_id = $1 and tipo = $2 and secuencia = $4 and company_id = $5 for update`,
      [cargoId, tipo, INTERRUMPIDO, secuencia, empresaId],
    )).rows[0]);
    emailId = texto(previo.id);
    const estado = texto(previo.estado);
    if (estado === "enviado" || estado === "simulado") return "ya_enviado";
    if (estado === "enviando") {
      if (!booleano(previo.interrumpido)) return "ya_enviado";
      await cerrar(consulta, actor, paso.auditar, emailId, tipo, 0, "interrumpido");
    }
    if (entero(previo.intentos) >= INTENTOS) return "fallido";
    await aplicarSentencia(
      consulta,
      `update collection_emails
          set estado = 'enviando', intentos = intentos + 1, codigo = null, enlace_hash = $2, enlace_vence = $3::date,
              intentado_en = clock_timestamp(), terminado_en = null
        where id = $1 and estado = 'fallido'`,
      [emailId, hash, vence],
    );
  }

  if (demostracion) {
    await cerrar(consulta, actor, paso.auditar, emailId, tipo, 0, null, "simulado");
    return { emailId, token, demostracion, datos: datosDe(fila, tipo), correos: [], entregados: new Set(), contacto: null };
  }
  const entregas = await aplicarSentencia(consulta, "select indice from collection_email_deliveries where company_id = $1 and email_id = $2", [empresaId, emailId]);
  return {
    emailId,
    token,
    demostracion,
    datos: datosDe(fila, tipo),
    correos: Array.isArray(fila.correos) ? fila.correos.map(texto) : [],
    entregados: new Set(entregas.rows.map(registro).map((e) => entero(e.indice))),
    contacto: textoONulo(fila.correo_contacto),
  };
}

function datosDe(fila: Record<string, unknown>, tipo: TipoCorreo): Parameters<typeof plantillaCobro>[0] {
  const monto = centavos(fila.monto);
  const vencimiento = fechaDe(fila.vencimiento);
  const clabe = texto(fila.clabe);
  return {
    tipo,
    razonSocial: texto(fila.razon_social),
    cliente: texto(fila.nombre),
    concepto: texto(fila.concepto),
    periodo: etiquetaPeriodo(vencimiento, esPeriodicidad(fila.periodicidad) ? fila.periodicidad : null),
    montoCentavos: monto,
    saldoCentavos: monto - centavos(fila.pagado),
    vencimiento,
    clabe,
    banco: bancoDeClabe(clabe),
    beneficiario: texto(fila.beneficiario),
    referencia: texto(fila.referencia),
    enlace: "",
    contacto: textoONulo(fila.correo_contacto),
  };
}

async function registrarEntrega(consulta: Consulta, actor: Actor, auditar: Auditar, emailId: string, empresaId: string, indice: number): Promise<void> {
  const id = randomUUID();
  const r = await aplicarSentencia(
    consulta,
    `insert into collection_email_deliveries (id, company_id, email_id, indice) values ($1, $2, $3, $4)
     on conflict (email_id, indice) do nothing returning id`,
    [id, empresaId, emailId, indice],
  );
  if (r.rows.length === 0) return;
  await auditar(consulta, actor, { accion: "correo_cobranza_entregado", identificador: id });
}

async function cerrar(
  consulta: Consulta,
  actor: Actor,
  auditar: Auditar,
  emailId: string,
  tipo: TipoCorreo,
  destinatarios: number,
  codigo: string | null,
  estadoForzado?: "simulado",
): Promise<void> {
  const estado = estadoForzado ?? (codigo ? "fallido" : "enviado");
  const r = await aplicarSentencia(
    consulta,
    `update collection_emails set estado = $2, destinatarios = $3, codigo = $4, terminado_en = clock_timestamp()
      where id = $1 and estado = 'enviando'`,
    [emailId, estado, destinatarios, codigo],
  );
  if (r.rowCount !== 1) throw new ErrorDeDominio("correo_cerrado");
  await auditar(consulta, actor, { accion: "correo_cobranza", identificador: emailId, cambio: { tipo, estado, destinatarios, codigo } });
}

function codigoDe(error: unknown): string {
  if (error instanceof ErrorDeDominio && CODIGO.test(error.codigo)) return error.codigo;
  return "desconocido";
}

/** Solo ids internos y el código: nunca correos, nombres ni montos. */
export function registrarPorDefecto(campos: Readonly<Record<string, string | number>>): void {
  console.error(JSON.stringify({ nivel: "error", origen: "cobranza.correo", ...campos }));
}
