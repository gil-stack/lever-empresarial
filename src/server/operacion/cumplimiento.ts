import { basePlataforma, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { hoyEnMexico, revisionVencida, type Grado } from "../../dominio/operacion";
import { exigirEnOperacion } from "./permisos";

export type BandejaCumplimiento = {
  porDictaminar: Array<{ versionId: string; companyId: string; razonSocial: string; numero: number; enviadaEn: Date; enviadaPor: string }>;
  coincidencias: Array<{
    id: string; companyId: string; razonSocial: string; sujetoTipo: string; sujetoNombre: string; tipo: "exacta" | "posible";
    estado: "pendiente" | "confirmada"; plazoReporteHasta: Date | null; vencido: boolean;
    coincidePor: "rfc" | "curp" | "nombre"; nombreEnLista: string | null; lista: "lpb" | "69b";
  }>;
  revisiones: Array<{ companyId: string; razonSocial: string; grado: Grado; revisarAntesDe: string; vencida: boolean }>;
  sinCalificar: Array<{ companyId: string; razonSocial: string; numero: number }>;
  /** r63i-N1: abonos o devoluciones de Fintoc que llegaron con la empresa suspendida o de baja, sin aplicar. */
  abonosRetenidos: Array<{
    id: string; companyId: string; razonSocial: string; estadoEmpresa: string; devolucion: boolean;
    montoCentavos: number; recibidoEl: string; retenidoEn: Date;
    /** r63j-N1: el que no pasó el camino normal, con el código del error. */
    fallido: string | null;
  }>;
};

/**
 * La bandeja de Cumplimiento. Incluye los abonos de Fintoc retenidos de empresas suspendidas (r63i-N1). La revisión vencida no es un dato guardado: se
 * calcula al leer con la fecha de hoy en México (27ª).
 */
export async function leerBandejaCumplimiento(ctx: ContextoDePersonal, opciones: { ahora?: Date } = {}): Promise<BandejaCumplimiento> {
  exigirEnOperacion(ctx, "plataforma.cumplimiento.bandeja");
  const ahora = opciones.ahora ?? new Date();
  const hoy = hoyEnMexico(ahora);
  return conContexto(basePlataforma(ctx), async (consulta) => {
    const porDictaminar = await consulta.query(
      `select v.id, v.company_id, c.razon_social, v.numero, v.enviada_en, u.nombre
       from kyb_versiones v join companies c on c.id = v.company_id join users u on u.id = v.enviada_por
       where v.estado = 'enviada' and not exists (select 1 from kyb_dictamenes d where d.version_id = v.id)
       order by v.enviada_en`,
      [],
    );
    const coincidencias = await consulta.query(
      `select k.id, k.company_id, c.razon_social, k.sujeto_tipo, k.sujeto_nombre, k.tipo, k.estado, k.plazo_reporte_hasta,
              k.coincide_por, k.lista, p.nombre as nombre_en_lista
       from lpb_coincidencias k join companies c on c.id = k.company_id
       left join lpb_personas p on p.id = k.lpb_persona_id
       where k.estado = 'pendiente' or (k.estado = 'confirmada' and k.reporte_folio is null)
       order by k.plazo_reporte_hasta nulls last, k.detectada_en`,
      [],
    );
    const revisiones = await consulta.query(
      `select distinct on (k.company_id) k.company_id, c.razon_social, k.grado, k.revisar_antes_de::text as revisar_antes_de
       from kyb_calificaciones_riesgo k join companies c on c.id = k.company_id
       where c.estado <> 'baja'
       order by k.company_id, k.calificada_en desc, k.id desc`,
      [],
    );
    const sinCalificar = await consulta.query(
      `select distinct on (v.company_id) v.company_id, c.razon_social, v.numero
       from kyb_versiones v join companies c on c.id = v.company_id
       where v.estado = 'enviada' and c.estado <> 'baja'
         and not exists (select 1 from kyb_calificaciones_riesgo k where k.version_id = v.id)
         and v.numero = (select max(x.numero) from kyb_versiones x where x.company_id = v.company_id and x.estado = 'enviada')
       order by v.company_id`,
      [],
    );
    const retenidos = await consulta.query(
      `select id, company_id, razon_social, estado_empresa, tipo, monto_centavos::text as monto, recibido_el::text as recibido_el, retenido_en,
              estado, motivo
       from cobranza_abonos_retenidos()`,
      [],
    );
    return {
      porDictaminar: (porDictaminar.rows as Array<Record<string, unknown>>).map((fila) => ({
        versionId: String(fila.id),
        companyId: String(fila.company_id),
        razonSocial: String(fila.razon_social),
        numero: Number(fila.numero),
        enviadaEn: fecha(fila.enviada_en),
        enviadaPor: String(fila.nombre),
      })),
      coincidencias: (coincidencias.rows as Array<Record<string, unknown>>).map((fila) => {
        const plazo = fila.plazo_reporte_hasta ? fecha(fila.plazo_reporte_hasta) : null;
        return {
          id: String(fila.id),
          companyId: String(fila.company_id),
          razonSocial: String(fila.razon_social),
          sujetoTipo: String(fila.sujeto_tipo),
          sujetoNombre: String(fila.sujeto_nombre),
          tipo: fila.tipo === "exacta" ? "exacta" : "posible",
          estado: fila.estado === "confirmada" ? "confirmada" : "pendiente",
          plazoReporteHasta: plazo,
          vencido: plazo !== null && plazo.getTime() < ahora.getTime(),
          coincidePor: fila.coincide_por === "curp" ? "curp" : fila.coincide_por === "nombre" ? "nombre" : "rfc",
          nombreEnLista: typeof fila.nombre_en_lista === "string" ? fila.nombre_en_lista : null,
          lista: fila.lista === "69b" ? "69b" : "lpb",
        };
      }),
      revisiones: (revisiones.rows as Array<Record<string, unknown>>)
        .map((fila) => ({
          companyId: String(fila.company_id),
          razonSocial: String(fila.razon_social),
          grado: String(fila.grado) as Grado,
          revisarAntesDe: String(fila.revisar_antes_de),
          vencida: revisionVencida(String(fila.revisar_antes_de), hoy),
        }))
        .sort((a, b) => a.revisarAntesDe.localeCompare(b.revisarAntesDe)),
      sinCalificar: (sinCalificar.rows as Array<Record<string, unknown>>).map((fila) => ({
        companyId: String(fila.company_id),
        razonSocial: String(fila.razon_social),
        numero: Number(fila.numero),
      })),
      abonosRetenidos: (retenidos.rows as Array<Record<string, unknown>>).map((fila) => ({
        id: String(fila.id),
        companyId: String(fila.company_id),
        razonSocial: String(fila.razon_social),
        estadoEmpresa: String(fila.estado_empresa),
        devolucion: fila.tipo === "transfer.inbound.returned",
        montoCentavos: Number(fila.monto),
        recibidoEl: String(fila.recibido_el),
        retenidoEn: fecha(fila.retenido_en),
        fallido: fila.estado === "fallido" ? String(fila.motivo) : null,
      })),
    };
  });
}

function fecha(valor: unknown): Date {
  const salida = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(salida.getTime())) throw new ErrorDeDominio("base_no_disponible");
  return salida;
}
