import { basePlataforma, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { hoyEnMexico, uuidValido, type EstadoCliente, type HechosDelAlta } from "../../dominio/operacion";
import { exigirEnOperacion } from "./permisos";

/**
 * Dónde va el alta de cada empresa: solo estados y fechas, ningún dato del expediente. Por eso no deja el evento de
 * «expediente consultado» en la bitácora ni pide el rol del expediente: es lo mismo que ya dice la ficha (estado,
 * solicitud pendiente, administrador), con el paso del expediente y del riesgo.
 */
export async function leerHechosDelAlta(
  ctx: ContextoDePersonal,
  opciones: { companyId?: unknown; ahora?: Date } = {},
): Promise<Map<string, HechosDelAlta>> {
  exigirEnOperacion(ctx, "plataforma.operacion.ver");
  const una = opciones.companyId !== undefined;
  if (una && !uuidValido(opciones.companyId)) return new Map();
  const ahora = opciones.ahora ?? new Date();
  const hoy = hoyEnMexico(ahora);
  const resultado = await conContexto(basePlataforma(ctx, una ? (opciones.companyId as string) : undefined), (consulta) =>
    consulta.query(
      `select c.id, c.estado,
        exists (select 1 from kyb_versiones b where b.company_id = c.id and b.estado = 'borrador') as borrador,
        e.id as enviada_id, d.resultado as dictamen,
        k.revisar_antes_de::text as riesgo_hasta, (k.version_id = e.id) as riesgo_de_la_version,
        (select r.estado from company_activation_requests r where r.company_id = c.id
          order by r.requested_at desc, r.id desc limit 1) as activacion,
        i.usada_en, i.revocada_en, i.expira_en,
        exists (select 1 from memberships m
          join membership_roles mr on mr.company_id = m.company_id and mr.user_id = m.user_id and mr.rol = 'administrador'
          where m.company_id = c.id and m.estado = 'activa') as administrador_activo
       from companies c
       left join lateral (select v.id from kyb_versiones v where v.company_id = c.id and v.estado = 'enviada'
         order by v.numero desc limit 1) e on true
       left join kyb_dictamenes d on d.version_id = e.id
       left join lateral (select q.version_id, q.revisar_antes_de from kyb_calificaciones_riesgo q where q.company_id = c.id
         order by q.calificada_en desc, q.id desc limit 1) k on true
       left join lateral (select j.usada_en, j.revocada_en, j.expira_en from invitations j where j.company_id = c.id
         order by j.emitida_en desc, j.id desc limit 1) i on true
       where ($1::uuid is null or c.id = $1::uuid)
       order by c.alta_at desc
       limit 300`,
      [una ? opciones.companyId : null],
    ),
  );
  const hechos = new Map<string, HechosDelAlta>();
  for (const fila of resultado.rows as Array<Record<string, unknown>>) {
    hechos.set(String(fila.id), hechosDeFila(fila, hoy, ahora));
  }
  return hechos;
}

function hechosDeFila(fila: Record<string, unknown>, hoy: string, ahora: Date): HechosDelAlta {
  const dictamen = fila.dictamen === "aprobado" || fila.dictamen === "observado" || fila.dictamen === "rechazado" ? fila.dictamen : null;
  const activacion = fila.activacion === "pendiente" || fila.activacion === "aprobada" || fila.activacion === "rechazada" ? fila.activacion : null;
  const riesgoHasta = typeof fila.riesgo_hasta === "string" ? fila.riesgo_hasta : null;
  const riesgo = riesgoHasta && fila.riesgo_de_la_version === true ? (riesgoHasta >= hoy ? "vigente" : "vencida") : null;
  const expira = fila.expira_en instanceof Date ? fila.expira_en : fila.expira_en ? new Date(String(fila.expira_en)) : null;
  const invitacion = fila.usada_en
    ? "usada"
    : fila.revocada_en
      ? "revocada"
      : expira
        ? expira.getTime() > ahora.getTime()
          ? "vigente"
          : "vencida"
        : null;
  return {
    estado: fila.estado as EstadoCliente,
    borrador: fila.borrador === true,
    enviada: typeof fila.enviada_id === "string" ? { resultado: dictamen } : null,
    riesgo,
    activacion,
    invitacion,
    administradorActivo: fila.administrador_activo === true,
  };
}
