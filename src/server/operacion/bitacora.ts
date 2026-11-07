import { basePlataforma, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type { EventoBitacora } from "./tipos";
import { exigirEnOperacion } from "./permisos";

/** Proyección de solo lectura: no incluye cambio JSON ni material de autenticación. */
export async function leerBitacora(ctx: ContextoDePersonal, companyId?: string): Promise<EventoBitacora[]> {
  exigirEnOperacion(ctx, "plataforma.bitacora.ver");
  const resultado = await conContexto(basePlataforma(ctx), (consulta) =>
    consulta.query(
      `select a.id, a.company_id, c.razon_social,
        coalesce(u.nombre, case a.actor_tipo when 'sistema' then 'Sistema' else 'Aviso externo' end) as actor,
        a.accion, a.entidad, a.identificador, a.motivo, a.ocurrido_en
       from audit_log a
       left join companies c on c.id = a.company_id
       left join users u on u.id = a.actor_id
       where ($1::uuid is null or a.company_id = $1)
       order by a.ocurrido_en desc, a.id desc
       limit 400`,
      [companyId ?? null],
    ),
  );
  return (resultado.rows as Array<Record<string, unknown>>).map((fila) => ({
    id: String(fila.id),
    companyId: typeof fila.company_id === "string" ? fila.company_id : null,
    razonSocial: typeof fila.razon_social === "string" ? fila.razon_social : null,
    actor: String(fila.actor),
    accion: String(fila.accion),
    entidad: String(fila.entidad),
    identificador: typeof fila.identificador === "string" ? fila.identificador : null,
    motivo: typeof fila.motivo === "string" ? fila.motivo : null,
    ocurridoEn: fecha(fila.ocurrido_en),
  }));
}

function fecha(valor: unknown): Date {
  const salida = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(salida.getTime())) throw new ErrorDeDominio("base_no_disponible");
  return salida;
}
