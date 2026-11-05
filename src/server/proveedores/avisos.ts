import { baseCliente, type ContextoConEmpresa } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { leerUrlPublica } from "../correo/configuracion";
import { enviadorDesdeEntorno } from "../correo/enviar";
import { armarCorreo, fechaEnMexico } from "../correo/plantillas/marco";
import type { Enviador } from "../correo/tipos";

export async function avisarCambioClabe(
  ctx: ContextoConEmpresa,
  datos: { supplierId: string; clabeId: string; clabe: string; ahora: Date },
  enviar?: Enviador,
): Promise<number> {
  try {
    const destino = await destinatarios(ctx, datos.supplierId);
    if (!destino || destino.correos.length === 0) return 0;
    const enlace = `${leerUrlPublica()}/c/${ctx.empresa.id}/consola/proveedores?vista=proveedores&proveedor=${datos.supplierId}`;
    const plantilla = armarCorreo(`Cambió la CLABE de ${destino.proveedor}`, {
      preencabezado: "Revisa este cambio antes de autorizar pagos al proveedor.",
      kicker: "Alerta de cuenta de depósito",
      titulo: "Cambió la CLABE de un proveedor.",
      parrafos: [
        `${destino.proveedor} tiene una nueva CLABE vigente. La anterior permanece en el historial de la empresa.`,
        "Si no reconoces este cambio, detén la autorización de pagos pendientes y revisa la actividad de la cuenta.",
      ],
      datos: [
        ["Empresa", ctx.empresa.razonSocial],
        ["Proveedor", destino.proveedor],
        ["Nueva terminación", `•••• ${datos.clabe.slice(-4)}`],
        ["Fecha del cambio", fechaEnMexico(datos.ahora)],
      ],
      boton: { texto: "Revisar expediente", url: enlace },
      notas: [
        "Este aviso nunca incluye la CLABE completa.",
        "Un pago solicitado antes del cambio debe revisarse de nuevo antes de autorizarse.",
      ],
    });
    const enviador = enviar ?? enviadorDesdeEntorno();
    let enviados = 0;
    for (const correo of destino.correos) {
      try {
        await enviador({
          para: correo,
          asunto: plantilla.asunto,
          html: plantilla.html,
          texto: plantilla.texto,
          idempotencia: `clabe-proveedor/${datos.clabeId}/${correo.toLowerCase()}`,
          etiqueta: "clabe_proveedor",
        });
        enviados += 1;
      } catch {
        // El cambio ya quedó asentado. No se anuncia un envío que falló.
      }
    }
    return enviados;
  } catch {
    return 0;
  }
}

async function destinatarios(ctx: ContextoConEmpresa, supplierId: string): Promise<{ proveedor: string; correos: string[] } | null> {
  return conContexto(baseCliente(ctx), async (consulta) => {
    const resultado = await consulta.query(`select s.razon_social,
        coalesce(array_agg(distinct u.correo) filter (where u.correo is not null), '{}') as correos
      from suppliers s
      join memberships m on m.company_id = s.company_id and m.estado = 'activa'
      join membership_roles r on r.company_id = m.company_id and r.user_id = m.user_id and r.rol in ('administrador', 'liberador')
      join users u on u.id = m.user_id
      left join employees e on e.company_id = m.company_id and e.user_id = m.user_id
      where s.company_id = $1 and s.id = $2
        and (e.id is null or e.baja_en is null or e.baja_en > (timezone('America/Mexico_City', clock_timestamp()))::date)
      group by s.razon_social`, [ctx.empresa.id, supplierId]);
    const fila = resultado.rows[0] as { razon_social?: unknown; correos?: unknown } | undefined;
    if (!fila || typeof fila.razon_social !== "string" || !Array.isArray(fila.correos)) return null;
    return { proveedor: fila.razon_social, correos: fila.correos.filter((correo): correo is string => typeof correo === "string") };
  });
}
